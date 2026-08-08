#pragma once

#include "platform.h"

#if defined(USE_GPS_PROTO_DRONECAN)

#include <stdbool.h>
#include <stdint.h>
#include <dronecan_msgs.h>

#include "io/gps.h"

typedef struct gpsDronecanNodeStatus_s {
    uint8_t nodeID;
    bool healthy;
    gpsFixType_e fixType;
    uint8_t satellites;
    uint32_t ageMs;
    gpsLocation_t location;
} gpsDronecanNodeStatus_t;

void gpsRestartDronecan(void);
void gpsHandleDronecan(void);
void dronecanGPSReceiveGNSSFix(uint8_t sourceNodeID, const struct uavcan_equipment_gnss_Fix *fix);
void dronecanGPSReceiveGNSSFix2(uint8_t sourceNodeID, const struct uavcan_equipment_gnss_Fix2 *fix);
void dronecanGPSReceiveGNSSAuxiliary(uint8_t sourceNodeID, const struct uavcan_equipment_gnss_Auxiliary *auxiliary);
bool gpsDronecanGetNodeStatus(uint8_t nodeID, gpsDronecanNodeStatus_t *status);

#endif
