import { readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const flightCommanderOnly = process.argv.includes("--flight-commander");
const testRoot = join(
  projectRoot,
  "tests",
  flightCommanderOnly ? "flight-commander" : "",
);

function collectTests(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectTests(path);
      }
      return /\.(?:test|spec)\.(?:cjs|mjs|js)$/.test(entry.name) ? [path] : [];
    });
}

if (!statSync(testRoot).isDirectory()) {
  throw new Error(`Test directory does not exist: ${testRoot}`);
}

const tests = collectTests(testRoot);
if (tests.length === 0) {
  throw new Error(`No Node test files found below ${testRoot}`);
}

console.log(
  `Running ${tests.length} ${flightCommanderOnly ? "Flight Commander " : ""}Node test files`,
);

const result = spawnSync(process.execPath, ["--test", ...tests], {
  cwd: projectRoot,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  const scope = flightCommanderOnly
    ? "Flight Commander Node tests"
    : "Node tests";
  console.error(`${scope} failed.`);
  process.exit(result.status ?? 1);
}

console.log(
  `Passed: ${tests.map((test) => relative(projectRoot, test)).join(", ")}`,
);
