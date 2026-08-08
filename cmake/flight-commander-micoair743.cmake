set(FLIGHT_COMMANDER_DRONECAN_ROOT "${MAIN_SRC_DIR}/drivers/dronecan")
set(FLIGHT_COMMANDER_DSDL_ROOT "${MAIN_LIB_DIR}/main/Dronecan/dsdlc_generated")

set(FLIGHT_COMMANDER_MICOAIR743_SOURCES
    "${MAIN_SRC_DIR}/msp/msp_flight_commander.c"
    "${FLIGHT_COMMANDER_DRONECAN_ROOT}/dronecan.c"
    "${FLIGHT_COMMANDER_DRONECAN_ROOT}/libcanard/canard.c"
    "${FLIGHT_COMMANDER_DRONECAN_ROOT}/libcanard/canard_stm32h7xx_driver.c"
    "${MAIN_SRC_DIR}/io/gps_dronecan.c"
    "${MAIN_SRC_DIR}/sensors/battery_sensor_dronecan.c"
    "${MAIN_SRC_DIR}/flight_commander/rtcm.c"
    "${MAIN_SRC_DIR}/flight_commander/external_compass.c"
    "${MAIN_SRC_DIR}/flight_commander/heading_fusion.c"
    "${MAIN_SRC_DIR}/flight_commander/compass_orientation.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/ardupilot.gnss.Heading.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/ardupilot.gnss.RelPosHeading.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.equipment.ahrs.MagneticFieldStrength2.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.equipment.gnss.Auxiliary.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.equipment.gnss.Fix.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.equipment.gnss.Fix2.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.equipment.gnss.RTCMStream.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.equipment.power.BatteryInfo.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.protocol.GetNodeInfo_res.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.protocol.NodeStatus.c"
    "${MAIN_LIB_DIR}/main/STM32H7/Drivers/STM32H7xx_HAL_Driver/Src/stm32h7xx_hal_fdcan.c"
)

target_sources(MICOAIR743.elf PRIVATE ${FLIGHT_COMMANDER_MICOAIR743_SOURCES})
target_include_directories(MICOAIR743.elf PRIVATE
    "${FLIGHT_COMMANDER_DSDL_ROOT}/include"
    "${FLIGHT_COMMANDER_DRONECAN_ROOT}/libcanard"
)
target_compile_definitions(MICOAIR743.elf PRIVATE
    USE_DRONECAN
    USE_GPS_PROTO_DRONECAN
    CAN1_RX=PB8
    CAN1_TX=PB9
    USE_AUTOTUNE_MULTIROTOR
    USE_FLIGHT_COMMANDER_RTK_GPS_UART
    USE_FLIGHT_COMMANDER_RTK
    USE_FLIGHT_COMMANDER_GCS_COMMANDS
    USE_FLIGHT_COMMANDER_TERRAIN_WAYPOINTS
    USE_FLIGHT_COMMANDER_PHOTO_TRIGGERS
    USE_FLIGHT_COMMANDER_MISSION_STREAMING
    USE_FLIGHT_COMMANDER_MISSION_RESUME
    USE_FLIGHT_COMMANDER_GCS_RTK_BASE
    USE_FLIGHT_COMMANDER_HEADING_FUSION
    USE_FLIGHT_COMMANDER_MOVING_BASELINE
    USE_FLIGHT_COMMANDER_COMPASS_ORIENTATION
)


set(FLIGHT_COMMANDER_PAIR_SOURCES
    ${CMAKE_SOURCE_DIR}/src/main/drivers/dronecan/dronecan_pair.c
)
set(FLIGHT_COMMANDER_PAIR_DSDL_CANDIDATES
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.GetNodeInfo_req.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.param.GetSet_req.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.param.GetSet_res.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.param.ExecuteOpcode_req.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.param.ExecuteOpcode_res.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.RestartNode_req.c
    ${CMAKE_SOURCE_DIR}/lib/main/Dronecan/dsdlc_generated/src/uavcan.protocol.RestartNode_res.c
)
foreach(FLIGHT_COMMANDER_PAIR_DSDL_SOURCE IN LISTS FLIGHT_COMMANDER_PAIR_DSDL_CANDIDATES)
    if(EXISTS "${FLIGHT_COMMANDER_PAIR_DSDL_SOURCE}")
        list(APPEND FLIGHT_COMMANDER_PAIR_SOURCES "${FLIGHT_COMMANDER_PAIR_DSDL_SOURCE}")
    endif()
endforeach()
target_sources(MICOAIR743.elf PRIVATE ${FLIGHT_COMMANDER_PAIR_SOURCES})

target_compile_definitions(MICOAIR743.elf PRIVATE
    USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER
)


target_sources(MICOAIR743.elf PRIVATE
    ${CMAKE_SOURCE_DIR}/src/main/drivers/dronecan/dronecan_allocator.c
)

target_compile_definitions(MICOAIR743.elf PRIVATE
    USE_FLIGHT_COMMANDER_DRONECAN_DNA_ALLOCATOR
)
