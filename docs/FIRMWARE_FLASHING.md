# Firmware flashing

Firmware flashing writes the flight controller. A wrong family or hardware
target can make the normal application firmware unbootable. Remove propellers,
use stable USB power, and preserve a backup before continuing.

## The three firmware actions

Flight Commander separates source selection from flashing:

1. **Select Local Firmware File** opens a `.hex` file from the computer and
   validates its family, embedded identity, and target metadata.
2. **Download Online Firmware** downloads the selected compatible release from
   Flight Commander's GitHub release catalog. The downloaded image becomes the
   current selection; it is not flashed immediately.
3. **Flash Selected Firmware** writes the already selected and validated image.

When GitHub is unavailable, **Use Offline Firmware Copy** can select the exact
verified image packaged with the Configurator. An offline copy is a fallback,
not a claim that it is newer than a published online image.

## Select firmware family

- **Flight Commander Firmware** accepts only images carrying the Flight
  Commander `FCFW` identity and a recognized Flight Commander release name.
- **Official INAV Firmware** uses the official INAV catalog and rejects images
  that carry the Flight Commander identity.

Family choice does not convert firmware. It changes the catalog and the
validation policy.

## Detect and verify the target

When application firmware responds, **Auto-select Target** queries the board
and accepts both the inherited `INAV` identity and Flight Commander's `FCFW`
identity. The target field must match the physical board.

Raw STM32 DFU exposes the processor bootloader but cannot reliably report the
board model. In that state, manually select the exact hardware target and
verify it against the board documentation and the previously connected target.
Target aliases such as a historical spelling do not make different boards
interchangeable.

## Choose a firmware version

The version list can contain:

- an **Online release**, downloadable from GitHub;
- an **Offline fallback**, packaged and checksum-verified with Configurator;
- a **Local file**, chosen by the operator.

When an online and offline image have the same target and version, the online
release is presented as the primary catalog entry. The offline copy remains
available only if download fails or the operator explicitly chooses it.

Configurator and firmware can have different minor/patch versions only for a
declared software-only Configurator release. The HEX filename and embedded
firmware identity must always tell the truth. See
[Flight Commander versioning](FLIGHT_COMMANDER_VERSIONING.md).

## Erase and boot sequence controls

- **Full chip erase** removes the existing configuration. Use it for clean
  recovery, major migrations, or when release instructions require it.
- **No reboot sequence** is for a controller already held in its hardware ROM
  bootloader by BOOT pins/button. It is not a general connection fix.
- **Manual baud rate** applies to serial bootloader paths that require it; it is
  not used for USB DFU.

## Safe flash procedure

1. Export a Configurator backup and save CLI `diff all`.
2. Disconnect batteries, peripherals, and radios that can back-power the board.
3. Connect the board directly by a reliable USB cable.
4. Select the correct firmware family.
5. Auto-detect or manually confirm the exact target.
6. Choose an online version, local HEX, or offline fallback.
7. Read the selection summary and confirm family, target, version, and source.
8. Enable full erase when required.
9. Press **Flash Selected Firmware** once. Do not disconnect or power down while
   erase/write/verify is active.
10. Reconnect after reboot and verify firmware family, version, target, and
    capabilities before restoring configuration.
11. Restore selectively. Do not paste a complete old dump blindly across a
    major firmware change.

## Recovery when normal connection is lost

The STM32 ROM bootloader cannot be overwritten by normal firmware flashing.
For a board that no longer starts application firmware:

1. Disconnect power.
2. Hold the board's BOOT button or bridge the documented boot pads.
3. Connect USB while keeping BOOT asserted as required by the board.
4. Confirm the STM32 DFU device and driver in Windows.
5. Select the exact target manually, enable **No reboot sequence**, and use full
   chip erase for a clean recovery.
6. Flash and verify, then remove the BOOT condition and reconnect normally.

If the target is uncertain, stop. A successful DFU connection identifies the
processor bootloader, not the complete flight-controller design.
