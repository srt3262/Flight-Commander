#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
import re
import sys

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
VERSION = '3.0.7'
FIRMWARE_SHA = 'd62ea585f9d4a3a4bbdb29e65caefa9675cd41a5440d42ec814d1cd8ca32df8f'
SOURCE_SHA = '4937ffe7cef7f97f60ec2c301340efe19de0f9f3ac33fccfa5379d88e5558306'
SOURCE_REVISION = '82de240d13b7e0882fdf0c9762b4c2ab0b3576ed'
SOURCE_TREE = 'ffed0dfc95fb9ab4b187c549f79922f4e3bd65b4'


def path(relative: str) -> Path:
    return ROOT / relative


def read(relative: str) -> str:
    return path(relative).read_text(encoding='utf-8')


def write(relative: str, text: str) -> None:
    target = path(relative)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding='utf-8', newline='\n')


def replace(relative: str, old: str, new: str, *, count: int = 1) -> None:
    text = read(relative)
    actual = text.count(old)
    if actual < count:
        raise SystemExit(f'{relative}: expected at least {count} copies of {old!r}, found {actual}')
    write(relative, text.replace(old, new, count))


def replace_all(relative: str, old: str, new: str) -> None:
    text = read(relative)
    if old not in text:
        raise SystemExit(f'{relative}: missing {old!r}')
    write(relative, text.replace(old, new))


def insert_after(relative: str, anchor: str, addition: str) -> None:
    text = read(relative)
    if addition.strip() in text:
        return
    if anchor not in text:
        raise SystemExit(f'{relative}: insertion anchor not found')
    write(relative, text.replace(anchor, anchor + addition, 1))


def insert_before(relative: str, anchor: str, addition: str) -> None:
    text = read(relative)
    if addition.strip() in text:
        return
    if anchor not in text:
        raise SystemExit(f'{relative}: insertion anchor not found')
    write(relative, text.replace(anchor, addition + anchor, 1))


package_path = path('package.json')
package = json.loads(package_path.read_text(encoding='utf-8'))
package['version'] = VERSION
fc = package['flightCommander']
fc.update({
    'firmwareReleaseVersion': VERSION,
    'firmwareReleaseSha256': FIRMWARE_SHA,
    'firmwareChangedInRelease': True,
    'firmwareSourceAvailable': True,
    'firmwareSourceVersion': VERSION,
    'firmwareSourceArchive': f'release/firmware/Flight-Commander-Firmware-Source-v{VERSION}.zip',
    'firmwareSourceSha256': SOURCE_SHA,
