import { contextBridge, ipcRenderer } from "electron";
import { AppSettings, WatcherSnapshot } from "../types";

export interface RendererSettings extends AppSettings {
  settingsPath: string;
  legacyConfigPath: string | null;
  systemUsername: string;
  discordClientIdConfigured: boolean;
  openAiApiKeyConfigured: boolean;
}

contextBridge.exposeInMainWorld("presenceWatcher", {
  getSnapshot: (): Promise<WatcherSnapshot> => ipcRenderer.invoke("watcher:get-snapshot"),
  onSnapshot: (listener: (snapshot: WatcherSnapshot) => void): void => {
    ipcRenderer.on("watcher:snapshot", (_event, snapshot: WatcherSnapshot) => {
      listener(snapshot);
    });
  },
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: (): Promise<boolean> => ipcRenderer.invoke("window:toggle-maximize"),
  isWindowMaximized: (): Promise<boolean> => ipcRenderer.invoke("window:is-maximized"),
  getSettings: (): Promise<RendererSettings> => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: Partial<AppSettings>): Promise<RendererSettings> => ipcRenderer.invoke("settings:save", settings),
  browseForFolder: (): Promise<string | null> => ipcRenderer.invoke("settings:browse-folder"),
  quit: (): Promise<void> => ipcRenderer.invoke("app:quit")
});
