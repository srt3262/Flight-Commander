# Firmware flashing

Firmware flashing writes the flight controller. A wrong hardware target can
make the normal application firmware unbootable. Remove propellers, use stable
USB power, and preserve a backup before continuing.

## Flight Commander Firmware only

The Firmware Flasher has no firmware-family selector. It accepts only Flight
Commander Firmware images that:

- contain the compiled `FCFW` identity;
- identify a controller target supported by this Configurator;
- match the selected or detected target; and
- for online assets, match the published size and SHA-256 descriptor.

A local HEX without the FCFW identity is rejected rather than offered as a
reduced-functionality or cross-family option.

## Firmware sources

1. **Load Firmware [Online]** downloads the selected Flight Commander release
   asset and verifies its published size and SHA-256 before accepting it.
2. **Load Local Firmware** opens a `.hex` file from the computer and validates
   its FCFW identity and target metadata.
3. **Flash Firmware** writes only the image that has already passed validation.

A failed online download does not silently substitute another image. Reload the
correct online asset or deliberately choose a local Flight Commander HEX.

## Detect and verify the target

When application firmware responds, **Auto-select Target** reads the board
identity and then requires a valid versioned FCFW response. Inherited MSP
variant fields are transport details; by themselves they do not authorize the
controller or stock firmware.

Raw STM32 DFU exposes the processor bootloader but cannot reliably report the
complete board model. In DFU, manually select the exact hardware target and
verify it against the board documentation and the last known connected target.
Target aliases do not make different boards interchangeable.

## Choose a firmware version

The version list contains published Flight Commander Firmware assets available
for the selected target. A Configurator-only release may reuse an older verified
firmware image under that image's truthful embedded version. Configurator and
firmware must still remain in the same major release series. See
[Flight Commander versioning](FLIGHT_COMMANDER_VERSIONING.md).

## Erase and boot-sequence controls

- **Full chip erase** removes the existing configuration. Use it for clean
  recovery, major migrations, or when release instructions require it.
- **No reboot sequence** is for a controller already held in its hardware ROM
  bootloader by BOOT pins/button. It is not a general connection fix.
- **Manual baud rate** applies to serial bootloader paths that require it; it is
  not used for USB DFU.

## Safe flash procedure

1. Export a Configurator backup and save CLI `diff all`.
2. Disconnect batteries, peripherals, and radios that can back-power the board.
3. Connect the board directly with a reliable USB cable.
4. Auto-detect or manually confirm the exact target.
5. Select a published version or load a local Flight Commander HEX.
6. Confirm the displayed target, version, source, and FCFW validation result.
7. Enable full erase when required.
8. Press **Flash Firmware** once. Do not disconnect or power down while
   erase/write/verify is active.
9. Reconnect after reboot and verify Flight Commander Firmware identity,
   version, target, and capabilities before restoring configuration.
10. Restore selectively. Do not paste a complete old dump blindly across a
    major firmware change.

## Recovery when normal connection is lost

The STM32 ROM bootloader cannot be overwritten by normal firmware flashing.
For a board that no longer starts application firmware:

1. Disconnect power.
2. Hold the board's BOOT button or bridge the documented boot pads.
3. Connect USB while keeping BOOT asserted as required by the board.
4. Confirm the STM32 DFU device and driver in Windows.
5. Select the exact target manually, enable **No reboot sequence**, and use full
   chip erase when a clean recovery is required.
6. Load a valid target-matched Flight Commander FCFW image, flash, and verify.
7. Remove the BOOT condition and reconnect normally.

If the target is uncertain, stop. A successful DFU connection identifies the
processor bootloader, not the complete flight-controller design.
