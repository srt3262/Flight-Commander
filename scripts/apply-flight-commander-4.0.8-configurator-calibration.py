#!/usr/bin/env python3
"""Wire the Flight Commander 4.0.8 per-source compass calibration UI transport."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    result, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected one regex match, found {count}")
    return result


def update_msp_helper() -> None:
    path = ROOT / "js/msp/MSPHelper.js"
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        "import {\n    decodeCompassOrientationStatus,\n    encodeCompassOrientationCommand,\n} from './../flightCommander/compassOrientation';\n",
        "import {\n    decodeCompassOrientationStatus,\n    encodeCompassOrientationCommand,\n} from './../flightCommander/compassOrientation';\n"
        "import { encodeCompassCalibrationCommand } from './../flightCommander/compassCalibration';\n",
        "compass calibration encoder import",
    )
    text = replace_once(
        text,
        "            case MSPCodes.MSP2_FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND:\n"
        "                console.log('Flight Commander compass-orientation command accepted');\n"
        "                break;",
        "            case MSPCodes.MSP2_FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND:\n"
        "                console.log('Flight Commander compass-orientation command accepted');\n"
        "                break;\n\n"
        "            case MSPCodes.MSP2_FLIGHT_COMMANDER_COMPASS_CALIBRATION_COMMAND:\n"
        "                console.log('Flight Commander source-selective compass calibration command accepted');\n"
        "                break;",
        "targeted calibration response case",
    )
    text = regex_once(
        text,
        r"    self\.sendCompassOrientationCommand = function \(command, callback\) \{.*?\n    \};",
        "    self.sendCompassOrientationCommand = function (command, source, callback) {\n"
        "        if (typeof source === 'function') {\n"
        "            callback = source;\n"
        "            source = 0;\n"
        "        }\n"
        "        MSP.send_message(\n"
        "            MSPCodes.MSP2_FLIGHT_COMMANDER_COMPASS_ORIENTATION_COMMAND,\n"
        "            [...encodeCompassOrientationCommand(command, source)],\n"
        "            false,\n"
        "            callback,\n"
        "        );\n"
        "    };\n\n"
        "    self.sendCompassCalibrationCommand = function (source, callback) {\n"
        "        MSP.send_message(\n"
        "            MSPCodes.MSP2_FLIGHT_COMMANDER_COMPASS_CALIBRATION_COMMAND,\n"
        "            [...encodeCompassCalibrationCommand(source)],\n"
        "            false,\n"
        "            callback,\n"
        "        );\n"
        "    };",
        "source-aware MSP helpers",
    )
    path.write_text(text, encoding="utf-8")


def update_css() -> None:
    path = ROOT / "src/css/tabs/calibration.css"
    text = path.read_text(encoding="utf-8")
    marker = "/* Flight Commander 4.0.8 source-selective compass calibration */"
    if marker in text:
        return
    text += r'''

/* Flight Commander 4.0.8 source-selective compass calibration */
.compass-source-selector {
    display: grid;
    gap: 6px;
    margin: 0 0 10px;
}

.compass-source-selector > span {
    color: #9eb4bf;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.tab-calibration .compass-source-selector select {
    width: 100%;
    min-height: 36px;
    box-sizing: border-box;
    border: 1px solid rgba(153, 178, 190, 0.45);
    border-radius: 5px;
    background: rgba(19, 36, 46, 0.92);
    color: #e6f0f4;
    padding: 6px 9px;
}

.tab-calibration .compass-source-selector select:disabled {
    opacity: 0.55;
}

#compassCalibrationSelected {
    margin-bottom: 9px;
}

#compassFieldCalibrationStart {
    width: 100%;
}

.modal-compass-source {
    color: inherit;
}
'''
    path.write_text(text, encoding="utf-8")


def main() -> None:
    update_msp_helper()
    update_css()
    print("Applied Flight Commander 4.0.8 Configurator compass transport and styling")


if __name__ == "__main__":
    main()
