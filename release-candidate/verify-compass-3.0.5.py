#!/usr/bin/env python3
"""Structural verification for the Flight Commander 3.0.5 compass build."""

from __future__ import annotations

import hashlib
from pathlib import Path
import sys

EXPECTED_IDENTITY = b"FCFW" + bytes((1, 3, 0, 5, 9, 1, 0, 0xFF, 0x1F, 0, 0))
EXPECTED_TARGET = b"MICOAIR743"


def fail(message: str) -> None:
    raise ValueError(message)


def parse_intel_hex(path: Path) -> dict[int, int]:
    memory: dict[int, int] = {}
    upper_address = 0
    saw_eof = False

    for line_number, raw_line in enumerate(path.read_text(encoding="ascii").splitlines(), 1):
        line = raw_line.strip()
        if not line.startswith(":"):
            fail(f"{path}:{line_number}: invalid Intel HEX record")
        record = bytes.fromhex(line[1:])
        if len(record) < 5 or record[0] + 5 != len(record):
            fail(f"{path}:{line_number}: invalid byte count")
        if sum(record) & 0xFF:
            fail(f"{path}:{line_number}: checksum mismatch")

        count = record[0]
        address = (record[1] << 8) | record[2]
        record_type = record[3]
        data = record[4:4 + count]

        if record_type == 0x00:
            absolute = upper_address + address
            for offset, value in enumerate(data):
                memory[absolute + offset] = value
        elif record_type == 0x01:
            saw_eof = True
        elif record_type == 0x02:
            upper_address = int.from_bytes(data, "big") << 4
        elif record_type == 0x04:
            upper_address = int.from_bytes(data, "big") << 16
        elif record_type not in (0x03, 0x05):
            fail(f"{path}:{line_number}: unsupported record type {record_type}")

    if not saw_eof:
        fail(f"{path}: missing EOF record")
    return memory


def contains(memory: dict[int, int], expected: bytes) -> bool:
    first = expected[0]
    return any(
        value == first and all(memory.get(address + index) == byte
                               for index, byte in enumerate(expected))
        for address, value in memory.items()
    )


def main() -> int:
    path = Path(sys.argv[1]).resolve()
    memory = parse_intel_hex(path)
    if not contains(memory, EXPECTED_IDENTITY):
        fail("HEX does not contain the Flight Commander 3.0.5 identity")
    if not contains(memory, EXPECTED_TARGET):
        fail("HEX does not contain the MICOAIR743 target identity")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    print(f"Verified {path.name}: {path.stat().st_size} bytes; SHA-256 {digest}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, IndexError) as error:
        print(f"verification failed: {error}", file=sys.stderr)
        raise SystemExit(1)
