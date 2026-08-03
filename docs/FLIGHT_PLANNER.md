# Flight Planner

Flight Planner creates, validates, imports, exports, reads, and writes missions.
It can be used offline; transfer controls become available only on a supported
aircraft connection.

## Start a plan

1. Select the map layer and move to the operating area.
2. Establish a home/reference location deliberately. Offline planning must not
   infer home from invalid `(0,0)` telemetry.
3. Add mission points in order and choose the correct command/action for each.
4. Enter altitude using the displayed unit system and confirm whether each
   value is relative to home or absolute/terrain-derived.
5. Set cruise speed and completion behavior where available.
6. Run validation before saving or transferring.

## Mission items

Flight Commander preserves the native INAV-compatible mission representation.
Common map items include navigation waypoints, return/land actions, and
supported photo-trigger actions. A command that cannot be represented without
losing required information is rejected before transfer.

Avoid placing takeoff, landing, return, or action-only commands as if they were
ordinary map points. Review the item list as well as the route line.

## Survey grids

Survey planning converts a polygon and camera/spacing choices into a waypoint
grid.

- Draw a valid non-self-intersecting survey boundary.
- Choose altitude, line spacing, orientation, overshoot, and entry behavior.
- When distance-based photo triggering is supported, configure trigger spacing
  and verify start/stop placement.
- Inspect turn geometry and total mission size before upload.
- Confirm the aircraft can safely perform the generated turns at the selected
  speed and altitude.

Regenerate the grid after changing the polygon or capture parameters; editing a
display field does not necessarily rewrite already generated points.

## Terrain following

Flight Planner can request elevations from the configured online provider or a
supported local source. Terrain data can contain voids, coarse cells, outdated
surface information, or service failures.

1. Load and inspect the elevation profile for the whole route.
2. Choose relative-home or absolute altitude semantics intentionally.
3. Apply required clearance above the terrain profile.
4. Reject or repair missing elevation samples.
5. Verify the resulting absolute and relative altitude ranges against aircraft
   limits and local airspace.

Terrain-relative waypoint transfer is Flight Commander capability-gated.
Official INAV compatibility receives only the lossless navigation subset.

## Read and write missions

- **Read from aircraft** replaces or merges only as explicitly described by the
  UI; save the current local plan first.
- **Write to aircraft** validates every item and then reads back/verifies where
  the transport supports confirmation.
- Wired MSP is the native persistent mission-storage path.
- MAVLink transfer is limited to the representable, validated subset plus
  advertised Flight Commander extensions.
- LTM cannot transfer missions.

After upload, read the mission back and compare item count, order, coordinates,
altitudes, and actions.

## Files and interchange

Use Flight Commander's named mission format for lossless round trips. Imported
third-party files are normalized and validated; fields that cannot be mapped
must produce an error instead of being discarded silently.

Keep the original source file and a post-upload readback with date, aircraft,
firmware version, and mission purpose.

## Start, resume, and abort

Planning a mission does not start it. Operational actions are in Ground Control.

- Start uses the validated stored mission.
- Resume is limited to the same powered flight-controller session and requires
  the aircraft/mission checkpoint to match after reconnection.
- Abort exits active AUTO behavior through the supported safe mode path; it
  does not delete the stored mission.

Power loss invalidates the same-session interruption checkpoint. See
[Ground Control](GROUND_CONTROL.md).

## Mission safety review

- Confirm home, datum, altitude reference, and units.
- Inspect every item and the route between items.
- Check terrain, obstacles, airspace, geozones, and radio/GNSS coverage.
- Ensure return and landing behavior fit the site.
- Confirm mission length fits firmware and energy limits.
- Keep a tested manual/assisted takeover and abort method.
