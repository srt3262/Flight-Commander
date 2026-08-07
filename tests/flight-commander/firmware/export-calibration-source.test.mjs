import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const output = mkdtempSync(join(tmpdir(), 'flight-commander-calibration-source-'));

try {
    const script = String.raw`
import re, sys, zipfile
from pathlib import Path
archive = Path(sys.argv[1])
out = Path(sys.argv[2])
with zipfile.ZipFile(archive) as z:
    z.extractall(out)
root = out / 'Flight-Commander-Firmware-Source-v4.0.7'
files = [
    'src/main/flight_commander/heading_fusion.c',
    'src/main/flight_commander/heading_fusion.h',
    'src/main/fc/fc_msp.c',
    'src/main/msp/msp_protocol_v2_flight_commander.h',
    'src/main/sensors/compass.c',
    'src/main/sensors/compass.h',
]
pattern = re.compile(r'calibrat|MAG_CALIBRATION|headingFusion.*Status|headingFusion.*Calibration|compass.*Calibration', re.I)
for relative in files:
    lines = (root / relative).read_text(encoding='utf-8').splitlines()
    matches = [(i + 1, line.strip()) for i, line in enumerate(lines) if pattern.search(line)]
    print(f'FILE {relative}')
    for number, line in matches[:160]:
        print(f'{number}: {line}')
`;
    const result = spawnSync(
        process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
        ['-c', script, join(projectRoot, 'release/firmware/Flight-Commander-Firmware-Source-v4.0.7.zip'), output],
        { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
    );
    console.log(result.stdout);
    console.error(result.stderr);
    assert.equal(result.status, 0);
} finally {
    rmSync(output, { recursive: true, force: true });
}

test('temporary calibration source inventory completed', () => {
    assert.ok(true);
});
