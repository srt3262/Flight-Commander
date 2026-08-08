#pragma once

#include "platform.h"

#if defined(USE_DRONECAN) && defined(USE_FLIGHT_COMMANDER_DRONECAN_DNA_ALLOCATOR)

#include <stdbool.h>
#include <stdint.h>

#include "drivers/dronecan/libcanard/canard.h"

void dronecanAllocatorInit(void);
bool dronecanAllocatorShouldAccept(uint8_t transferType, uint16_t dataTypeID, uint64_t *signature);
void dronecanAllocatorHandleTransfer(const CanardRxTransfer *transfer);
uint8_t dronecanAllocatorAllocationCount(void);

#endif
