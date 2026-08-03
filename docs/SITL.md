# Software in the loop (SITL)

Flight Commander SITL starts the included Flight Commander-compatible desktop
flight-control simulation runtime without a physical flight controller. It can
exchange simulated aircraft/sensor data with RealFlight or X-Plane and can
bridge a real serial receiver or proxy controller.

The packaged simulation engine is inherited compatibility technology. The
Flight Commander UI, profiles, documentation, and support workflow own the
operator-facing experience; simulation does not claim to replace hardware or
flight validation.

## Profiles

A SITL profile stores simulator selection, network address/port, channel map,
serial receiver options, and a local simulated EEPROM/configuration file.
Standard profiles are read-only. Create a new profile before saving changes.

## Run with a simulator

1. Select the X-Plane or RealFlight standard profile as a starting point.
2. Enable simulator input.
3. Set the simulator IP. Use `127.0.0.1` when both programs run on the same
   computer.
4. Use the required UDP port; RealFlight's supported port is fixed.
5. Map throttle/roll/pitch/yaw (or expanded RealFlight channels) to the intended
   motor/servo outputs.
6. Start SITL and watch the log for startup or socket errors.
7. Connect Flight Commander to the SITL port through the normal connection UI.

**Use IMU** asks the runtime to derive attitude from simulated inertial sensor
data instead of accepting simulator attitude directly. It is experimental and
can expose simulation-model limitations.

## Configure without a simulator

Disable **Enable simulator** to run the compatible firmware runtime with its
MSP/UART interfaces only. This is useful for testing Configurator workflows and
configuration persistence without launching RealFlight or X-Plane.

## Serial receiver bridge

The Serial receiver section can connect a receiver through a USB-to-UART
adapter or a proxy flight controller.

1. Enable the bridge and choose the exact host COM port.
2. Choose the simulated UART.
3. Select the receiver protocol preset, or enter manual baud/stop/parity.
4. Confirm no other program owns the host port.
5. Verify channel endpoints and mapping inside the simulated firmware before
   testing modes or logic.

## Channel mapping

Simulator inputs can drive simulated motor or servo outputs. The mapping is
about the simulation runtime's output numbers; it does not prove that a real
aircraft mixer, wiring, motor order, or servo direction is correct.

## Limitations

SITL does not reproduce real vibration, magnetic interference, GNSS multipath,
RTK radio loss, power systems, actuator latency/failure, receiver failsafe,
airframe flexibility, weather, or every target-specific peripheral. Repeat all
safety-critical tests on a secured, propeller-free real aircraft before flight.
