# Automatic compass-to-IMU vector matching

## Purpose

Flight Commander must not depend on a target-specific hard-coded axis swap or
sign inversion to translate an onboard compass into the IMU body frame. The
firmware instead learns and saves the compass-to-IMU rotation while the aircraft
is deliberately rotated during compass calibration.

The learned mapping is a physical sensor-to-IMU layer. It is independent of the
user-editable installation alignment in the Alignment tab, which remains a
later rotation and must never rewrite the learned mapping.

## Observability

A calibrated accelerometer supplies a trustworthy gravity direction, but gravity
alone cannot observe rotation about the vertical axis. The automatic procedure
therefore uses the complete IMU:

- calibrated accelerometer data anchors roll and pitch;
- gyro integration supplies relative yaw motion during the short learning pass;
- magnetometer correction is disabled in the attitude estimator while the
  compass mapping is being learned, preventing a wrong mapping from biasing its
  own solution.

A stationary pose is insufficient. The calibration workflow requires broad
three-dimensional rotation and rejects results without adequate pose coverage.

## Coordinate layers

The runtime order is:

1. The compass driver converts register values into the sensor's documented,
   right-handed canonical coordinate system. This is a sensor protocol rule,
   not a board orientation.
2. Native hard-iron offsets and diagonal gains are applied.
3. The learned proper rotation maps the canonical compass frame into the IMU
   body frame.
4. The saved user installation alignment is applied.
5. Tilt compensation and heading fusion consume the resulting body-frame vector.

For the IST8310, the existing generic canonical conversion remains in the
sensor driver. The MICOAIR743-only signed permutation is removed from the
runtime driver path after a learned mapping is available.

## Solver

The first implementation searches all 24 right-handed signed permutation
matrices. These represent every orthogonal way a board-mounted three-axis sensor
can be installed while excluding reflections.

For sample `i`:

- `s_i` is the calibrated unit magnetic vector in the canonical sensor frame;
- `R_WB_i` is the body-to-world rotation from the accelerometer/gyro-only IMU;
- `P_c` is candidate compass-to-body rotation `c`.

The candidate world-frame magnetic vector is:

```
w_i(c) = R_WB_i * P_c * s_i
```

The correct candidate makes `w_i(c)` nearly constant because the local Earth
magnetic field does not rotate with the aircraft. Each candidate is scored by
angular residual about its mean world vector. The best candidate is accepted
only when all of these gates pass:

- accelerometer calibration is valid and gyro bias is settled;
- enough synchronized samples were collected;
- gravity and rotation coverage span the required axes;
- magnetic magnitude remains physically plausible;
- best-candidate residual is below the configured limit;
- separation from the second-best candidate exceeds the ambiguity margin.

A failed or ambiguous pass never overwrites the last verified solution.

## Calibration sequence

The Configurator presents one guided operation:

1. Verify that accelerometer calibration is complete.
2. Start **Identify orientation and calibrate compass**.
3. Rotate the complete aircraft slowly through yaw, pitch and roll, reaching all
   six broad face directions.
4. Firmware records synchronized canonical magnetometer vectors and
   accelerometer/gyro-only attitude samples.
5. Firmware solves native offsets/gains, scores the 24 mappings, and commits the
   mapping and calibration atomically only if every acceptance gate passes.
6. The Configurator reports coverage, sample count, residual, confidence,
   learned axis mapping and any rejection reason.

Re-running the operation refines the magnetic calibration and can replace the
mapping only with another fully accepted result.

## Persistence and safety

Saved data includes:

- solver contract revision;
- learned candidate index;
- orientation-valid flag;
- calibration offsets and gains;
- residual, ambiguity margin and coverage diagnostics;
- a signature covering sensor identity, learned orientation, user alignment,
  offsets and gains.

Changing the learned orientation, sensor identity, or user alignment invalidates
an incompatible calibration signature. Until a valid mapping exists, the
onboard compass is visible for calibration diagnostics but is not allowed to
become a heading-fusion authority.

During learning, arming is blocked and magnetic AHRS correction is suppressed.
A reboot or aborted session leaves the previous verified mapping untouched.

## Configurator states

The Calibration tab distinguishes:

- **Orientation required** — no verified mapping; heading contribution blocked;
- **Learning** — live face coverage, samples and elapsed time;
- **Verified** — learned axis mapping, residual and confidence;
- **Rejected** — explicit reason such as insufficient coverage, disturbed field,
  excessive residual or ambiguous candidates.

The Alignment tab continues to expose only the user installation adjustment. It
does not display or edit the physical learned sensor-to-IMU matrix.

## Initial acceptance thresholds

The beta implementation starts conservatively:

- at least 160 accepted synchronized samples;
- at least five of six gravity-face bins, including both signs on at least two
  axes;
- at least 180 degrees cumulative rotation about each of two nonparallel axes;
- magnetic magnitude spread no greater than 25 percent after calibration;
- best-candidate RMS residual no greater than 12 degrees;
- second-best RMS residual at least 5 degrees worse than the best candidate.

Thresholds are firmware constants in the first beta and are reported in status
telemetry so bench results can be evaluated before making them configurable.
