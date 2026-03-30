import path from "node:path";
import { loadConfig } from "./config";
import { PresenceWatcherApp } from "./watcherApp";

async function main(): Promise<void> {
  const appRoot = path.resolve(__dirname, "..");
  const config = loadConfig(appRoot);
  const watcher = new PresenceWatcherApp(config);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[watcher] Shutting down after ${signal}.`);
    await watcher.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await watcher.start();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[watcher] Startup failed: ${message}`);
  process.exit(1);
});
