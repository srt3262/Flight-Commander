# Tuning

Tuning changes control response and stability. Begin from a known airframe
preset, preserve a working profile, collect logs, and change one related group
at a time. A bench-safe value is not automatically flight-safe.

## Before tuning

- Complete mechanical inspection, motor/prop balance, sensor mounting,
  calibration, alignment, receiver setup, modes, failsafe, and navigation.
- Confirm motor order/direction with propellers removed.
- Eliminate clipping, loose frames, resonances, and electrical noise before
  attempting to filter them in software.
- Save a configuration backup and note the active control/mixer profile.
- Enable an appropriate Blackbox logging device and verify a readable log.

## Profiles

Control profiles isolate PID/rate/filter values; mixer and battery profiles
have separate ownership. Flight Commander's profile highlighting helps show
which controls change when a selector changes. Verify the selected profile
before every edit and before exporting a comparison log.

## PID workflow

Use small steps and evaluate roll, pitch, and yaw separately.

- **P** increases immediate correction. Too low feels soft; too high can create
  rapid oscillation and heat.
- **I** resists sustained disturbances and holds attitude/course. Too low can
  drift; too high can wind up or recover poorly.
- **D** damps rapid changes but amplifies high-frequency noise and can heat
  motors.
- **Feedforward** anticipates commanded movement; excessive feedforward can
  overshoot or make stick response harsh.

Fixed-wing and multirotor controls can expose different axes and semantics.
Use the labels and ranges returned by the connected firmware.

## Rates and expo

Rates define maximum commanded rotation and expo shapes center-stick response.
Set receiver endpoints and centers first. Test a conservative maximum rate and
increase only when the airframe and pilot can recover comfortably.

## Filters

Filters trade latency for noise reduction.

- Main gyro and D-term low-pass filters suppress high-frequency noise.
- Dynamic notch/matrix filtering tracks changing resonance frequencies.
- RPM filtering requires valid motor telemetry and correct motor pole count.
- Raising cutoffs reduces delay but passes more noise; lowering cutoffs reduces
  noise but adds delay.

Use Blackbox spectra and motor temperature, not sound alone. Stop immediately
if motors become abnormally hot.

## Rate Dynamics

Rate Dynamics changes how commanded rate develops between center-stick and the
ends of travel. Sensitivity values alter the amount of dynamic response;
correction values shape overshoot/damping behavior. Start at the preset/default
values, change one axis/group in small increments, and compare identical flight
maneuvers in logs.

Do not use Rate Dynamics to conceal incorrect feedforward, filtering, receiver
expo, or mechanical oscillation.

## Advanced Tuning

Advanced Tuning includes navigation/control mechanics, I-term relaxation,
anti-gravity, D-boost, TPA, fixed-wing trim/response, and other target-dependent
controls. Each feature changes a specific control regime. Enable it only after
the base tune is stable and the problem it addresses is visible in data.

## AutoTune

Multirotor AutoTune is available only when Flight Commander Firmware advertises
the capability. Capability means the workflow exists; it does not guarantee the
aircraft, weather, site, or initial tune is suitable.

- Use open space and sufficient altitude/energy.
- Begin from a flyable conservative tune.
- Configure a tested abort mode/switch.
- Review the generated result and logs before making it the only profile.

## In-flight adjustments

Adjustments map an AUX channel to a parameter/range. Constrain the range so a
full control excursion cannot create an unsafe value, avoid overlapping mode
ranges, and record the final value before removing the temporary mapping.

## Validate a tune

- Repeat controlled maneuvers in comparable conditions.
- Inspect tracking, overshoot, bounce-back, saturation, noise, and motor output.
- Check motor/ESC temperature immediately after landing.
- Verify navigation modes and failsafe after manual-mode tuning.
- Keep the previous known-good profile until multiple flights confirm the new
  result.
