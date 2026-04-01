import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface GitDiffStats {
  filesChanged: number;
  additions: number;
  deletions: number;
}

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

export function readGitDiffStats(repoRoot: string): GitDiffStats | null {
  try {
    const output = execFileSync("git", ["diff", "--shortstat"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000
    }).trim();

    if (!output) {
      return { filesChanged: 0, additions: 0, deletions: 0 };
    }

    // Example: " 2 files changed, 10 additions(+), 5 deletions(-)"
    const filesChangedMatch = /(\d+) file/.exec(output);
    const additionsMatch = /(\d+) insertion/.exec(output);
    const deletionsMatch = /(\d+) deletion/.exec(output);

    return {
      filesChanged: filesChangedMatch ? parseInt(filesChangedMatch[1], 10) : 0,
      additions: additionsMatch ? parseInt(additionsMatch[1], 10) : 0,
      deletions: deletionsMatch ? parseInt(deletionsMatch[1], 10) : 0
    };
  } catch {
    return null;
  }
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
