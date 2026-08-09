/*
 * STM32H757xI application layout for CubePilot Cube Orange+.
 *
 * The vendor bootloader occupies the first 128 KiB. Flight Commander starts
 * at 0x08020000 and keeps its persistent configuration in the final 128 KiB
 * sector, leaving the bootloader untouched during ordinary HEX flashing.
 */

_Min_Heap_Size = 0;
_Min_Stack_Size = 0x1800;

ENTRY(Reset_Handler)

MEMORY
{
    FLASH (rx)        : ORIGIN = 0x08020000, LENGTH = 128K
    FLASH1 (rx)       : ORIGIN = 0x08040000, LENGTH = 1664K
    FLASH_CONFIG (r)  : ORIGIN = 0x081E0000, LENGTH = 128K

    ITCM_RAM (rwx)    : ORIGIN = 0x00000000, LENGTH = 64K
    DTCM_RAM (rwx)    : ORIGIN = 0x20000000, LENGTH = 128K
    RAM (rwx)         : ORIGIN = 0x24000000, LENGTH = 512K
    D2_RAM (rwx)      : ORIGIN = 0x30000000, LENGTH = 256K
    MEMORY_B1 (rx)    : ORIGIN = 0x60000000, LENGTH = 0K
}

REGION_ALIAS("STACKRAM", DTCM_RAM)
REGION_ALIAS("FASTRAM",  DTCM_RAM)
REGION_ALIAS("SLOWRAM",  D2_RAM)

INCLUDE "stm32_flash_h7_split.ld"
