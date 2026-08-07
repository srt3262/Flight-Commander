import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
]
for relative in files:
    path = root / relative
    lines = path.read_text(encoding='utf-8').splitlines()
    print(f'===== {relative} =====')
    matches = [i for i, line in enumerate(lines) if re.search(r'calibrat|MAG_CALIBRATION|HEADING_STATUS|heading.*status', line, re.I)]
    emitted = set()
    for index in matches:
        start = max(0, index - 10)
        end = min(len(lines), index + 18)
        key = (start, end)
        if key in emitted:
            continue
        emitted.add(key)
        print(f'--- lines {start + 1}-{end} ---')
        for number in range(start, end):
            print(f'{number + 1:04d}: {lines[number]}')
`;
    const result = spawnSync(
        process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
        ['-c', script, join(projectRoot, 'release/firmware/Flight-Commander-Firmware-Source-v4.0.7.zip'), output],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
    console.log(result.stdout);
    console.error(result.stderr);
    assert.equal(result.status, 0);
} finally {
    rmSync(output, { recursive: true, force: true });
}

test('temporary calibration source export completed', () => {
    assert.ok(true);
});
