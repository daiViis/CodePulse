const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const copyTargets = [
  {
    source: path.join(projectRoot, "src", "renderer"),
    destination: path.join(projectRoot, "dist", "renderer")
  },
  {
    source: path.join(projectRoot, "src", "assets"),
    destination: path.join(projectRoot, "dist", "assets")
  }
];

for (const { source, destination } of copyTargets) {
  if (!fs.existsSync(source)) {
    continue;
  }

  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}
