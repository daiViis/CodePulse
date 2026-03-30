import path from "node:path";

export function normalizePathCase(value: string): string {
  return path.normalize(value).toLowerCase();
}

export function normalizeProjectName(rawName: string): string {
  const spaced = rawName
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();

  return spaced
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (/^[A-Z0-9]+$/.test(word)) {
        return word;
      }

      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

export function dedupeRecentPaths(paths: string[], nextPath: string, maxItems: number): string[] {
  const normalizedNext = normalizePathCase(nextPath);
  const next = [nextPath];

  for (const existing of paths) {
    if (normalizePathCase(existing) !== normalizedNext) {
      next.push(existing);
    }

    if (next.length >= maxItems) {
      break;
    }
  }

  return next;
}
