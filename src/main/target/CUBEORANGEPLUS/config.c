/*
 * Flight Commander defaults for the CubePilot Cube Orange+ connector map.
 */

#include <stdint.h>

#include "platform.h"

#include "fc/config.h"
#include "io/serial.h"

void targetConfiguration(void)
{
    serialPortConfig_t *telem1 = serialFindPortConfiguration(SERIAL_PORT_USART2);
    serialPortConfig_t *gps1 = serialFindPortConfiguration(SERIAL_PORT_USART4);

    if (telem1) {
        telem1->functionMask = FUNCTION_TELEMETRY_MAVLINK;
        telem1->telemetry_baudrateIndex = BAUD_460800;
    }

    if (gps1) {
        gps1->functionMask = FUNCTION_GPS;
        gps1->gps_baudrateIndex = BAUD_115200;
    }

    beeperConfigMutable()->pwmMode = true;
}
