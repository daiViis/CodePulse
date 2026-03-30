import path from "node:path";
import { normalizeProjectName } from "./utils";

const BRANCH_RULES: Array<{ keywords: string[]; phase: string }> = [
  { keywords: ["bugfix", "fix"], phase: "Bug Fixing" },
  { keywords: ["feature", "feat"], phase: "Feature Development" },
  { keywords: ["refactor"], phase: "Refactoring" },
  { keywords: ["test"], phase: "Testing" },
  { keywords: ["docs"], phase: "Documentation" },
  { keywords: ["chore", "build", "config"], phase: "Project Setup" }
];

const PATH_RULES: Array<{ keywords: string[]; phase: string }> = [
  { keywords: ["docs", "readme.md", "changelog", ".md"], phase: "Documentation" },
  { keywords: ["__tests__", "tests", "test", "spec", ".test.", ".spec."], phase: "Testing" },
  {
    keywords: [
      "package.json",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "tsconfig.json",
      "vite.config",
      "webpack.config",
      "eslint.config",
      "prettier.config",
      "dockerfile",
      "docker-compose",
      ".env",
      "config",
      "scripts",
      "build"
    ],
    phase: "Project Setup"
  },
  {
    keywords: [
      "components",
      "component",
      "ui",
      "pages",
      "page",
      "screens",
      "screen",
      "styles",
      "style",
      ".css",
      ".scss",
      ".sass",
      ".less",
      ".html",
      ".svg",
      ".tsx",
      ".jsx"
    ],
    phase: "UI Work"
  },
  {
    keywords: [
      "api",
      "server",
      "routes",
      "route",
      "controllers",
      "controller",
      "services",
      "service",
      "db",
      "database",
      "migration",
      "migrations",
      "prisma",
      ".sql"
    ],
    phase: "Backend"
  }
];

export function derivePhase(branch: string | null, recentPaths: string[]): string {
  const branchValue = (branch ?? "").toLowerCase();
  for (const rule of BRANCH_RULES) {
    if (rule.keywords.some((keyword) => branchValue.includes(keyword))) {
      return rule.phase;
    }
  }

  for (const recentPath of recentPaths) {
    const normalizedPath = recentPath.toLowerCase().replace(/\\/g, "/");
    for (const rule of PATH_RULES) {
      if (rule.keywords.some((keyword) => matchesKeyword(normalizedPath, keyword))) {
        return rule.phase;
      }
    }
  }

  return describeRecentWork(recentPaths[0] ?? "");
}

function matchesKeyword(normalizedPath: string, keyword: string): boolean {
  if (keyword.startsWith(".")) {
    return normalizedPath.endsWith(keyword) || normalizedPath.includes(keyword);
  }

  if (keyword.length <= 2) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword)}([^a-z0-9]|$)`, "i").test(normalizedPath);
  }

  return normalizedPath.includes(keyword);
}

function describeRecentWork(recentPath: string): string {
  if (!recentPath) {
    return "In Progress";
  }

  const parsed = path.parse(recentPath);
  const rawLabel = parsed.ext ? parsed.name : parsed.base || path.basename(recentPath);
  const cleanedLabel = rawLabel.replace(/[._-]+/g, " ").trim();
  const label = normalizeProjectName(cleanedLabel);

  if (!label) {
    return "In Progress";
  }

  return `Editing ${label}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
