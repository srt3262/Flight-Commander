#!/usr/bin/env python3
from pathlib import Path

ROOT = Path.cwd()

replacements = {
    "tests/flight-commander/firmware/uart-rtk-gps-ui.test.mjs": [
        ("/Active INAV target/", "/Active Flight Commander target/"),
    ],
    "tests/flight-commander/packaging/package-contract.test.mjs": [
        (
            "/Active INAV target magnetometer alignment/",
            "/Active Flight Commander target magnetometer alignment/",
        ),
    ],
}

for relative, pairs in replacements.items():
    path = ROOT / relative
    content = path.read_text(encoding="utf-8")
    for old, new in pairs:
        if old not in content:
            if new not in content:
                raise RuntimeError(f"{relative}: missing expected test wording {old!r}")
            continue
        content = content.replace(old, new)
    path.write_text(content, encoding="utf-8", newline="\n")

print("Updated Flight Commander 4.1.2 alignment wording assertions.")
