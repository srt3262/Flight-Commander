#pragma once

#include "platform.h"

#if defined(USE_GPS_PROTO_DRONECAN)

#include <stdint.h>
#include <dronecan_msgs.h>

void gpsRestartDronecan(void);
void gpsHandleDronecan(void);
void dronecanGPSReceiveGNSSFix(uint8_t sourceNodeID, const struct uavcan_equipment_gnss_Fix *fix);
void dronecanGPSReceiveGNSSFix2(uint8_t sourceNodeID, const struct uavcan_equipment_gnss_Fix2 *fix);
void dronecanGPSReceiveGNSSAuxiliary(uint8_t sourceNodeID, const struct uavcan_equipment_gnss_Auxiliary *auxiliary);

#endif
