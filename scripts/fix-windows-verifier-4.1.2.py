#!/usr/bin/env python3
from pathlib import Path

ROOT = Path.cwd()


def update(relative: str, replacements: list[tuple[str, str]]) -> None:
    path = ROOT / relative
    content = path.read_text(encoding="utf-8")
    for old, new in replacements:
        if old not in content:
            if new and new not in content:
                raise RuntimeError(f"{relative}: missing expected verifier text {old!r}")
            continue
        content = content.replace(old, new)
    path.write_text(content, encoding="utf-8", newline="\n")


update(
    "scripts/verify-windows-package.mjs",
    [
        (
            '  "Flash only firmware built for the detected controller target",\n',
            '  "Flash only Flight Commander Firmware built for the detected controller target",\n',
        ),
        ('  "ArduPilot support has been removed",\n', ''),
    ],
)

update(
    "tests/flight-commander/packaging/package-contract.test.mjs",
    [
        (
            '  assert.match(packageVerifier, /ArduPilot support has been removed/);',
            '  assert.doesNotMatch(packageVerifier, /ArduPilot support has been removed/);\n'
            '  assert.match(\n'
            '    packageVerifier,\n'
            '    /Flash only Flight Commander Firmware built for the detected controller target/,\n'
            '  );',
        ),
    ],
)

print("Aligned Windows package verification with the Flight Commander-only policy.")
