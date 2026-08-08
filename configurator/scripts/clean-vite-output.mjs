import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultProjectRoot = resolve(dirname(scriptPath), "..");

export function cleanViteOutput(projectRoot = defaultProjectRoot) {
  for (const outputRoot of [".vite/build", ".vite/renderer"]) {
    rmSync(resolve(projectRoot, outputRoot), {
      recursive: true,
      force: true,
    });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  cleanViteOutput();
}
