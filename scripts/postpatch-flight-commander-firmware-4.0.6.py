#!/usr/bin/env python3
"""Finalize the learned-orientation patch before compiling Flight Commander 4.0.6.

Accelerometer/gyro motion determines axis permutation and relative signs, but a
candidate transform and complete XYZ inversion produce identical motion scores.
The IST8310 chip-native coordinate convention has the opposite handedness from
the INAV body frame used by this target, so only determinant-negative signed
permutations are physically admissible. This still learns all 24 possible board
mountings without hard-coding the board's actual sensor rotation.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one replacement target, found {count}")
    return text.replace(old, new, 1)


def insert_utils_include(text: str) -> str:
    if '#include "common/utils.h"' in text:
        return text
    return replace_once(
        text,
        '#include "common/time.h"\n',
        '#include "common/time.h"\n#include "common/utils.h"\n',
        'common utility include',
    )


def find_permutation_table(text: str) -> tuple[re.Match[str], str]:
    patterns = (
        r'(static const uint8_t\s+(?P<name>\w*[Pp]ermutation\w*)\s*\[\s*6\s*\]\s*\[[^\]]+\]\s*=\s*\{[\s\S]*?\n\};)',
        r'(static const uint8_t\s+(?P<name>\w+)\s*\[\s*6\s*\]\s*\[\s*3\s*\]\s*=\s*\{[\s\S]*?\n\};)',
    )
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match, match.group('name')
    raise RuntimeError('signed-axis permutation table was not found')


def add_handedness_filter(text: str) -> str:
    if 'transformHasRequiredHandedness' in text:
        return text

    table, _ = find_permutation_table(text)
    determinant_table = '''

// A transform and its complete XYZ inversion have identical six-side motion
// scores. Restrict the onboard IST8310 solver to the documented chip-native
// handedness class so the solver cannot store the 180-degree-inverted twin.
static const int8_t orientationPermutationDeterminant[6] = { 1, -1, -1, 1, 1, -1 };

static bool transformHasRequiredHandedness(uint8_t transform)
{
    if (transform >= FLIGHT_COMMANDER_COMPASS_ORIENTATION_TRANSFORM_COUNT) {
        return false;
    }

    const uint8_t signs = transform & 0x07U;
    const bool oddNegations =
        ((signs & (1U << X)) != 0) ^
        ((signs & (1U << Y)) != 0) ^
        ((signs & (1U << Z)) != 0);
    const int8_t signDeterminant = oddNegations ? -1 : 1;
    const uint8_t permutation = transform >> 3;

    return orientationPermutationDeterminant[permutation] * signDeterminant == -1;
}
'''
    text = text[:table.end()] + determinant_table + text[table.end():]

    loop_pattern = re.compile(
        r'(for\s*\(\s*uint8_t\s+transform\s*=\s*0\s*;\s*'
        r'transform\s*<\s*FLIGHT_COMMANDER_COMPASS_ORIENTATION_TRANSFORM_COUNT\s*;'
        r'\s*transform\+\+\s*\)\s*\{)'
    )
    loop = loop_pattern.search(text)
    if not loop:
        raise RuntimeError('orientation transform solver loop was not found')
    guard = '''
        if (!transformHasRequiredHandedness(transform)) {
            continue;
        }
'''
    text = text[:loop.end()] + guard + text[loop.end():]

    valid_match = re.search(
        r'(static bool\s+persistedOrientationValid\s*\([^\)]*\)\s*\{)([\s\S]*?\n\})',
        text,
    )
    if not valid_match:
        raise RuntimeError('persistedOrientationValid function was not found')
    body = valid_match.group(2)
    field = re.search(r'(?:config|value)->(?P<field>\w*[Tt]ransform\w*)', body)
    if not field:
        field = re.search(r'compassConfig\(\)->(?P<field>\w*[Tt]ransform\w*)', body)
        expression = f'compassConfig()->{field.group("field")}' if field else None
    else:
        expression = f'config->{field.group("field")}'
    if not expression:
        raise RuntimeError('persisted orientation transform field was not found')
    validity_guard = f'''\n    if (!transformHasRequiredHandedness({expression})) {{\n        return false;\n    }}\n'''
    text = text[:valid_match.start(2)] + validity_guard + text[valid_match.start(2):]
    return text


def write_solver_test(root: Path) -> None:
    path = root / 'flight-commander/test-compass-orientation-handedness.py'
    path.write_text('''#!/usr/bin/env python3
"""Regression checks for the onboard IST8310 signed-permutation contract."""

PERMUTATION_DETERMINANTS = (1, -1, -1, 1, 1, -1)


def determinant(transform: int) -> int:
    signs = transform & 7
    sign_det = -1 if sum(bool(signs & (1 << axis)) for axis in range(3)) % 2 else 1
    return PERMUTATION_DETERMINANTS[transform >> 3] * sign_det


def inverted(transform: int) -> int:
    return transform ^ 7


def main() -> None:
    admissible = [transform for transform in range(48) if determinant(transform) == -1]
    assert len(admissible) == 24
    assert 19 in admissible  # X=-nativeY, Y=-nativeX, Z=+nativeZ
    for transform in range(48):
        assert determinant(inverted(transform)) == -determinant(transform)
        assert (transform in admissible) != (inverted(transform) in admissible)
    print('24 IST8310-handedness transforms accepted; all 24 global-inversion twins rejected')


if __name__ == '__main__':
    main()
''', encoding='utf-8')
    path.chmod(0o755)


def extend_verifier(root: Path) -> None:
    verifier = root / 'flight-commander/verify-release.py'
    text = verifier.read_text(encoding='utf-8')
    if 'transformHasRequiredHandedness' not in text:
        marker = 'def verify_source(root: Path) -> None:\n'
        if marker not in text:
            raise RuntimeError('verify_source entry point was not found')
        insertion = '''def verify_compass_orientation_handedness(root: Path) -> None:
    source = (root / "src/main/flight_commander/compass_orientation.c").read_text(encoding="utf-8")
    required = (
        "orientationPermutationDeterminant",
        "transformHasRequiredHandedness",
        "if (!transformHasRequiredHandedness(transform))",
    )
    for marker in required:
        if marker not in source:
            raise RuntimeError(f"learned compass orientation is missing {marker}")


'''
        text = text.replace(marker, insertion + marker, 1)
        call_marker = marker + '    '
        if call_marker not in text:
            raise RuntimeError('verify_source body was not found')
        text = text.replace(call_marker, marker + '    verify_compass_orientation_handedness(root)\n    ', 1)
        verifier.write_text(text, encoding='utf-8')


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit('usage: postpatch-flight-commander-firmware-4.0.6.py SOURCE_ROOT')
    root = Path(sys.argv[1]).resolve()
    source = root / 'src/main/flight_commander/compass_orientation.c'
    text = source.read_text(encoding='utf-8')
    text = insert_utils_include(text)
    text = add_handedness_filter(text)
    source.write_text(text, encoding='utf-8')
    write_solver_test(root)
    extend_verifier(root)

    if '#include "common/utils.h"' not in text:
        raise RuntimeError('STATIC_ASSERT support include was not installed')
    if 'transformHasRequiredHandedness' not in text:
        raise RuntimeError('IST8310 handedness filter was not installed')
    print('Applied compile fix and determinant-negative IST8310 handedness constraint')


if __name__ == '__main__':
    main()
