# Flight Commander Documentation & Support

This is the maintained documentation hub for the Flight Commander
Configurator, Ground Control Station, mission planner, and Flight Commander
Firmware integration.

## Start here

- [Project overview, installation, and transport boundaries](../README.md)
- [USB RTK base and NTRIP workflows](RTK_BASE_NTRIP.md)
- [Heading fusion, compass sources, calibration, and moving-baseline yaw](HEADING_FUSION.md)
- [Configurator and firmware versioning](FLIGHT_COMMANDER_VERSIONING.md)
- [Source reconstruction and upstream provenance](RECONSTRUCTION.md)
- [Release notes](../CHANGELOG.md)
- [Verified Windows, source, and firmware downloads](https://github.com/srt3262/Flight-Commander/releases)

## Get support

Use the [Flight Commander issue tracker](https://github.com/srt3262/Flight-Commander/issues)
for defects, setup problems, documentation gaps, and narrowly scoped feature
requests. Before opening an issue, include:

1. Flight Commander Configurator version and operating system.
2. Flight-controller target and exact firmware family/version.
3. Connection type, protocol, baud rate, and relevant peripheral model.
4. Steps that reproduce the problem and the result you expected.
5. Screenshots, Configurator logs, CLI `diff all`, or Blackbox evidence when
   applicable. Remove credentials and private NTRIP account details first.

Flight Commander is an independent project. Use the Flight Commander issue
tracker for Flight Commander software, firmware, workflows, and documentation.
Use upstream INAV documentation only when working with behavior explicitly
identified as Official INAV compatibility.

## Contribute

Source changes and documentation improvements are welcome. Follow the
[contribution workflow](../README.md#contributing), keep Flight Commander and
Official INAV behavior clearly identified, and add regression coverage for any
runtime or packaging change.
