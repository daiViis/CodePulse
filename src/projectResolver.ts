import fs from "node:fs";
import path from "node:path";
import { findGitRoot } from "./git";
import { ResolvedProjectContext } from "./types";
import { normalizePathCase, normalizeProjectName } from "./utils";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".venv",
  "venv",
  "target",
  "bin",
  "obj",
  "out",
  ".idea",
  ".vs",
  ".vscode",
  ".codex",
  ".cursor",
  ".pytest_cache",
  ".svelte-kit",
  ".angular",
  ".gradle",
  ".terraform",
  "tmp",
  "temp"
]);

const PROJECT_MARKER_FILES = [
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "Gemfile",
  "mix.exs",
  "Package.swift"
];

const PROJECT_MARKER_EXTENSIONS = [".csproj", ".fsproj", ".vbproj"];
const IGNORED_FILE_SUFFIXES = [".log", ".tmp", ".temp", ".swp", ".swo", ".tsbuildinfo"];

export function isIgnoredPath(absolutePath: string, appRoot: string): boolean {
  const normalizedPath = normalizePathCase(absolutePath);
  const normalizedAppRoot = normalizePathCase(appRoot);

  if (normalizedPath === normalizedAppRoot || normalizedPath.startsWith(`${normalizedAppRoot}${path.sep}`)) {
    return true;
  }

  const baseName = path.basename(normalizedPath);
  if (baseName === "4913" || IGNORED_FILE_SUFFIXES.some((suffix) => baseName.endsWith(suffix))) {
    return true;
  }

  const segments = path.normalize(absolutePath).split(path.sep);
  return segments.some((segment) => IGNORED_DIRECTORIES.has(segment.toLowerCase()));
}

export function resolveProjectContext(
  absolutePath: string,
  workspaceRoots: string[],
  appRoot: string
): ResolvedProjectContext | null {
  if (isIgnoredPath(absolutePath, appRoot)) {
    return null;
  }

  const workspaceRoot = findContainingWorkspaceRoot(absolutePath, workspaceRoots);
  if (!workspaceRoot) {
    return null;
  }

  const startDirectory = resolveStartDirectory(absolutePath);
  const repoRoot = findGitRoot(startDirectory, workspaceRoot);
  const projectRoot = findOutermostProjectRoot(startDirectory, workspaceRoot);

  if (repoRoot) {
    return {
      workspaceRoot,
      projectRoot: repoRoot,
      repoRoot
    };
  }

  if (projectRoot) {
    return {
      workspaceRoot,
      projectRoot,
      repoRoot
    };
  }

  const relativePath = path.relative(workspaceRoot, absolutePath);
  const [firstSegment] = relativePath.split(path.sep).filter(Boolean);
  if (!firstSegment) {
    return null;
  }

  const defaultProjectRoot = path.join(workspaceRoot, firstSegment);
  if (normalizePathCase(defaultProjectRoot) === normalizePathCase(appRoot)) {
    return null;
  }

  return {
    workspaceRoot,
    projectRoot: defaultProjectRoot,
    repoRoot: null
  };
}

export function resolveProjectContextFromDirectory(
  directoryPath: string,
  appRoot: string
): ResolvedProjectContext | null {
  const resolvedPath = path.resolve(directoryPath);
  if (isIgnoredPath(resolvedPath, appRoot)) {
    return null;
  }

  const startDirectory = resolveStartDirectory(resolvedPath);
  if (!fs.existsSync(startDirectory)) {
    return null;
  }

  const fileSystemRoot = path.parse(startDirectory).root || startDirectory;
  const repoRoot = findGitRoot(startDirectory, fileSystemRoot);
  const projectRoot = findOutermostProjectRoot(startDirectory, fileSystemRoot);

  if (repoRoot) {
    return {
      workspaceRoot: startDirectory,
      projectRoot: repoRoot,
      repoRoot
    };
  }

  if (projectRoot) {
    return {
      workspaceRoot: startDirectory,
      projectRoot,
      repoRoot: null
    };
  }

  return {
    workspaceRoot: startDirectory,
    projectRoot: startDirectory,
    repoRoot: null
  };
}

export function deriveProjectName(projectRoot: string): string {
  return normalizeProjectName(path.basename(projectRoot));
}

function resolveStartDirectory(absolutePath: string): string {
  if (!fs.existsSync(absolutePath)) {
    return path.dirname(absolutePath);
  }

  const stats = fs.statSync(absolutePath);
  return stats.isDirectory() ? absolutePath : path.dirname(absolutePath);
}

function findOutermostProjectRoot(startDirectory: string, stopDirectory: string): string | null {
  let current = path.resolve(startDirectory);
  const stop = path.resolve(stopDirectory);
  let match: string | null = null;

  while (true) {
    if (hasProjectMarkers(current)) {
      match = current;
    }

    if (samePath(current, stop)) {
      return match;
    }

    const parent = path.dirname(current);
    if (samePath(parent, current)) {
      return match;
    }

    current = parent;
  }
}

function hasProjectMarkers(directory: string): boolean {
  if (PROJECT_MARKER_FILES.some((fileName) => fs.existsSync(path.join(directory, fileName)))) {
    return true;
  }

  try {
    return fs.readdirSync(directory).some((entry) =>
      PROJECT_MARKER_EXTENSIONS.some((extension) => entry.toLowerCase().endsWith(extension))
    );
  } catch {
    return false;
  }
}

function findContainingWorkspaceRoot(absolutePath: string, workspaceRoots: string[]): string | null {
  const normalizedPath = normalizePathCase(absolutePath);

  const matches = workspaceRoots
    .filter((root) => {
      const normalizedRoot = normalizePathCase(root);
      return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}${path.sep}`);
    })
    .sort((left, right) => right.length - left.length);

  return matches[0] ?? null;
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}
