#!/usr/bin/env python3
"""Structural verification for Flight Commander 4.3.2 release images."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
VERSION = "4.3.2"
VERSION_PARTS = (4, 3, 2)
INAV_VERSION_PARTS = (9, 1, 0)
TARGET_MANIFEST = ROOT / "flight-commander" / "official-targets.txt"
RELEASE_MANIFEST = ROOT / "RELEASE-MANIFEST.json"


def fail(message: str) -> None:
    raise SystemExit(f"verification failed: {message}")


def load_target_contracts() -> dict[str, dict[str, int]]:
    release_manifest = json.loads(RELEASE_MANIFEST.read_text(encoding="utf-8"))
    if release_manifest.get("version") != VERSION:
        fail(f"release manifest is not Flight Commander {VERSION}")
    masks = release_manifest.get("capability_masks")
    if not isinstance(masks, dict):
        fail("release manifest capability masks are missing")
    if any(
        not re.fullmatch(r"0x[0-9a-f]{8}", str(masks.get(key, "")))
        for key in ("base", "dronecan")
    ):
        fail("release manifest capability masks are invalid")
    try:
        base_capabilities = int(str(masks["base"]), 16)
        dronecan_capabilities = int(str(masks["dronecan"]), 16)
    except (KeyError, TypeError, ValueError):
        fail("release manifest capability masks are invalid")
    if not 0 <= base_capabilities <= 0xFFFFFFFF:
        fail("base capability mask is outside the 32-bit identity field")
    if not 0 <= dronecan_capabilities <= 0xFFFFFFFF:
        fail("DroneCAN capability mask is outside the 32-bit identity field")
    if base_capabilities & ~dronecan_capabilities:
        fail("DroneCAN capability mask does not include every base capability")

    contracts: dict[str, dict[str, int]] = {}
    for line_number, raw_line in enumerate(
        TARGET_MANIFEST.read_text(encoding="utf-8").splitlines(), 1
    ):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        fields = line.split("|")
        if len(fields) != 3:
            fail(f"target manifest line {line_number} is malformed")
        target, mcu, dronecan_mode = fields
        if not re.fullmatch(r"[A-Za-z0-9_]+", target):
            fail(f"target manifest has invalid target name {target}")
        if target in contracts:
            fail(f"target manifest contains duplicate target {target}")
        if mcu not in {"STM32H743XI", "STM32H757XI"}:
            fail(f"target manifest uses unsupported MCU {mcu} for {target}")
        if dronecan_mode != "NONE" and dronecan_mode != "TARGET" and not re.fullmatch(
            r"P[A-K][0-9]{1,2},P[A-K][0-9]{1,2}", dronecan_mode
        ):
            fail(f"target manifest has invalid DroneCAN mapping for {target}")
        base = 0x08020000 if mcu == "STM32H757XI" else 0x08000000
        contracts[target] = {
            "base": base,
            "bootloader_end": base,
            "capabilities": (
                base_capabilities
                if dronecan_mode == "NONE"
                else dronecan_capabilities
            ),
        }
    if len(contracts) != 50:
        fail(f"target manifest contains {len(contracts)} targets; expected 50")
    return contracts


def expected_identity(capabilities: int) -> bytes:
    return (
        b"FCFW"
        + bytes((1, *VERSION_PARTS, *INAV_VERSION_PARTS))
        + capabilities.to_bytes(4, "little")
    )


def parse_intel_hex(path: Path) -> tuple[dict[int, int], list[int]]:
    if not path.is_file():
        fail(f"HEX file does not exist: {path}")

    memory: dict[int, int] = {}
    address_base = 0
    eof_seen = False
    start_addresses: list[int] = []

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
        elif record_type == 0x03:
            if byte_count != 4:
                fail(f"line {line_number} has malformed start-segment data")
            start_addresses.append((int.from_bytes(payload[:2], "big") << 4) + int.from_bytes(payload[2:], "big"))
        elif record_type == 0x05:
            if byte_count != 4:
                fail(f"line {line_number} has malformed start-linear data")
            start_addresses.append(int.from_bytes(payload, "big"))
        else:
            fail(f"line {line_number} uses unsupported record type 0x{record_type:02x}")

    if not eof_seen:
        fail("HEX has no EOF record")
    if not memory:
        fail("HEX contains no data records")
    return memory, start_addresses


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
    memory, start_addresses = parse_intel_hex(path)
    filename = re.fullmatch(
        rf"Flight-Commander-Firmware-{re.escape(VERSION)}-(.+)\.hex", path.name
    )
    if filename is None:
        fail(f"HEX filename does not use the canonical {VERSION} release format")
    target = filename.group(1)
    target_contracts = load_target_contracts()
    contract = target_contracts.get(target)
    if contract is None:
        fail(f"HEX filename identifies unknown official target {target}")
    capabilities = contract["capabilities"]
    if not contains(memory, expected_identity(capabilities)):
        fail(
            f"HEX does not contain the Flight Commander {VERSION} identity "
            f"and 0x{capabilities:08x} capability mask"
        )
    if not contains(memory, target.encode("ascii") + b"\0"):
        fail(f"HEX does not contain the exact {target} target identity")
    base = contract["base"]
    if min(memory) != base:
        fail(f"{target} image begins at 0x{min(memory):08x}; expected 0x{base:08x}")
    if any(address < contract["bootloader_end"] for address in memory):
        fail(f"{target} image writes inside its protected bootloader region")
    if start_addresses != [base]:
        fail(f"{target} start address is {start_addresses}; expected [0x{base:08x}]")

    stack_pointer = int.from_bytes(bytes(memory.get(base + offset, 0) for offset in range(4)), "little")
    reset_handler = int.from_bytes(bytes(memory.get(base + 4 + offset, 0) for offset in range(4)), "little")
    if not 0x20000000 <= stack_pointer < 0x40000000:
        fail(f"{target} vector table has invalid initial stack pointer 0x{stack_pointer:08x}")
    if not (reset_handler & 1) or not base <= (reset_handler & ~1) < 0x08200000:
        fail(f"{target} vector table has invalid reset handler 0x{reset_handler:08x}")

    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    print(f"Verified Flight Commander {VERSION} {target} HEX: {path}")
    print(f"SHA-256: {digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
