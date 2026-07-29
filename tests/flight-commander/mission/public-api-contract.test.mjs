import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as acorn from "acorn";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function moduleExports(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const syntaxTree = acorn.parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
  });
  const exported = new Set();
  for (const declaration of syntaxTree.body) {
    if (declaration.type === "ExportDefaultDeclaration") {
      exported.add("default");
      continue;
    }
    if (declaration.type !== "ExportNamedDeclaration") continue;
    if (declaration.declaration?.id?.name) {
      exported.add(declaration.declaration.id.name);
    }
    for (const item of declaration.declaration?.declarations ?? []) {
      exported.add(item.id.name);
    }
    for (const specifier of declaration.specifiers) {
      exported.add(specifier.exported.name);
    }
  }
  return exported;
}

test("recovered Ground Control and Flight Planner imports are all exported", () => {
  for (const relativeTabPath of [
    "tabs/flight_planner.js",
    "tabs/flight_data.js",
  ]) {
    const tabPath = path.join(repositoryRoot, relativeTabPath);
    const source = fs.readFileSync(tabPath, "utf8");
    const syntaxTree = acorn.parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
    });
    for (const declaration of syntaxTree.body) {
      if (declaration.type !== "ImportDeclaration") continue;
      const specifier = declaration.source.value;
      if (
        !specifier.includes("/js/mission/") &&
        !specifier.includes("/js/maps/") &&
        !specifier.includes("/js/gcs/inavMissionProgress")
      ) {
        continue;
      }
      const modulePath = path.resolve(
        path.dirname(tabPath),
        specifier.endsWith(".js") ? specifier : `${specifier}.js`,
      );
      const exported = moduleExports(modulePath);
      for (const imported of declaration.specifiers) {
        const importedName =
          imported.type === "ImportDefaultSpecifier"
            ? "default"
            : imported.imported.name;
        assert.ok(
          exported.has(importedName),
          `${relativeTabPath} imports missing ${importedName} from ${specifier}`,
        );
      }
    }
  }
});
