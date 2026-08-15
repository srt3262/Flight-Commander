# H7 and newer firmware targets

Flight Commander 4.3.1 supports the 49 STM32H743 target variants shipped by
official INAV 9.1.0 plus the existing STM32H757 Cube Orange+ target. The 48 new
release assets are additive: the published `MICOAIR743` and `CUBEORANGEPLUS`
assets are not replaced.

The original `src/main/target/MICOAIR743` files and its dedicated CMake feature
wiring remain unchanged. A reproducible regression build must match the
published MICOAIR743 and Cube Orange+ image SHA-256 values before the additive
assets can be uploaded.

| Target | MCU | DroneCAN feature set |
|---|---|---:|
| `AEDROXH7` | STM32H743 | Yes |
| `AETH743Basic` | STM32H743 | No |
| `AOCODARCH7DUAL` | STM32H743 | No |
| `AXISFLYINGH743PRO` | STM32H743 | No |
| `BLADE_PRO_H7` | STM32H743 | No |
| `BLUEBERRYH743` | STM32H743 | No |
| `BLUEBERRYH743HD` | STM32H743 | No |
| `BRAHMA_H7` | STM32H743 | No |
| `BROTHERHOBBYH743` | STM32H743 | No |
| `CORVON743V1` | STM32H743 | No |
| `DAKEFPVH743` | STM32H743 | No |
| `DAKEFPVH743PRO` | STM32H743 | No |
| `DAKEFPVH743_SLIM` | STM32H743 | No |
| `FLYWOOH743PRO` | STM32H743 | No |
| `FOXEERH743` | STM32H743 | No |
| `GEPRC_TAKER_H743` | STM32H743 | No |
| `HAKRCH743` | STM32H743 | No |
| `IFLIGHT_2RAW_H743` | STM32H743 | No |
| `IFLIGHT_BLITZ_H7_PRO` | STM32H743 | No |
| `IFLIGHT_BLITZ_H7_WING` | STM32H743 | No |
| `JHEMCUH743HD` | STM32H743 | No |
| `KAKUTEH7` | STM32H743 | No |
| `KAKUTEH7MINI` | STM32H743 | No |
| `KAKUTEH7V2` | STM32H743 | No |
| `KAKUTEH7WING` | STM32H743 | No |
| `MAMBAH743` | STM32H743 | No |
| `MAMBAH743_2022B` | STM32H743 | No |
| `MAMBAH743_2022B_GYRO2` | STM32H743 | No |
| `MATEKH743` | STM32H743 | No |
| `MATEKH743HD` | STM32H743 | No |
| `MICOAIR743` | STM32H743 | Yes |
| `MICOAIR743AIO` | STM32H743 | No |
| `MICOAIR743V2` | STM32H743 | No |
| `MICOAIR743V2_EXTMAG` | STM32H743 | No |
| `MICOAIR743_EXTMAG` | STM32H743 | Yes |
| `NEUTRONRCH7BT` | STM32H743 | No |
| `ORBITH743` | STM32H743 | No |
| `SDMODELH7V1` | STM32H743 | No |
| `SDMODELH7V2` | STM32H743 | No |
| `SEQUREH7` | STM32H743 | No |
| `SEQUREH7V2` | STM32H743 | No |
| `SIMPLIFLYH7` | STM32H743 | No |
| `SKYSTARSH743HD` | STM32H743 | No |
| `SPEDIXH743` | STM32H743 | No |
| `TBS_LUCID_H7` | STM32H743 | No |
| `TBS_LUCID_H7_OEM` | STM32H743 | Yes |
| `TBS_LUCID_H7_V3` | STM32H743 | Yes |
| `TBS_LUCID_H7_WING` | STM32H743 | No |
| `TBS_LUCID_H7_WING_MINI` | STM32H743 | No |
| `CUBEORANGEPLUS` | STM32H757 | Yes |

“Yes” means the firmware includes the full DroneCAN feature set using the
target's declared CAN pins. “No” means the board still receives Flight
Commander navigation, UART RTK, mission, GCS, heading-fusion, compass-learning,
and autotune features, but does not advertise DroneCAN capabilities without an
official target pin mapping.

All targets must compile with Arm GNU 13.2.1 and warnings as errors. Release
verification also checks the embedded firmware identity, exact target string,
target-aware capability mask, Intel HEX checksums, vector table, start address,
and protected flash range. Successful compilation is not a substitute for
propeller-off hardware bench testing on each controller revision.
