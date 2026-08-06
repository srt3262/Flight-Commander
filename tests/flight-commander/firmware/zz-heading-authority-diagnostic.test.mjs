import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const packageManifest = JSON.parse(
  readFileSync(join(projectRoot, 'package.json'), 'utf8'),
);
const firmwareVersion = packageManifest.flightCommander.firmwareSourceVersion;
const firmwareSourceArchive = packageManifest.flightCommander.firmwareSourceArchive;
const archive = join(projectRoot, ...firmwareSourceArchive.split('/'));
const output = mkdtempSync(
  join(tmpdir(), `flight-commander-${firmwareVersion}-heading-diagnostic-`),
);
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const extraction = spawnSync(
  python,
  ['-c', 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', archive, output],
  { encoding: 'utf8' },
);
assert.equal(
  extraction.status,
  0,
  `${firmwareVersion} source extraction failed:\n${extraction.stdout}\n${extraction.stderr}`,
);

const sourceRoot = join(output, `Flight-Commander-Firmware-Source-v${firmwareVersion}`);

after(() => rmSync(output, { recursive: true, force: true }));

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(?:c|h|cpp|hpp)$/i.test(entry.name) ? [path] : [];
    });
}

const patterns = [
  /heading.{0,24}(?:source|fusion|authority|valid|fresh|stale)/i,
  /(?:source|fusion|authority|valid|fresh|stale).{0,24}heading/i,
  /no[_ ]primary/i,
  /primary.{0,24}(?:source|authority)/i,
  /(?:source|sample).{0,24}(?:fresh|stale|timeout|timestamp|lastUpdate|last_update|updatedAt)/i,
  /(?:fresh|stale|timeout|timestamp|lastUpdate|last_update|updatedAt).{0,24}(?:source|sample)/i,
];

function scoreLine(line) {
  return patterns.reduce((score, pattern) => score + (pattern.test(line) ? 1 : 0), 0);
}

test(`${firmwareVersion} diagnostic: locate heading authority freshness implementation`, () => {
  const ranked = [];
  for (const path of sourceFiles(join(sourceRoot, 'src', 'main'))) {
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    const hits = [];
    let score = 0;
    lines.forEach((line, index) => {
      const lineScore = scoreLine(line);
      if (lineScore === 0) return;
      score += lineScore;
      hits.push({ line: index + 1, text: line.trim() });
    });
    if (score > 0) {
      const name = relative(sourceRoot, path).replaceAll('\\', '/');
      const filenameBonus = /heading|fusion/i.test(name) ? 5 : 0;
      ranked.push({ name, score: score + filenameBonus, lines, hits });
    }
  }

  ranked.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
  console.log(`HEADING_DIAGNOSTIC firmware=${firmwareVersion} files=${ranked.length}`);
  for (const candidate of ranked.slice(0, 24)) {
    console.log(`\n=== ${candidate.name} score=${candidate.score} ===`);
    const selected = new Set();
    for (const hit of candidate.hits.slice(0, 12)) {
      for (let line = Math.max(1, hit.line - 3); line <= Math.min(candidate.lines.length, hit.line + 3); line += 1) {
        selected.add(line);
      }
    }
    for (const line of [...selected].sort((a, b) => a - b)) {
      console.log(`${String(line).padStart(5)} | ${candidate.lines[line - 1]}`);
    }
  }

  assert.fail('Intentional diagnostic failure after printing heading-authority candidates.');
});
