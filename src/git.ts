import fs from "node:fs";
import path from "node:path";

export function findGitRoot(startDirectory: string, stopDirectory: string): string | null {
  let current = path.resolve(startDirectory);
  const stop = path.resolve(stopDirectory);

  while (true) {
    if (hasGitMetadata(current)) {
      return current;
    }

    if (samePath(current, stop)) {
      return null;
    }

    const parent = path.dirname(current);
    if (samePath(parent, current)) {
      return null;
    }

    current = parent;
  }
}

export function readBranchName(repoRoot: string): string | null {
  const gitDirectory = resolveGitDirectory(repoRoot);
  if (!gitDirectory) {
    return null;
  }

  const headPath = path.join(gitDirectory, "HEAD");
  if (!fs.existsSync(headPath)) {
    return null;
  }

  const head = fs.readFileSync(headPath, "utf8").trim();
  const refMatch = /^ref:\s+refs\/heads\/(.+)$/i.exec(head);
  if (refMatch) {
    return refMatch[1];
  }

  if (head.length >= 7) {
    return `detached:${head.slice(0, 7)}`;
  }

  return null;
}

function resolveGitDirectory(repoRoot: string): string | null {
  const dotGitPath = path.join(repoRoot, ".git");
  if (!fs.existsSync(dotGitPath)) {
    return null;
  }

  const stats = fs.statSync(dotGitPath);
  if (stats.isDirectory()) {
    return dotGitPath;
  }

  const fileContents = fs.readFileSync(dotGitPath, "utf8").trim();
  const gitDirMatch = /^gitdir:\s*(.+)$/i.exec(fileContents);
  if (!gitDirMatch) {
    return null;
  }

  return path.resolve(repoRoot, gitDirMatch[1]);
}

function hasGitMetadata(directory: string): boolean {
  return fs.existsSync(path.join(directory, ".git"));
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}
