import fs from "node:fs";
import path from "node:path";
import { AppConfig, LoadedConfig } from "./types";

const CONFIG_FILENAME = "watcher.config.json";

export function loadConfig(appRoot: string): LoadedConfig {
  const configPath = path.join(appRoot, CONFIG_FILENAME);

  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing config file: ${configPath}`);
  }

  const rawText = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(rawText) as Partial<AppConfig>;
  const discordClientId = (parsed.discordClientId ?? process.env.DISCORD_CLIENT_ID ?? "").trim();
  const workspaceRoots = (parsed.workspaceRoots ?? []).map((value) => path.resolve(value));
  const pollIntervalSeconds = Number(parsed.pollIntervalSeconds ?? 15);
  const inactivityTimeoutMinutes = Number(parsed.inactivityTimeoutMinutes ?? 30);

  validateConfig(
    {
      discordClientId,
      workspaceRoots,
      pollIntervalSeconds,
      inactivityTimeoutMinutes
    },
    configPath
  );

  return {
    appRoot,
    configPath,
    discordClientId,
    workspaceRoots,
    pollIntervalMs: pollIntervalSeconds * 1000,
    inactivityTimeoutMs: inactivityTimeoutMinutes * 60 * 1000
  };
}

function validateConfig(
  config: {
    discordClientId: string;
    workspaceRoots: string[];
    pollIntervalSeconds: number;
    inactivityTimeoutMinutes: number;
  },
  configPath: string
): void {
  if (!config.discordClientId || /PASTE_YOUR_DISCORD_APPLICATION_ID_HERE/i.test(config.discordClientId)) {
    throw new Error(
      `Set a real Discord application ID in ${configPath} under "discordClientId".`
    );
  }

  if (!config.workspaceRoots.length) {
    throw new Error(`Add at least one workspace root in ${configPath}.`);
  }

  for (const root of config.workspaceRoots) {
    if (!fs.existsSync(root)) {
      throw new Error(`Configured workspace root does not exist: ${root}`);
    }

    const stats = fs.statSync(root);
    if (!stats.isDirectory()) {
      throw new Error(`Configured workspace root is not a directory: ${root}`);
    }
  }

  if (!Number.isFinite(config.pollIntervalSeconds) || config.pollIntervalSeconds < 5 || config.pollIntervalSeconds > 300) {
    throw new Error(`"pollIntervalSeconds" must be between 5 and 300.`);
  }

  if (!Number.isFinite(config.inactivityTimeoutMinutes) || config.inactivityTimeoutMinutes < 1 || config.inactivityTimeoutMinutes > 1440) {
    throw new Error(`"inactivityTimeoutMinutes" must be between 1 and 1440.`);
  }
}
