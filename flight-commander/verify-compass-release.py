#!/usr/bin/env python3
"""Structural verification for the Flight Commander 4.1.7 compass release build."""

from __future__ import annotations

import hashlib
from pathlib import Path
import sys

EXPECTED_IDENTITY = b"FCFW" + bytes((1, 4, 1, 7, 9, 1, 0, 0xFF, 0xFF, 0, 0))
EXPECTED_TARGET = b"MICOAIR743"


def fail(message: str) -> None:
    raise SystemExit(f"verification failed: {message}")


def parse_intel_hex(path: Path) -> dict[int, int]:
    if not path.is_file():
        fail(f"HEX file does not exist: {path}")

    memory: dict[int, int] = {}
    address_base = 0
    eof_seen = False

    for line_number, raw_line in enumerate(path.read_text(encoding="ascii").splitlines(), 1):
        line = raw_line.strip()
        if not line:
            continue
        if not line.startswith(":"):
            fail(f"line {line_number} is not an Intel HEX record")
        try:
            record = bytes.fromhex(line[1:])
        except ValueError as error:
            fail(f"line {line_number} is not valid hexadecimal: {error}")

        if len(record) < 5:
            fail(f"line {line_number} is too short")
        byte_count = record[0]
        if len(record) != byte_count + 5:
            fail(f"line {line_number} has an invalid byte count")
        if sum(record) & 0xFF:
            fail(f"line {line_number} has an invalid checksum")

        address = (record[1] << 8) | record[2]
        record_type = record[3]
        payload = record[4 : 4 + byte_count]

        if record_type == 0x00:
            absolute = address_base + address
            for offset, value in enumerate(payload):
                location = absolute + offset
                existing = memory.get(location)
                if existing is not None and existing != value:
                    fail(f"line {line_number} overlaps address 0x{location:08x} with different data")
                memory[location] = value
        elif record_type == 0x01:
            if byte_count != 0:
                fail(f"line {line_number} has malformed EOF data")
            eof_seen = True
            break
        elif record_type == 0x02:
            if byte_count != 2:
                fail(f"line {line_number} has malformed extended-segment data")
            address_base = int.from_bytes(payload, "big") << 4
        elif record_type == 0x04:
            if byte_count != 2:
                fail(f"line {line_number} has malformed extended-linear data")
            address_base = int.from_bytes(payload, "big") << 16
        elif record_type in (0x03, 0x05):
            # Start-address records do not contain image bytes.
            continue
        else:
            fail(f"line {line_number} uses unsupported record type 0x{record_type:02x}")

    if not eof_seen:
        fail("HEX has no EOF record")
    if not memory:
        fail("HEX contains no data records")
    return memory


def contains(memory: dict[int, int], needle: bytes) -> bool:
    if not needle:
        return True
    first = needle[0]
    for address, value in memory.items():
        if value != first:
            continue
        if all(memory.get(address + offset) == expected for offset, expected in enumerate(needle)):
            return True
    return False


def main() -> int:
    if len(sys.argv) != 2:
        fail("usage: verify-compass-release.py <firmware.hex>")

    path = Path(sys.argv[1]).resolve()
    memory = parse_intel_hex(path)
    if not contains(memory, EXPECTED_IDENTITY):
        fail("HEX does not contain the Flight Commander 4.1.7 identity and 0x0000ffff capability mask")
    if not contains(memory, EXPECTED_TARGET):
        fail("HEX does not contain the MICOAIR743 target identity")

    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    print(f"Verified Flight Commander 4.1.7 MICOAIR743 HEX: {path}")
    print(f"SHA-256: {digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
