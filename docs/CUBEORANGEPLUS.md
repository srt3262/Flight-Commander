# CubePilot Cube Orange+ target

Flight Commander Firmware 4.1.8 introduced the official `CUBEORANGEPLUS` target for
the CubePilot Cube Orange+ (STM32H757). It is a distinct image from
`MICOAIR743`; never cross-flash the two targets.

## Supported hardware

| Function | Flight Commander mapping |
| --- | --- |
| Processor | STM32H757 CM7, 24 MHz HSE, direct-SMPS supply |
| USB | Virtual COM and protected Cube/Pixhawk bootloader flashing |
| IMUs | Two isolated SPI4 positions populated by ICM42688-P or ICM45686, selected with `gyro_to_use` 0 or 1 |
| Barometer | Primary isolated MS5611 on SPI4 |
| Compass | External I2C1 or DroneCAN compass required |
| GNSS | GPS1 on UART4; GPS2 on UART8 |
| Telemetry | TELEM1 on USART2; TELEM2 on USART3 |
| CAN | CAN1 on the Cube CAN connector |
| Logging | Removable microSD through SDMMC1; slot beneath the USB connector |
| Power monitor | Power Brick 1 voltage and current inputs |
| Outputs | AUX1-AUX6, the six direct FMU timer outputs |

The Cube Orange+ does not include a separate high-rate Blackbox dataflash
chip. Its 32 KiB FRAM is reserved for configuration storage, and its MCU flash
contains the bootloader, application, and configuration sectors. Use the
removable microSD slot beneath the USB connector for onboard Blackbox logging.

## Ports-tab connector labels

When `CUBEORANGEPLUS` or board identifier `COPL` is connected, the Configurator
shows the carrier-board connector first and the STM32 UART in parentheses:

| Ports tab | Cube serial role | Physical connection |
| --- | --- | --- |
| `TELEM1 (UART2)` | SERIAL1 | TELEM1 |
| `TELEM2 (UART3)` | SERIAL2 | TELEM2 |
| `GPS1 (UART4)` | SERIAL3 | GPS1 |
| `CONS / ADS-B (UART7)` | SERIAL5 | CONSOLE on a standard carrier or its built-in ADS-B receiver on an ADS-B carrier |
| `GPS2 (UART8)` | SERIAL4 | GPS2 |

The labels change only what the Configurator displays; the saved serial-port
identifiers and firmware pin assignments are unchanged.

The onboard AK09916 is not enabled in 4.3.2. Flight Commander does not yet
have the required driver/alignment path for that Cube-mounted sensor, so an
external I2C or DroneCAN compass is required for magnetic heading. The second
onboard MS5611 is retained as a cold spare because the inherited barometer
driver currently supports one device of that type.

## IOMCU boundary

The Cube's STM32F100 IOMCU owns MAIN1-MAIN8 and the physical RC input. Flight
Commander 4.3.2 does not implement the PX4IO protocol and deliberately keeps
USART6 reserved rather than pretending those connections are direct H757
resources. Therefore:

- use AUX1-AUX6 for motors and servos;
- MAIN1-MAIN8 do not output Flight Commander motor/servo signals;
- the Cube's physical RCIN is not consumed by this target; and
- receiver control is accepted as MAVLink `RC_CHANNELS_OVERRIDE` on a
  bidirectional telemetry link (TELEM1 is configured for MAVLink at 460800 by
  default).

Confirm the mixer uses no more than six outputs before arming. An aircraft
requiring the IOMCU outputs or physical RCIN needs future PX4IO support and must
not use this release.

## Bootloader-safe flashing

The Cube vendor bootloader occupies `0x08000000` through `0x0801FFFF`. The
4.3.2 image has its vector table at `0x08020000`, code beginning at
`0x08040000`, and persistent configuration in the final 128 KiB sector at
`0x081E0000`.

The Configurator disables **Full chip erase** whenever Cube Orange+ is selected
or detected. Leave it disabled. A full-chip erase would remove the vendor
bootloader. The Cube/Pixhawk protocol's normal application erase preserves the
first 128 KiB.

Safe first installation:

1. Remove propellers and disconnect motors, servos, radios, and other sources
   that can back-power the carrier board.
2. Save a Configurator backup and CLI `diff all` if another firmware is still
   reachable.
3. Select **CubePilot Cube Orange+**, load the official 4.3.2 online image, and
   verify that **Full chip erase** is unavailable.
4. Select the Cube USB serial port and click **Flash Firmware**. The
   Configurator asks ArduPilot over MAVLink to enter the protected vendor
   bootloader, verifies bootloader board ID `1063`, erases the application
   area, programs the image, and verifies its CRC.
5. If automatic entry is not acknowledged, close Mission Planner and other
   serial programs, then unplug and reconnect USB while the Configurator's
   20-second bootloader watch is active.
6. Reconnect, apply target defaults, and configure an external compass,
   MAVLink receiver path, mixer, failsafe, battery calibration, and ports.

Later Flight Commander updates use the same protected vendor bootloader. The
Configurator first identifies `CUBEORANGEPLUS` over MSP and sends a normal
reset; it does not ask the application to enter STM32 ROM DFU. On every path,
the board ID is checked before application erase and the vendor bootloader is
left intact.

## Propeller-off acceptance

Before any armed test, verify all of the following with propellers removed:

- target reports `CUBEORANGEPLUS` and Firmware 4.3.2;
- both IMU selections produce the correct roll, pitch, and yaw directions;
- the primary barometer, external compass, GNSS, CAN devices, and microSD are
  detected and remain healthy after repeated cold starts;
- Power Brick 1 voltage/current scales are calibrated against instruments;
- only AUX1-AUX6 move and every mixer output reaches the intended actuator;
- MAVLink receiver loss triggers the configured failsafe; and
- reboot, configuration save, vendor-bootloader re-entry, and recovery all preserve the
  Cube bootloader.

The release pipeline compiles with warnings as errors and verifies the HEX
address range, vector table, embedded identity, target string, and checksum.
Those structural checks do not replace carrier-board power, sensor, actuator,
receiver, and failsafe bench acceptance on the actual aircraft.

Hardware mappings are derived from CubePilot's public design documentation and
the reviewed [ArduPilot CubeOrangePlus hardware definition](https://github.com/ArduPilot/ardupilot/tree/master/libraries/AP_HAL_ChibiOS/hwdef/CubeOrangePlus).
