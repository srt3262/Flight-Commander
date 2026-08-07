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

def section(relative, first, last):
    lines = (root / relative).read_text(encoding='utf-8').splitlines()
    print(f'===== {relative} lines {first}-{last} =====')
    for number in range(first, min(last, len(lines)) + 1):
        print(f'{number:04d}: {lines[number - 1]}')

section('src/main/flight_commander/heading_fusion.c', 330, 545)
section('src/main/flight_commander/heading_fusion.c', 930, 980)
section('src/main/flight_commander/heading_fusion.h', 1, 115)
section('src/main/msp/msp_protocol_v2_flight_commander.h', 1, 180)

fc = (root / 'src/main/fc/fc_msp.c').read_text(encoding='utf-8').splitlines()
print('===== src/main/fc/fc_msp.c Flight Commander cases =====')
for index, line in enumerate(fc):
    if 'MSP2_FLIGHT_COMMANDER' in line or 'MSP_MAG_CALIBRATION' in line:
        first = max(0, index - 5)
        last = min(len(fc), index + 13)
        print(f'--- {first + 1}-{last} ---')
        for number in range(first, last):
            print(f'{number + 1:04d}: {fc[number]}')

print('===== capability declarations =====')
patterns = re.compile(r'CAPABIL|capabil|0x7FFF|0xFFFF|FCFW')
for path in sorted((root / 'src/main').rglob('*')):
    if not path.is_file() or path.suffix not in {'.c', '.h'}:
        continue
    try:
        lines = path.read_text(encoding='utf-8').splitlines()
    except UnicodeDecodeError:
        continue
    matches = [(i + 1, line.strip()) for i, line in enumerate(lines) if patterns.search(line)]
    if matches:
        relative = path.relative_to(root).as_posix()
        for number, line in matches[:40]:
            print(f'{relative}:{number}: {line}')
`;
    const result = spawnSync(
        process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
        ['-c', script, join(projectRoot, 'release/firmware/Flight-Commander-Firmware-Source-v4.0.7.zip'), output],
        { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
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
