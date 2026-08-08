# Firmware flashing

Firmware flashing writes the flight controller. A wrong image can make the
normal application firmware unbootable. Remove propellers, use stable USB
power, preserve a backup, and verify the hardware before continuing.

## Two firmware sources

### Online Flight Commander releases

**Load Firmware [Online]** lists only official and beta Flight Commander
firmware HEX assets published in this repository's GitHub Releases. Draft,
release-candidate, development, and bench-only assets are not offered. Repeated
copies of the same target and embedded firmware version are collapsed, with the
official canonical firmware release preferred.

Before an online image is enabled for flashing, Flight Commander requires:

- the canonical Flight Commander firmware filename;
- a supported firmware version and controller target;
- the compiled `FCFW` identity and matching embedded target when available;
- the selected/detected target to match the release descriptor; and
- the exact GitHub-published byte count and SHA-256 digest.

### Local Intel HEX

**Load Local Firmware** is an explicit expert/operator path. Flight Commander
parses the Intel HEX into writable address/data blocks, then enables flashing
without deciding whether the image is Flight Commander Firmware, whether its
filename or version is recognized, or whether its family or embedded target
matches the selected controller. The local file is flashed exactly as selected.

This allows recovery, development, and older/newer local builds without a
filename policy. It also removes the Configurator's ability to protect against
a wrong local target. The operator must verify the local image independently.

## Target selection

Target selection filters and validates online releases. It is also useful as an
operator reminder for local work, but it does not authorize or reject a local
HEX. Raw STM32 DFU exposes the processor bootloader and cannot reliably identify
the complete flight-controller design.

## Safe flash procedure

1. Export a Configurator backup and save CLI `diff all`.
2. Disconnect batteries, peripherals, and radios that can back-power the board.
3. Connect the board directly with a reliable USB cable.
4. For an online image, auto-detect or manually confirm the exact target and
   select an official or beta release.
5. For a local image, independently verify the intended MCU, board target,
   flash layout, and build provenance before selecting the HEX.
6. Enable full chip erase when the release or recovery procedure requires it.
7. Press **Flash Firmware** once. Do not disconnect or power down while
   erase/write/verify is active.
8. Reconnect after reboot and verify firmware identity, target, sensors, outputs,
   receiver, modes, failsafe, and configuration before any armed test.

## Erase and boot-sequence controls

- **Full chip erase** removes the existing configuration. Use it for clean
  recovery, major migrations, or when release instructions require it.
- **No reboot sequence** is for a controller already held in its hardware ROM
  bootloader by BOOT pins/button.
- **Manual baud rate** applies to serial bootloader paths; it is not used for
  USB DFU.

## Recovery when normal connection is lost

The STM32 ROM bootloader cannot be overwritten by normal firmware flashing.
Disconnect power, assert the documented BOOT condition, connect USB, confirm
the STM32 DFU device, and flash a local image that you have independently
verified for the exact board. Remove the BOOT condition and reconnect normally.
A successful DFU connection identifies the processor bootloader, not the full
flight-controller target.
