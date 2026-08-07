#!/usr/bin/env python3
"""Finalize 4.0.8 compass contracts and require a valid transform before fusion."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def update_firmware_gate() -> None:
    path = ROOT / "dev/firmware-4.0.7-source/src/main/flight_commander/heading_fusion.c"
    replace_once(
        path,
        "static bool headingSourceIsCalibrated(unsigned index, const flightCommanderHeadingConfig_t *config)\n"
        "{\n"
        "    switch (index) {\n"
        "    case FLIGHT_COMMANDER_HEADING_ONBOARD_MAG:\n"
        "        return onboardMagIsCalibrated();\n"
        "    case FLIGHT_COMMANDER_HEADING_EXTERNAL_I2C_MAG:\n"
        "        return externalMagIsCalibrated(config);\n"
        "    case FLIGHT_COMMANDER_HEADING_DRONECAN_MAG:\n"
        "        return dronecanMagIsCalibrated(config) &&\n"
        "            (!samples[index].valid || samples[index].nodeID == config->dronecanMagCalibrationNodeID);\n"
        "    case FLIGHT_COMMANDER_HEADING_MOVING_BASELINE:\n"
        "        return samples[index].valid;\n"
        "    default:\n"
        "        return false;\n"
        "    }\n"
        "}\n",
        "static bool headingSourceOrientationIsValid(unsigned index)\n"
        "{\n"
        "#ifdef USE_FLIGHT_COMMANDER_COMPASS_ORIENTATION\n"
        "    if (index <= FLIGHT_COMMANDER_HEADING_DRONECAN_MAG) {\n"
        "        return flightCommanderCompassOrientationIsValid(index);\n"
        "    }\n"
        "#else\n"
        "    UNUSED(index);\n"
        "#endif\n"
        "    return true;\n"
        "}\n\n"
        "static bool headingSourceIsCalibrated(unsigned index, const flightCommanderHeadingConfig_t *config)\n"
        "{\n"
        "    switch (index) {\n"
        "    case FLIGHT_COMMANDER_HEADING_ONBOARD_MAG:\n"
        "        return onboardMagIsCalibrated();\n"
        "    case FLIGHT_COMMANDER_HEADING_EXTERNAL_I2C_MAG:\n"
        "        return headingSourceOrientationIsValid(index) && externalMagIsCalibrated(config);\n"
        "    case FLIGHT_COMMANDER_HEADING_DRONECAN_MAG:\n"
        "        return headingSourceOrientationIsValid(index) && dronecanMagIsCalibrated(config) &&\n"
        "            (!samples[index].valid || samples[index].nodeID == config->dronecanMagCalibrationNodeID);\n"
        "    case FLIGHT_COMMANDER_HEADING_MOVING_BASELINE:\n"
        "        return samples[index].valid;\n"
        "    default:\n"
        "        return false;\n"
        "    }\n"
        "}\n",
        "heading-fusion orientation safety gate",
    )
    replace_once(
        path,
        "bool flightCommanderHeadingCompassFieldCalibrated(uint8_t source)\n"
        "{\n"
        "    switch (source) {\n"
        "    case FLIGHT_COMMANDER_HEADING_ONBOARD_MAG:\n"
        "        return onboardMagIsCalibrated();\n"
        "    case FLIGHT_COMMANDER_HEADING_EXTERNAL_I2C_MAG:\n"
        "        return externalMagIsCalibrated(flightCommanderHeadingConfig());\n"
        "    case FLIGHT_COMMANDER_HEADING_DRONECAN_MAG:\n"
        "        return dronecanMagIsCalibrated(flightCommanderHeadingConfig());\n"
        "    default:\n"
        "        return false;\n"
        "    }\n"
        "}\n",
        "bool flightCommanderHeadingCompassFieldCalibrated(uint8_t source)\n"
        "{\n"
        "    if (!headingSourceOrientationIsValid(source)) {\n"
        "        return false;\n"
        "    }\n"
        "    switch (source) {\n"
        "    case FLIGHT_COMMANDER_HEADING_ONBOARD_MAG:\n"
        "        return onboardMagIsCalibrated();\n"
        "    case FLIGHT_COMMANDER_HEADING_EXTERNAL_I2C_MAG:\n"
        "        return externalMagIsCalibrated(flightCommanderHeadingConfig());\n"
        "    case FLIGHT_COMMANDER_HEADING_DRONECAN_MAG:\n"
        "        return dronecanMagIsCalibrated(flightCommanderHeadingConfig());\n"
        "    default:\n"
        "        return false;\n"
        "    }\n"
        "}\n",
        "field-calibrated orientation safety gate",
    )


def update_package_contract() -> None:
    path = ROOT / "tests/flight-commander/packaging/package-contract.test.mjs"
    replace_once(
        path,
        "  assert.match(calibrationHtml, /id=\"compassCalibrationList\"/);\n"
        "  assert.match(calibrationSource, /MSP_MAG_CALIBRATION/);\n",
        "  assert.match(calibrationHtml, /id=\"compassCalibrationSource\"/);\n"
        "  assert.match(calibrationHtml, /id=\"compassCalibrationSelected\"/);\n"
        "  assert.match(calibrationHtml, /id=\"compassFieldCalibrationStart\"/);\n"
        "  assert.match(calibrationHtml, /Six-Side Compass Orientation \\/ Alignment/);\n"
        "  assert.doesNotMatch(calibrationHtml, /all enabled compasses.*together/i);\n"
        "  assert.match(calibrationSource, /MSP_MAG_CALIBRATION/);\n"
        "  assert.match(calibrationSource, /COMPASS_ORIENTATION_COMMAND\\.SELECT/);\n"
        "  assert.match(calibrationSource, /sendCompassCalibrationCommand\\(target\\.index/);\n"
        "  assert.match(calibrationSource, /individualCompassCalibration/);\n",
        "package contract selected-source controls",
    )
    replace_once(
        path,
        "  assert.match(calibrationSource, /Replace invalid calibration/);\n",
        "  assert.match(calibrationSource, /Replace \\$\\{target\\.title\\} calibration/);\n",
        "package contract invalid-result replacement",
    )


def update_orientation_test() -> None:
    path = ROOT / "tests/flight-commander/firmware/compass-orientation.test.mjs"
    replace_once(
        path,
        "    assert.match(headingSource, /activeFieldCalibrationSource/);\n",
        "    assert.match(headingSource, /activeFieldCalibrationSource/);\n"
        "    assert.match(headingSource, /headingSourceOrientationIsValid/);\n"
        "    assert.match(headingSource, /headingSourceOrientationIsValid\\(index\\) && externalMagIsCalibrated/);\n"
        "    assert.match(headingSource, /headingSourceOrientationIsValid\\(index\\) && dronecanMagIsCalibrated/);\n"
        "    assert.match(headingSource, /if \\(!headingSourceOrientationIsValid\\(source\\)\\)/);\n",
        "orientation safety regression assertions",
    )


def main() -> None:
    update_firmware_gate()
    update_package_contract()
    update_orientation_test()
    print("Finalized Flight Commander 4.0.8 compass safety and release contracts")


if __name__ == "__main__":
    main()
