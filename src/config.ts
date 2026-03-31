import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getEnvironmentLoadDiagnostics, loadEnvironmentFiles } from "./env";
import { AppConfig, AppSettings, LoadedAppSettings, LoadedConfig } from "./types";

const LEGACY_CONFIG_FILENAME = "watcher.config.json";
const SETTINGS_FILENAME = "watcher.settings.json";

const DEFAULT_DETAILS_TEMPLATE = "{username} is working on {project}";
const DEFAULT_STATE_TEMPLATE = "{phase}";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

const LEGACY_CONFIG_TEMPLATE = `${JSON.stringify(
  {
    discordClientId: "PASTE_YOUR_DISCORD_APPLICATION_ID_HERE"
  },
  null,
  2
)}\n`;

export interface LoadConfigOptions {
  appRoot: string;
  userDataPath?: string;
  configSearchDirectories?: string[];
}

export interface SaveSettingsOptions {
  appRoot: string;
  userDataPath: string;
  configSearchDirectories?: string[];
}

export function loadConfig(appRoot: string): LoadedConfig;
export function loadConfig(options: LoadConfigOptions): LoadedConfig;
export function loadConfig(appRootOrOptions: string | LoadConfigOptions): LoadedConfig {
  const options = normalizeLoadConfigOptions(appRootOrOptions);
  const settings = loadAppSettings(options);

  return createWatcherConfig(options.appRoot, settings);
}

export function loadAppSettings(options: LoadConfigOptions): LoadedAppSettings {
  const normalizedOptions = normalizeLoadConfigOptions(options);
  loadEnvironmentFiles([
    ...(normalizedOptions.configSearchDirectories ?? []),
    normalizedOptions.appRoot
  ]);
  const settingsPath = resolveSettingsPath(normalizedOptions.userDataPath ?? normalizedOptions.appRoot);
  const systemUsername = resolveSystemUsername();
  const legacyConfig = loadLegacyConfig(normalizedOptions);

  const rawSettings = readJsonFile<Partial<AppSettings>>(settingsPath);
  const loadedSettings = normalizeSettings(rawSettings, {
    systemUsername,
    fallbackWorkspaceRoot: legacyConfig.workspaceRoots[0] ?? "",
    requireWatchedFolder: false,
    validateWatchedFolder: false,
    strictNumbers: false
  });

  ensureSettingsFile(settingsPath, loadedSettings);

  return {
    ...loadedSettings,
    settingsPath,
    legacyConfigPath: legacyConfig.configPath,
    discordClientId: legacyConfig.discordClientId,
    discordClientIdSource: legacyConfig.discordClientIdSource,
    systemUsername
  };
}

export function saveAppSettings(
  input: Partial<AppSettings>,
  options: SaveSettingsOptions
): LoadedAppSettings {
  const normalizedOptions = normalizeLoadConfigOptions(options);
  const currentSettings = loadAppSettings(normalizedOptions);
  const nextSettings = normalizeSettings(
    {
      ...currentSettings,
      ...input
    },
    {
      systemUsername: currentSettings.systemUsername,
      fallbackWorkspaceRoot: currentSettings.watchedFolderPath,
      requireWatchedFolder: true,
      validateWatchedFolder: true,
      strictNumbers: true
    }
  );

  fs.mkdirSync(path.dirname(currentSettings.settingsPath), { recursive: true });
  fs.writeFileSync(currentSettings.settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, "utf8");

  return {
    ...currentSettings,
    ...nextSettings
  };
}

export function getDefaultSettings(systemUsername = resolveSystemUsername()): AppSettings {
  return {
    username: "",
    watchedFolderPath: "",
    detailsTemplate: DEFAULT_DETAILS_TEMPLATE,
    stateTemplate: DEFAULT_STATE_TEMPLATE,
    aiLabelingEnabled: false,
    openAiModel: DEFAULT_OPENAI_MODEL,
    pollIntervalSeconds: 15,
    inactivityTimeoutMinutes: 30,
    showElapsedTime: true,
    minimizeToTray: true,
    launchOnStartup: false
  };
}

export function createWatcherConfig(appRoot: string, settings: LoadedAppSettings): LoadedConfig {
  const envDiagnostics = getEnvironmentLoadDiagnostics();
  const openAiEnvPath = envDiagnostics.loadedFiles[0] ?? null;
  const watchedFolderPath = settings.watchedFolderPath.trim();
  if (!watchedFolderPath) {
    throw new Error("Select a watched workspace folder in Settings before starting the watcher.");
  }

  validateDirectory(watchedFolderPath, "Selected watched folder");

  if (!settings.discordClientId) {
    const sourceHint =
      settings.legacyConfigPath ??
      path.join(path.dirname(settings.settingsPath), LEGACY_CONFIG_FILENAME);

    throw new Error(
      `Discord application ID is missing. Set "discordClientId" in ${sourceHint} and restart the watcher.`
    );
  }

  return {
    appRoot,
    configPath: settings.legacyConfigPath,
    settingsPath: settings.settingsPath,
    discordClientId: settings.discordClientId,
    workspaceRoots: [watchedFolderPath],
    pollIntervalMs: settings.pollIntervalSeconds * 1000,
    inactivityTimeoutMs: settings.inactivityTimeoutMinutes * 60 * 1000,
    username: settings.username.trim() || settings.systemUsername,
    detailsTemplate: settings.detailsTemplate,
    stateTemplate: settings.stateTemplate,
    aiLabelingEnabled: settings.aiLabelingEnabled,
    openAiModel: settings.openAiModel,
    openAiApiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
    openAiEnvLoaded: envDiagnostics.loadedKeys.includes("OPENAI_API_KEY"),
    openAiEnvPath,
    showElapsedTime: settings.showElapsedTime
  };
}

function normalizeLoadConfigOptions(appRootOrOptions: string | LoadConfigOptions): LoadConfigOptions {
  if (typeof appRootOrOptions === "string") {
    return {
      appRoot: appRootOrOptions
    };
  }

  return {
    appRoot: appRootOrOptions.appRoot,
    userDataPath: appRootOrOptions.userDataPath,
    configSearchDirectories: appRootOrOptions.configSearchDirectories
  };
}

function normalizeSettings(
  input: Partial<AppSettings> | undefined,
  options: {
    systemUsername: string;
    fallbackWorkspaceRoot: string;
    requireWatchedFolder: boolean;
    validateWatchedFolder: boolean;
    strictNumbers: boolean;
  }
): AppSettings {
  const defaults = getDefaultSettings(options.systemUsername);
  const username = typeof input?.username === "string" ? input.username.trim() : defaults.username;
  const watchedFolderPath = normalizeWatchedFolderPath(input?.watchedFolderPath, options.fallbackWorkspaceRoot);
  const detailsTemplate = normalizeTemplate(input?.detailsTemplate, DEFAULT_DETAILS_TEMPLATE);
  const stateTemplate = normalizeTemplate(input?.stateTemplate, DEFAULT_STATE_TEMPLATE);
  const openAiModel = normalizeModel(input?.openAiModel, DEFAULT_OPENAI_MODEL);
  const pollIntervalSeconds = normalizeNumber(
    input?.pollIntervalSeconds,
    defaults.pollIntervalSeconds,
    5,
    300,
    options.strictNumbers
  );
  const inactivityTimeoutMinutes = normalizeNumber(
    input?.inactivityTimeoutMinutes,
    defaults.inactivityTimeoutMinutes,
    1,
    1440,
    options.strictNumbers
  );

  if (options.requireWatchedFolder && !watchedFolderPath) {
    throw new Error("Choose a workspace folder before saving settings.");
  }

  if (options.validateWatchedFolder && watchedFolderPath) {
    validateDirectory(watchedFolderPath, "Selected watched folder");
  }

  return {
    username,
    watchedFolderPath,
    detailsTemplate,
    stateTemplate,
    aiLabelingEnabled: normalizeBoolean(input?.aiLabelingEnabled, defaults.aiLabelingEnabled),
    openAiModel,
    pollIntervalSeconds,
    inactivityTimeoutMinutes,
    showElapsedTime: normalizeBoolean(input?.showElapsedTime, defaults.showElapsedTime),
    minimizeToTray: normalizeBoolean(input?.minimizeToTray, defaults.minimizeToTray),
    launchOnStartup: normalizeBoolean(input?.launchOnStartup, defaults.launchOnStartup)
  };
}

function normalizeWatchedFolderPath(input: unknown, fallbackWorkspaceRoot: string): string {
  const rawValue = typeof input === "string" ? input.trim() : fallbackWorkspaceRoot.trim();
  if (!rawValue) {
    return "";
  }

  return path.resolve(rawValue);
}

function normalizeTemplate(input: unknown, fallback: string): string {
  if (typeof input !== "string") {
    return fallback;
  }

  const normalized = input.trim();
  return normalized || fallback;
}

function normalizeModel(input: unknown, fallback: string): string {
  if (typeof input !== "string") {
    return fallback;
  }

  const normalized = input.trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, 120);
}

function normalizeNumber(input: unknown, fallback: number, min: number, max: number, strict: boolean): number {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.round(value);
  if (rounded < min || rounded > max) {
    if (strict) {
      throw new Error(`Numeric value must be between ${min} and ${max}.`);
    }

    return fallback;
  }

  return rounded;
}

function normalizeBoolean(input: unknown, fallback: boolean): boolean {
  return typeof input === "boolean" ? input : fallback;
}

function resolveSettingsPath(userDataPath: string): string {
  return path.join(userDataPath, SETTINGS_FILENAME);
}

function resolveSystemUsername(): string {
  try {
    return os.userInfo().username.trim();
  } catch {
    return "";
  }
}

function ensureSettingsFile(settingsPath: string, settings: AppSettings): void {
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    if (!fs.existsSync(settingsPath)) {
      fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    }
  } catch {
    // Ignore persistence bootstrap failures and continue with in-memory defaults.
  }
}

function loadLegacyConfig(options: LoadConfigOptions): {
  configPath: string | null;
  discordClientId: string;
  discordClientIdSource: LoadedAppSettings["discordClientIdSource"];
  workspaceRoots: string[];
} {
  const configPath = resolveLegacyConfigPath(options);
  const environmentClientId = process.env.DISCORD_CLIENT_ID?.trim() ?? "";

  if (!configPath) {
    return {
      configPath: null,
      discordClientId: environmentClientId,
      discordClientIdSource: environmentClientId ? "environment" : "missing",
      workspaceRoots: []
    };
  }

  const rawLegacyConfig = readJsonFile<Partial<AppConfig>>(configPath);
  const configDirectory = path.dirname(configPath);
  const discordClientId = (rawLegacyConfig.discordClientId ?? environmentClientId ?? "").trim();
  const workspaceRoots = Array.isArray(rawLegacyConfig.workspaceRoots)
    ? rawLegacyConfig.workspaceRoots
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => path.resolve(configDirectory, value))
    : [];

  return {
    configPath,
    discordClientId,
    discordClientIdSource: rawLegacyConfig.discordClientId ? "legacy-config" : discordClientId ? "environment" : "missing",
    workspaceRoots
  };
}

function resolveLegacyConfigPath(options: LoadConfigOptions): string | null {
  const searchDirectories = dedupeDirectories([
    ...(options.configSearchDirectories ?? []),
    options.appRoot
  ]);

  for (const directory of searchDirectories) {
    const candidate = path.join(directory, LEGACY_CONFIG_FILENAME);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const targetDirectory = searchDirectories[0] ?? options.appRoot;
  ensureLegacyConfigTemplate(path.join(targetDirectory, LEGACY_CONFIG_FILENAME));
  return null;
}

function ensureLegacyConfigTemplate(configPath: string): void {
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, LEGACY_CONFIG_TEMPLATE, "utf8");
    }
  } catch {
    // Ignore bootstrap failures and continue with environment lookup only.
  }
}

function dedupeDirectories(directories: string[]): string[] {
  const seen = new Set<string>();
  const resolvedDirectories: string[] = [];

  for (const directory of directories) {
    if (!directory) {
      continue;
    }

    const resolvedDirectory = path.resolve(directory);
    const key = resolvedDirectory.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    resolvedDirectories.push(resolvedDirectory);
  }

  return resolvedDirectories;
}

function validateDirectory(directoryPath: string, label: string): void {
  if (!fs.existsSync(directoryPath)) {
    throw new Error(`${label} does not exist: ${directoryPath}`);
  }

  const stats = fs.statSync(directoryPath);
  if (!stats.isDirectory()) {
    throw new Error(`${label} is not a directory: ${directoryPath}`);
  }
}

function readJsonFile<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) {
    return {} as T;
  }

  const rawText = fs.readFileSync(filePath, "utf8").trim();
  if (!rawText) {
    return {} as T;
  }

  try {
    return JSON.parse(rawText) as T;
  } catch {
    return {} as T;
  }
}
