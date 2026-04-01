import path from "node:path";
import { Event, OpenDialogOptions, app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage } from "electron";
import { createWatcherConfig, loadAppSettings, saveAppSettings } from "../config";
import { AppSettings, LoadedAppSettings, WatcherSnapshot } from "../types";
import { PresenceWatcherApp } from "../watcherApp";
import { createDefaultWatcherSnapshot, createErrorWatcherSnapshot } from "../watcherSnapshot";

const APP_NAME = "CodePulse";
const WINDOW_WIDTH = 340;
const WINDOW_HEIGHT = 210;
const MIN_WINDOW_WIDTH = 300;
const MIN_WINDOW_HEIGHT = 180;
const TITLE_BAR_HEIGHT = 30;
const WATCHER_SNAPSHOT_CHANNEL = "watcher:snapshot";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let watcher: PresenceWatcherApp | null = null;
let unsubscribeWatcher: (() => void) | null = null;
let currentSettings: LoadedAppSettings | null = null;
let isQuitting = false;
let latestSnapshot: WatcherSnapshot = {
  ...createDefaultWatcherSnapshot(),
  watcherState: "starting",
  watcherMessage: "Launching desktop watcher...",
  updatedAt: Date.now()
};

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  void bootstrap();
}

async function bootstrap(): Promise<void> {
  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("activate", () => {
    showMainWindow();
  });

  await app.whenReady();
  app.setAppUserModelId("com.codex.codepulse");

  currentSettings = loadCurrentSettings();
  applyLaunchOnStartup(currentSettings.launchOnStartup);

  registerIpcHandlers();
  createMainWindow();
  createTray();
  await startWatcher();
}

function registerIpcHandlers(): void {
  ipcMain.handle("watcher:get-snapshot", () => {
    return latestSnapshot;
  });

  ipcMain.handle("window:minimize", () => {
    mainWindow?.minimize();
  });

  ipcMain.handle("window:maximize", () => {
    mainWindow?.maximize();
  });

  ipcMain.handle("window:unmaximize", () => {
    mainWindow?.unmaximize();
  });

  ipcMain.handle("window:toggle-maximize", () => {
    if (!mainWindow) {
      return false;
    }

    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      return false;
    }

    mainWindow.maximize();
    return true;
  });

  ipcMain.handle("window:is-maximized", () => {
    return mainWindow?.isMaximized() ?? false;
  });

  ipcMain.handle("settings:get", () => {
    return serializeSettings();
  });

  ipcMain.handle("settings:save", async (_event, draft: Partial<AppSettings>) => {
    const nextSettings = saveAppSettings(draft, createSettingsOptions());
    const previousMinimizeToTray = currentSettings?.minimizeToTray ?? true;
    currentSettings = nextSettings;

    applyLaunchOnStartup(nextSettings.launchOnStartup);

    if (!previousMinimizeToTray && nextSettings.minimizeToTray && mainWindow?.isVisible() === false) {
      mainWindow.show();
    }

    await applyWatcherSettings();
    return serializeSettings();
  });

  ipcMain.handle("settings:browse-folder", async () => {
    const options: OpenDialogOptions = {
      title: "Select Watched Workspace Folder",
      properties: ["openDirectory"]
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);

    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("app:quit", async () => {
    await quitApplication();
  });
}

function createMainWindow(): void {
  const icon = loadAppIcon();

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    resizable: true,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0c1018",
    title: APP_NAME,
    icon: icon.isEmpty() ? undefined : icon,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  mainWindow.webContents.on("did-finish-load", () => {
    sendSnapshot(latestSnapshot);
  });

  mainWindow.on("minimize", () => {
    if (!currentSettings?.minimizeToTray) {
      return;
    }

    mainWindow?.hide();
  });

  mainWindow.on("close", (event: Event) => {
    if (isQuitting) {
      return;
    }

    if (!currentSettings?.minimizeToTray) {
      event.preventDefault();
      void quitApplication();
      return;
    }

    event.preventDefault();
    mainWindow?.hide();
  });
}

function createTray(): void {
  const icon = loadAppIcon();
  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show Status",
        click: () => {
          showMainWindow();
        }
      },
      {
        type: "separator"
      },
      {
        label: "Quit",
        click: () => {
          void quitApplication();
        }
      }
    ])
  );
  tray.on("double-click", () => {
    showMainWindow();
  });
}

function showMainWindow(): void {
  if (!mainWindow) {
    createMainWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

async function startWatcher(): Promise<void> {
  if (!currentSettings) {
    currentSettings = loadCurrentSettings();
  }

  try {
    const watcherConfig = createWatcherConfig(path.resolve(app.getAppPath()), currentSettings);

    watcher = new PresenceWatcherApp(watcherConfig);
    unsubscribeWatcher = watcher.subscribe((snapshot) => {
      latestSnapshot = snapshot;
      updateTrayTooltip(snapshot);
      sendSnapshot(snapshot);
    });

    await watcher.start();
  } catch (error) {
    if (watcher) {
      try {
        await watcher.stop();
      } catch {
        // Ignore shutdown errors and surface the startup failure instead.
      }
    }

    setWatcherErrorState(error);
  }
}

async function applyWatcherSettings(): Promise<void> {
  if (!currentSettings) {
    currentSettings = loadCurrentSettings();
  }

  try {
    const watcherConfig = createWatcherConfig(path.resolve(app.getAppPath()), currentSettings);

    if (!watcher) {
      clearWatcherErrorState();
      watcher = new PresenceWatcherApp(watcherConfig);
      unsubscribeWatcher = watcher.subscribe((snapshot) => {
        latestSnapshot = snapshot;
        updateTrayTooltip(snapshot);
        sendSnapshot(snapshot);
      });
      await watcher.start();
      return;
    }

    clearWatcherErrorState();
    await watcher.applyConfig(watcherConfig);
  } catch (error) {
    if (watcher) {
      await watcher.stop();
      watcher = null;
    }

    if (unsubscribeWatcher) {
      unsubscribeWatcher();
      unsubscribeWatcher = null;
    }

    setWatcherErrorState(error);
  }
}

function clearWatcherErrorState(): void {
  if (latestSnapshot.status !== "error") {
    return;
  }

  latestSnapshot = {
    ...createDefaultWatcherSnapshot(),
    watcherState: "starting",
    watcherMessage: "Applying updated settings...",
    updatedAt: Date.now()
  };
  updateTrayTooltip(latestSnapshot);
  sendSnapshot(latestSnapshot);
}

function setWatcherErrorState(error: unknown): void {
  if (unsubscribeWatcher) {
    unsubscribeWatcher();
    unsubscribeWatcher = null;
  }

  if (watcher) {
    watcher = null;
  }

  const message = error instanceof Error ? error.message : String(error);
  latestSnapshot = createErrorWatcherSnapshot(message);
  updateTrayTooltip(latestSnapshot);
  sendSnapshot(latestSnapshot);
  console.error(`[watcher] Startup failed: ${message}`);
}

async function quitApplication(): Promise<void> {
  if (isQuitting) {
    return;
  }

  isQuitting = true;

  if (unsubscribeWatcher) {
    unsubscribeWatcher();
    unsubscribeWatcher = null;
  }

  if (watcher) {
    await watcher.stop();
    watcher = null;
  }

  app.quit();
}

function sendSnapshot(snapshot: WatcherSnapshot): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send(WATCHER_SNAPSHOT_CHANNEL, snapshot);
}

function updateTrayTooltip(snapshot: WatcherSnapshot): void {
  if (!tray) {
    return;
  }

  const suffix =
    snapshot.status === "working" && snapshot.projectName
      ? `\n${snapshot.projectName} | ${snapshot.phase ?? "In Progress"}`
      : `\n${snapshot.watcherMessage}`;

  tray.setToolTip(`${APP_NAME}${suffix}`);
}

function loadAppIcon() {
  const iconPath = path.join(__dirname, "..", "assets", "tray-icon.png");
  const icon = nativeImage.createFromPath(iconPath);

  return icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 32, height: 32 });
}

function createSettingsOptions() {
  const appRoot = path.resolve(app.getAppPath());

  return {
    appRoot,
    userDataPath: app.getPath("userData"),
    configSearchDirectories: resolveConfigSearchDirectories(appRoot)
  };
}

function loadCurrentSettings(): LoadedAppSettings {
  return loadAppSettings(createSettingsOptions());
}

function resolveConfigSearchDirectories(appRoot: string): string[] {
  const searchDirectories: string[] = [];
  const portableExecutableDirectory = process.env.PORTABLE_EXECUTABLE_DIR?.trim();

  if (portableExecutableDirectory) {
    searchDirectories.push(portableExecutableDirectory);
  }

  searchDirectories.push(appRoot);

  const currentWorkingDirectory = process.cwd();
  if (currentWorkingDirectory) {
    searchDirectories.push(currentWorkingDirectory);
  }

  return searchDirectories;
}

function serializeSettings() {
  const settings = currentSettings ?? loadCurrentSettings();

  return {
    username: settings.username,
    watchedFolderPath: settings.watchedFolderPath,
    detailsTemplate: settings.detailsTemplate,
    stateTemplate: settings.stateTemplate,
    aiLabelingEnabled: settings.aiLabelingEnabled,
    openAiModel: settings.openAiModel,
    openAiApiKey: settings.openAiApiKey,
    geminiApiKey: settings.geminiApiKey,
    pollIntervalSeconds: settings.pollIntervalSeconds,
    inactivityTimeoutMinutes: settings.inactivityTimeoutMinutes,
    showElapsedTime: settings.showElapsedTime,
    minimizeToTray: settings.minimizeToTray,
    launchOnStartup: settings.launchOnStartup,
    settingsPath: settings.settingsPath,
    legacyConfigPath: settings.legacyConfigPath,
    systemUsername: settings.systemUsername,
    discordClientIdConfigured: Boolean(settings.discordClientId),
    openAiApiKeyConfigured: Boolean(process.env.OPENAI_API_KEY?.trim())
  };
}

function applyLaunchOnStartup(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath
  });
}
