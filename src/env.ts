import fs from "node:fs";
import path from "node:path";

const ENV_FILENAME = ".env";

let loadedSignature = "";
let lastDiagnostics: EnvLoadDiagnostics = {
  searchedFiles: [],
  loadedFiles: [],
  loadedKeys: []
};

export interface EnvLoadDiagnostics {
  searchedFiles: string[];
  loadedFiles: string[];
  loadedKeys: string[];
}

export function loadEnvironmentFiles(searchDirectories: string[]): void {
  const normalizedDirectories = dedupeDirectories(searchDirectories);
  const signature = normalizedDirectories.join("|").toLowerCase();
  if (signature === loadedSignature) {
    return;
  }

  const searchedFiles = normalizedDirectories.map((directory) => path.join(directory, ENV_FILENAME));
  const loadedFiles: string[] = [];
  const loadedKeys = new Set<string>();

  for (const directory of normalizedDirectories) {
    const envPath = path.join(directory, ENV_FILENAME);
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const parsed = parseEnvFile(fs.readFileSync(envPath, "utf8"));
    loadedFiles.push(envPath);
    for (const [key, value] of Object.entries(parsed)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }

      loadedKeys.add(key);
    }
  }

  lastDiagnostics = {
    searchedFiles,
    loadedFiles,
    loadedKeys: Array.from(loadedKeys).sort()
  };
  loadedSignature = signature;
}

export function getEnvironmentLoadDiagnostics(): EnvLoadDiagnostics {
  return {
    searchedFiles: [...lastDiagnostics.searchedFiles],
    loadedFiles: [...lastDiagnostics.loadedFiles],
    loadedKeys: [...lastDiagnostics.loadedKeys]
  };
}

function parseEnvFile(rawText: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = rawText.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    const rawValue = line.slice(separatorIndex + 1).trim();
    result[key] = stripWrappingQuotes(rawValue);
  }

  return result;
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function dedupeDirectories(directories: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const directory of directories) {
    if (!directory) {
      continue;
    }

    const resolved = path.resolve(directory);
    const key = resolved.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(resolved);
  }

  return result;
}
