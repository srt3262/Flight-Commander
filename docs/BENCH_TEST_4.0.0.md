# Flight Commander 4.0.0 dual-DroneCAN moving-baseline bench test

This procedure validates two Holybro DroneCAN H-RTK F9P Rover modules as one aircraft moving-baseline heading pair on the MICOAIR743 target. Perform the entire initial test with propellers removed and the aircraft secured.

## 1. Prepare the aircraft

1. Record a Flight Commander 3.0.7 configuration backup and screenshots of the working onboard-compass settings.
2. Mount both F9P modules rigidly. Measure the antenna phase-center separation, approximately center-to-center for the integrated patch antennas.
3. Decide which physical module is the **Moving Base on aircraft** and which is the **Moving Rover on aircraft**. Do not swap those identities after alignment is configured.
4. Wire both modules to the same CAN trunk: regulated 5 V, ground, CAN H, and CAN L.
5. Use 1 Mbit/s DroneCAN. Terminate only the two physical ends of the CAN trunk. Do not enable termination on both GPS modules merely because there are two modules; a hub, flight controller, or another end device may already provide termination.
6. Verify that the 5 V supply has adequate current capacity for both modules before applying aircraft power.

## 2. Install the coordinated 4.0.0 software

The bench-test bundle contains exactly four coordinated components:

- `FC-Windows-v4.0.0.zip`
- `FC-Configurator-Source-v4.0.0.zip`
- `FC-Firmware-v4.0.0-MICOAIR743.hex`
- `FC-Firmware-Source-v4.0.0.zip`

Extract the Windows archive into a new folder. Connect the flight controller over USB, select the MICOAIR743 target, load the 4.0.0 HEX, verify the firmware family and target, and flash it. A full-chip erase is appropriate for the first controlled 4.0.0 bench installation after preserving the 3.0.7 backup.

After reboot, reconnect over MSP and confirm that both Configurator and firmware report version 4.0.0. Recreate the minimum bench configuration deliberately rather than blindly restoring settings that control the new DroneCAN pair schema.

## 3. Bring up the DroneCAN bus

1. Open **Ports** and enable the CAN bus at **1000 kbit/s**.
2. Save and reboot.
3. Open **GPS / RTK** and select **Refresh CAN nodes**.
4. If either Holybro/AP_Periph module has `CAN_NODE=0`, Flight Commander should allocate a temporary unique node ID automatically. Both modules must appear as distinct GNSS nodes before pair configuration begins.
5. Confirm that the flight controller node ID does not duplicate either GPS node.

Stop here if either module repeatedly disappears, both appear under the same identity, the bus reports errors, or node discovery changes when wiring is touched.

## 4. Configure the pair in one operation

In **Holybro / AP_Periph two-node moving-baseline setup**:

1. Select the intended module under **Moving-base node**.
2. Select the other module under **Moving-rover node**.
3. Leave both termination controls at **Leave module setting unchanged** unless the physical CAN topology has been confirmed.
4. Keep **Require AP_Periph-compatible identity** enabled.
5. Select the moving rover as the normal DroneCAN navigation GPS for the first test.
6. Press **Configure and verify pair**.

Flight Commander should complete this sequence while the aircraft is disarmed:

1. Read both node identities and software versions.
2. Persist each currently assigned node ID to that module's `CAN_NODE` parameter.
3. Set the moving base to `GPS_TYPE=17`.
4. Set the moving rover to `GPS_TYPE=18`.
5. Set `GPS_AUTO_CONFIG=1` on both modules.
6. Apply an explicitly requested `CAN_TERMINATE` value, or leave it unchanged.
7. Save parameters on both nodes.
8. Restart both nodes.
9. Wait for both fixed node IDs to reconnect.
10. Read the parameters back and mark each role verified only when the values match.

A successful setup must show two different persistent node IDs, Base role verified, Rover role verified, no service timeout, and both modules online after another complete aircraft power cycle.

## 5. Configure moving-baseline heading

1. Enable **Moving-baseline GNSS yaw**.
2. Set **Relative-heading input** to **DroneCAN RelPosHeading**.
3. Enter the measured antenna separation.
4. Use a small but realistic allowed length error. It must remain smaller than the expected baseline.
5. Set a conservative maximum heading-accuracy limit for initial testing.
6. Keep **Require fixed relative-baseline solution** enabled initially.
7. In **Alignment Tool**, select the dual-antenna pair and align the displayed **Base → Rover** arrow with the actual aircraft installation.
8. Save and reboot.

The modules need a clear satellite view to produce a live carrier-phase relative solution. Indoor node discovery and role configuration can succeed even when relative heading remains unavailable.

## 6. Initial heading-source policy

For the first hardware test:

- Moving-baseline GNSS yaw: priority 1, weight 100.
- Onboard MICOAIR743 IST8310: priority 2, non-zero fallback weight.
- Other external magnetic sources: disabled unless they are intentionally being evaluated.
- Every enabled, non-zero-weight source must have a unique priority.

The onboard IST8310 remains at user alignment **CW 0°**. Flight Commander firmware preserves the accepted target transform:

```text
X = -native Y
Y = -native X
Z =  native Z
```

Do not copy that transform to either DroneCAN module or to the dual-antenna alignment.

## 7. Static and dynamic validation

With the aircraft disarmed and propellers removed:

1. Place the aircraft on a known heading and compare onboard-compass, relative-heading, and fused-heading values.
2. Rotate slowly through 360 degrees. Confirm smooth wraparound without reversals or 180-degree role errors.
3. Pitch and roll the complete aircraft while keeping yaw approximately fixed. Heading should remain stable within the accuracy and installation limits.
4. Compare reported baseline distance with the physical measurement.
5. Confirm that reported heading accuracy and message age remain within the configured guards.
6. Power-cycle the complete aircraft at least three times. The same node IDs and roles must return without repeating setup.
7. Disconnect or depower the moving base. Relative heading must become stale/rejected and the onboard compass must take authority without a large heading jump.
8. Restore the base, then repeat the test by disconnecting the rover.
9. Temporarily block satellite view or remove correction quality. A non-fixed, stale, inaccurate, or geometrically implausible relative solution must be rejected rather than fused.
10. Review Blackbox and Configurator diagnostics for node loss, service timeouts, heading-source rejection, baseline mismatch, and authority changes.

## 8. Do not proceed to controlled flight until

- Both modules retain unique static node IDs after power cycling.
- Base and rover role readback passes repeatedly.
- The rover publishes fresh `ardupilot.gnss.RelPosHeading` data outdoors.
- Reported baseline distance agrees with the physical installation.
- The Base → Rover alignment produces the correct aircraft heading.
- Heading remains stable during roll and pitch tests.
- Loss of either module produces clean rejection and onboard-compass fallback.
- The accepted 3.0.7 onboard-compass behavior remains unchanged under 4.0.0.
- No unexplained CAN bus-off, service-timeout, or node-identity changes remain.

Record screenshots of the pair status, alignment, heading-source table, and GPS/RTK state, plus the exact Configurator and firmware versions, with every test report.
