#!/usr/bin/env python3
"""Apply the automatic compass-orientation prototype to Configurator sources.

This script is intentionally idempotent. It is used on the draft implementation
branch to make narrowly anchored edits while the firmware protocol is developed
against the retained 4.0.5 source archive.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER = "FLIGHT_COMMANDER_AUTO_COMPASS_VECTOR_MATCHING"


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def write(relative: str, text: str) -> None:
    (ROOT / relative).write_text(text, encoding="utf-8", newline="\n")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one anchor, found {count}")
    return text.replace(old, new, 1)


def function_span(text: str, names: tuple[str, ...]) -> tuple[int, int]:
    start = -1
    selected = ""
    for name in names:
        match = re.search(rf"(?:export\s+)?function\s+{re.escape(name)}\s*\(", text)
        if match:
            start = match.start()
            selected = name
            break
    if start < 0:
        raise RuntimeError(f"Unable to locate any decoder function: {names}")
    opening = text.find("{", start)
    depth = 0
    quote: str | None = None
    escaped = False
    for index in range(opening, len(text)):
        char = text[index]
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in {"'", '"', "`"}:
            quote = char
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return start, index + 1
    raise RuntimeError(f"Unterminated function {selected}")


def patch_heading_decoder() -> None:
    relative = "js/flightCommander/headingFusion.js"
    text = read(relative)
    if MARKER in text:
        return
    start, end = function_span(
        text,
        (
            "decodeHeadingStatus",
            "decodeFlightCommanderHeadingStatus",
            "decodeHeadingFusionStatus",
        ),
    )
    body = text[start:end]
    view_match = re.search(r"(?:const|let)\s+(\w+)\s*=\s*new\s+DataView\s*\(", body)
    if not view_match:
        raise RuntimeError("heading status decoder does not expose a DataView")
    view = view_match.group(1)
    if not re.search(r"\boffset\b", body):
        raise RuntimeError("heading status decoder does not expose offset")
    anchor = body.rfind("return result;")
    if anchor < 0:
        raise RuntimeError("heading status decoder does not return result")
    extension = f"""
    // {MARKER}: optional 4.0.6+ status tail. Older firmware ends before it.
    if ({view}.byteLength - offset >= 11) {{
        result.compassOrientation = {{
            state: {view}.getUint8(offset),
            candidateIndex: {view}.getUint8(offset + 1),
            failure: {view}.getUint8(offset + 2),
            confidence: {view}.getUint8(offset + 3),
            facesMask: {view}.getUint8(offset + 4),
            samples: {view}.getUint16(offset + 5, true),
            residualCentidegrees: {view}.getUint16(offset + 7, true),
            marginCentidegrees: {view}.getUint16(offset + 9, true),
        }};
        offset += 11;
    }}

    """
    body = body[:anchor] + extension + body[anchor:]
    write(relative, text[:start] + body + text[end:])


def patch_calibration_tab() -> None:
    relative = "tabs/calibration.js"
    text = read(relative)
    if MARKER in text:
        return

    import_anchor = """import {
    compassCalibrationState,
    enumerateCompassCalibrationTargets,
} from './../js/flightCommander/compassCalibration';
"""
    import_replacement = import_anchor + """import {
    compassOrientationPresentation,
} from './../js/flightCommander/compassOrientation';
"""
    text = replace_once(text, import_anchor, import_replacement, "calibration import")

    vector_anchor = """    function renderCompassTargets() {
        const targets = compassTargets();
        const session = calibrationTab.compassSession;
        const $list = $('#compassCalibrationList').empty();
"""
    vector_replacement = """    function renderCompassOrientationWorkflow() {
        // FLIGHT_COMMANDER_AUTO_COMPASS_VECTOR_MATCHING
        const presentation = compassOrientationPresentation(
            FC.HEADING_STATUS,
            FC.getAccelerometerCalibrated(),
        );
        let $panel = $('#compassOrientationWorkflow');
        if ($panel.length === 0) {
            $panel = $('<article>')
                .attr('id', 'compassOrientationWorkflow')
                .addClass('compass-calibration-card compass-orientation-workflow')
                .insertBefore('#compassCalibrationList');
        }
        $panel
            .removeClass('is-ready is-warning is-error is-working')
            .addClass(`is-${presentation.tone}`)
            .empty()
            .append($('<strong>').text(presentation.title))
            .append($('<p>').text(presentation.detail));
        return presentation;
    }

    function renderCompassTargets() {
        const targets = compassTargets();
        const session = calibrationTab.compassSession;
        const orientation = renderCompassOrientationWorkflow();
        const $list = $('#compassCalibrationList').empty();
"""
    text = replace_once(text, vector_anchor, vector_replacement, "orientation workflow renderer")

    button_anchor = """                .addClass('compass-calibrate-button')
                .prop('disabled', Boolean(session))
                .text(
                    session
                        ? 'Calibration in progress…'
                        : target.invalidCalibration
                            ? 'Replace invalid calibration'
                            : 'Calibrate this compass',
                )
"""
    button_replacement = """                .addClass('compass-calibrate-button')
                .prop('disabled', Boolean(session) || orientation.buttonDisabled)
                .text(
                    session
                        ? 'Calibration in progress…'
                        : target.invalidCalibration
                            ? 'Replace invalid calibration'
                            : orientation.supported
                                ? orientation.buttonLabel
                                : 'Calibrate this compass',
                )
"""
    text = replace_once(text, button_anchor, button_replacement, "calibration button state")

    start_anchor = """    function startCompassCalibration(event) {
        event.preventDefault();
        if (calibrationTab.compassSession) return;
        const sourceIndex = Number(event.currentTarget.dataset.compassCalibrate);
"""
    start_replacement = """    function startCompassCalibration(event) {
        event.preventDefault();
        if (calibrationTab.compassSession) return;
        const orientation = compassOrientationPresentation(
            FC.HEADING_STATUS,
            FC.getAccelerometerCalibrated(),
        );
        if (orientation.buttonDisabled) {
            GUI.log(`<span class=\"error\">${orientation.detail}</span>`);
            renderCompassTargets();
            return;
        }
        const sourceIndex = Number(event.currentTarget.dataset.compassCalibrate);
"""
    text = replace_once(text, start_anchor, start_replacement, "calibration start guard")

    log_anchor = """        MSP.send_message(MSPCodes.MSP_MAG_CALIBRATION, false, false, function () {
            GUI.log(`Compass calibration started from ${target.title}; every enabled physical compass is being solved.`);
        });
"""
    log_replacement = """        MSP.send_message(MSPCodes.MSP_MAG_CALIBRATION, false, false, function () {
            const orientation = compassOrientationPresentation(
                FC.HEADING_STATUS,
                FC.getAccelerometerCalibrated(),
            );
            GUI.log(
                orientation.supported
                    ? `${orientation.buttonLabel} started from ${target.title}. Magnetic AHRS correction is suspended while firmware learns the physical mapping.`
                    : `Compass calibration started from ${target.title}; every enabled physical compass is being solved.`,
            );
        });
"""
    text = replace_once(text, log_anchor, log_replacement, "calibration start log")
    write(relative, text)


def main() -> None:
    patch_heading_decoder()
    patch_calibration_tab()
    print("Automatic compass Configurator prototype applied.")


if __name__ == "__main__":
    main()
