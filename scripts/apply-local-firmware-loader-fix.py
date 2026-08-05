#!/usr/bin/env python3
"""Apply the filename-independent local Flight Commander firmware loader fix."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FLASHER = ROOT / "tabs/firmware_flasher.js"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count == 1:
        return text.replace(old, new, 1)
    if new in text and count == 0:
        return text
    raise RuntimeError(f"{label}: expected one replacement target, found {count}")


def main() -> None:
    text = FLASHER.read_text(encoding="utf-8")

    old_imports = """    flightCommanderReleaseDescriptors,
    normalizeFirmwareTarget,
    parseFlightCommanderFirmwareFilename,
    parsedHexContainsFlightCommanderIdentity,
    verifyFlightCommanderOnlinePayload,
"""
    new_imports = """    flightCommanderReleaseDescriptors,
    inferFlightCommanderFirmwareTarget,
    localFlightCommanderFirmwareDescriptor,
    normalizeFirmwareTarget,
    parsedHexContainsFlightCommanderIdentity,
    verifyFlightCommanderOnlinePayload,
"""
    text = replace_once(text, old_imports, new_imports, "firmware catalog imports")

    old_accept = """        function acceptParsedFirmware(data, { filename, descriptor = null, local = false } = {}) {
            if (!data) {
                rejectLoadedFirmware(i18n.getMessage('firmwareFlasherHexCorrupted'));
                return false;
            }

            const containsFlightCommanderIdentity =
                parsedHexContainsFlightCommanderIdentity(data);
            if (firmwareBackend === 'flight-commander') {
                const parsedFilename = descriptor || parseFlightCommanderFirmwareFilename(filename);
                if (!parsedFilename) {
                    rejectLoadedFirmware(
                        'This is not a recognized Flight Commander Firmware HEX filename. ' +
                        'Expected Flight-Commander-Firmware-<version>-<target>.hex.',
                    );
                    return false;
                }
                if (!containsFlightCommanderIdentity) {
                    rejectLoadedFirmware(
                        'The HEX does not contain the required FCFW firmware identity. ' +
                        'It cannot be flashed as Flight Commander Firmware.',
                    );
                    return false;
                }

                const imageTarget = normalizeFirmwareTarget(
                    parsedFilename.target_id || parsedFilename.target,
                );
                const selectedTarget = selectedFirmwareTarget();
                if (selectedTarget && selectedTarget !== '0' && selectedTarget !== imageTarget) {
                    rejectLoadedFirmware(
                        `Firmware target ${imageTarget} does not match the selected controller target ${selectedTarget}.`,
                    );
                    return false;
                }
                if (selectedTarget === '0') {
                    $('select[name="board"]').val(imageTarget).trigger('change');
                }
                loadedFirmwareDescriptor = parsedFilename;
            } else if (containsFlightCommanderIdentity) {
                rejectLoadedFirmware(
                    'This HEX contains the Flight Commander Firmware identity. ' +
                    'Select Flight Commander Firmware before flashing it.',
                );
                return false;
            } else {
                loadedFirmwareDescriptor = descriptor;
            }

            parsed_hex = data;
            localFirmwareLoaded = local;
            loadedFirmwareFamily = firmwareBackend;
            $('a.flash_firmware').removeClass('disabled');
            return true;
        }
"""
    new_accept = """        function acceptParsedFirmware(data, { filename, descriptor = null, local = false } = {}) {
            if (!data) {
                rejectLoadedFirmware(i18n.getMessage('firmwareFlasherHexCorrupted'));
                return false;
            }

            const containsFlightCommanderIdentity =
                parsedHexContainsFlightCommanderIdentity(data);
            if (firmwareBackend === 'flight-commander') {
                if (!containsFlightCommanderIdentity) {
                    rejectLoadedFirmware(
                        'The HEX does not contain the required FCFW firmware identity. ' +
                        'It cannot be flashed as Flight Commander Firmware.',
                    );
                    return false;
                }

                const selectedTarget = selectedFirmwareTarget();
                const embeddedTarget = inferFlightCommanderFirmwareTarget(data);
                let imageDescriptor = descriptor;

                if (local) {
                    imageDescriptor = localFlightCommanderFirmwareDescriptor(data, {
                        filename,
                        selectedTarget,
                    });
                    if (!imageDescriptor) {
                        rejectLoadedFirmware(
                            'The firmware family is valid, but its controller target could not be determined. ' +
                            'Select the controller target and load the local HEX again.',
                        );
                        return false;
                    }
                } else if (!imageDescriptor) {
                    rejectLoadedFirmware(
                        'The online firmware is missing its verified release descriptor.',
                    );
                    return false;
                }

                const imageTarget = normalizeFirmwareTarget(
                    imageDescriptor.target_id || imageDescriptor.target,
                );
                const knownImageTarget = FLIGHT_COMMANDER_FIRMWARE_TARGETS.some(
                    ({ id }) => id === imageTarget,
                );
                if (!knownImageTarget) {
                    rejectLoadedFirmware(
                        `Firmware target ${imageTarget || 'unknown'} is not supported by this Configurator.`,
                    );
                    return false;
                }

                if (!local && embeddedTarget && embeddedTarget !== imageTarget) {
                    rejectLoadedFirmware(
                        `The compiled firmware target ${embeddedTarget} does not match the verified online descriptor target ${imageTarget}.`,
                    );
                    return false;
                }
                if (
                    selectedTarget &&
                    selectedTarget !== '0' &&
                    selectedTarget !== imageTarget
                ) {
                    rejectLoadedFirmware(
                        `Firmware target ${imageTarget} does not match the selected controller target ${selectedTarget}.`,
                    );
                    return false;
                }
                if (selectedTarget === '0') {
                    $('select[name="board"]').val(imageTarget).trigger('change');
                }
                loadedFirmwareDescriptor = imageDescriptor;
            } else if (containsFlightCommanderIdentity) {
                rejectLoadedFirmware(
                    'This HEX contains the Flight Commander Firmware identity. ' +
                    'Select Flight Commander Firmware before flashing it.',
                );
                return false;
            } else {
                loadedFirmwareDescriptor = descriptor;
            }

            parsed_hex = data;
            localFirmwareLoaded = local;
            loadedFirmwareFamily = firmwareBackend;
            $('a.flash_firmware').removeClass('disabled');
            return true;
        }
"""
    text = replace_once(text, old_accept, new_accept, "local firmware acceptance")

    if "recognized Flight Commander Firmware HEX filename" in text:
        raise RuntimeError("filename-only rejection remains in the firmware loader")
    required = (
        "inferFlightCommanderFirmwareTarget(data)",
        "localFlightCommanderFirmwareDescriptor(data, {",
        "parsedHexContainsFlightCommanderIdentity(data)",
    )
    for token in required:
        if token not in text:
            raise RuntimeError(f"local firmware loader contract missing: {token}")

    FLASHER.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
