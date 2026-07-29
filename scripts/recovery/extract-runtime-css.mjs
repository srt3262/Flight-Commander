#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import postcss from "postcss";

const runtimeRoot = path.resolve(process.argv[2] ?? "");
const projectRoot = path.resolve(process.argv[3] ?? process.cwd());
const assetsRoot = path.join(
  runtimeRoot,
  "resources",
  "app",
  ".vite",
  "renderer",
  "main_window",
  "assets",
);

const aggregateCss = fs
  .readdirSync(assetsRoot)
  .filter((name) => /^index-[\w-]+\.css$/.test(name))
  .sort();

if (aggregateCss.length !== 1) {
  throw new Error(
    `Expected one renderer CSS aggregate, found: ${aggregateCss.join(", ")}`,
  );
}

const selectorPattern =
  /(?:\.fc-|flight[_-](?:planner|data|hud)|mavlink|autotune|#protocol|#logo|\.flightCommander(?:Logo|Tagline)|mode-telemetry)/i;
const input = postcss.parse(
  fs.readFileSync(path.join(assetsRoot, aggregateCss[0]), "utf8"),
);

function filteredNodes(container) {
  const output = [];
  for (const node of container.nodes ?? []) {
    if (node.type === "rule" && selectorPattern.test(node.selector)) {
      output.push(node.clone());
      continue;
    }
    if (node.type === "atrule" && node.nodes) {
      const children = filteredNodes(node);
      if (children.length > 0) {
        const wrapper = node.clone({ nodes: [] });
        wrapper.append(children);
        output.push(wrapper);
      }
    }
  }
  return output;
}

const recovered = postcss.root();
recovered.append(
  postcss.comment({
    text: [
      "Flight Commander UI rules reconstructed from the verified 1.3.5 renderer.",
      "The exact HUD stylesheet is preserved separately in tabs/flight_hud-v1.3.5.css.",
    ].join("\n * "),
  }),
);
recovered.append(filteredNodes(input));

const targetPath = path.join(projectRoot, "src", "css", "flight-commander.css");
fs.mkdirSync(path.dirname(targetPath), { recursive: true });
fs.writeFileSync(targetPath, `${recovered.toString()}\n`, "utf8");
process.stdout.write(`${targetPath}\n`);
