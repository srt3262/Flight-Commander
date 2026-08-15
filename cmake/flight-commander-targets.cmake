set(FLIGHT_COMMANDER_TARGET_MANIFEST
    "${CMAKE_SOURCE_DIR}/flight-commander/official-targets.txt")
if(NOT EXISTS "${FLIGHT_COMMANDER_TARGET_MANIFEST}")
    message(FATAL_ERROR "Flight Commander target manifest is missing")
endif()

file(STRINGS "${FLIGHT_COMMANDER_TARGET_MANIFEST}"
    FLIGHT_COMMANDER_TARGET_RECORDS REGEX "^[A-Za-z0-9_]+\\|")
set(FLIGHT_COMMANDER_OFFICIAL_TARGETS)
foreach(FLIGHT_COMMANDER_TARGET_RECORD IN LISTS FLIGHT_COMMANDER_TARGET_RECORDS)
    string(REPLACE "|" ";" FLIGHT_COMMANDER_TARGET_FIELDS
        "${FLIGHT_COMMANDER_TARGET_RECORD}")
    list(LENGTH FLIGHT_COMMANDER_TARGET_FIELDS FLIGHT_COMMANDER_TARGET_FIELD_COUNT)
    if(NOT FLIGHT_COMMANDER_TARGET_FIELD_COUNT EQUAL 3)
        message(FATAL_ERROR
            "Invalid Flight Commander target record: ${FLIGHT_COMMANDER_TARGET_RECORD}")
    endif()
    list(GET FLIGHT_COMMANDER_TARGET_FIELDS 0 FLIGHT_COMMANDER_TARGET_NAME)
    list(GET FLIGHT_COMMANDER_TARGET_FIELDS 1 FLIGHT_COMMANDER_TARGET_MCU)
    list(GET FLIGHT_COMMANDER_TARGET_FIELDS 2 FLIGHT_COMMANDER_TARGET_CAN_MODE)
    if(FLIGHT_COMMANDER_TARGET_NAME IN_LIST FLIGHT_COMMANDER_OFFICIAL_TARGETS)
        message(FATAL_ERROR "Duplicate Flight Commander target: ${FLIGHT_COMMANDER_TARGET_NAME}")
    endif()
    list(APPEND FLIGHT_COMMANDER_OFFICIAL_TARGETS "${FLIGHT_COMMANDER_TARGET_NAME}")
    set("FLIGHT_COMMANDER_MCU_${FLIGHT_COMMANDER_TARGET_NAME}"
        "${FLIGHT_COMMANDER_TARGET_MCU}")
    set("FLIGHT_COMMANDER_CAN_MODE_${FLIGHT_COMMANDER_TARGET_NAME}"
        "${FLIGHT_COMMANDER_TARGET_CAN_MODE}")
endforeach()
list(LENGTH FLIGHT_COMMANDER_OFFICIAL_TARGETS FLIGHT_COMMANDER_TARGET_COUNT)
if(NOT FLIGHT_COMMANDER_TARGET_COUNT EQUAL 50)
    message(FATAL_ERROR
        "Expected 50 official Flight Commander targets, found ${FLIGHT_COMMANDER_TARGET_COUNT}")
endif()

# These targets predate the shared target inventory. Their existing, proven
# CMake configuration remains authoritative and is loaded separately so the
# H7 expansion cannot silently change their source or feature wiring.
set(FLIGHT_COMMANDER_LEGACY_TARGETS
    MICOAIR743
    CUBEORANGEPLUS
)

set(FLIGHT_COMMANDER_DRONECAN_ROOT "${MAIN_SRC_DIR}/drivers/dronecan")
set(FLIGHT_COMMANDER_DSDL_ROOT "${MAIN_LIB_DIR}/main/Dronecan/dsdlc_generated")

set(FLIGHT_COMMANDER_COMMON_TARGET_SOURCES
    "${MAIN_SRC_DIR}/msp/msp_flight_commander.c"
    "${MAIN_SRC_DIR}/flight_commander/rtcm.c"
    "${MAIN_SRC_DIR}/flight_commander/external_compass.c"
    "${MAIN_SRC_DIR}/flight_commander/heading_fusion.c"
    "${MAIN_SRC_DIR}/flight_commander/compass_orientation.c"
    "${MAIN_SRC_DIR}/flight_commander/gcs_commands.c"
)

set(FLIGHT_COMMANDER_DRONECAN_TARGET_SOURCES
    "${FLIGHT_COMMANDER_DRONECAN_ROOT}/dronecan.c"
    "${FLIGHT_COMMANDER_DRONECAN_ROOT}/libcanard/canard.c"
    "${FLIGHT_COMMANDER_DRONECAN_ROOT}/libcanard/canard_stm32h7xx_driver.c"
    "${MAIN_SRC_DIR}/io/gps_dronecan.c"
    "${MAIN_SRC_DIR}/sensors/battery_sensor_dronecan.c"
    "${MAIN_SRC_DIR}/flight_commander/slcan_bridge.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/ardupilot.gnss.Heading.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/ardupilot.gnss.RelPosHeading.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.equipment.ahrs.MagneticFieldStrength.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.equipment.ahrs.MagneticFieldStrength2.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.equipment.gnss.Auxiliary.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.equipment.gnss.Fix.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.equipment.gnss.Fix2.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.equipment.gnss.RTCMStream.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.equipment.power.BatteryInfo.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.protocol.GetNodeInfo_res.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.protocol.NodeStatus.c"
    "${MAIN_LIB_DIR}/main/STM32H7/Drivers/STM32H7xx_HAL_Driver/Src/stm32h7xx_hal_fdcan.c"
    "${MAIN_SRC_DIR}/drivers/dronecan/dronecan_pair.c"
    "${MAIN_SRC_DIR}/drivers/dronecan/dronecan_allocator.c"
)
set(FLIGHT_COMMANDER_PAIR_DSDL_CANDIDATES
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.protocol.GetNodeInfo_req.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.protocol.param.GetSet_req.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.protocol.param.GetSet_res.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.protocol.param.ExecuteOpcode_req.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.protocol.param.ExecuteOpcode_res.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.protocol.RestartNode_req.c"
    "${FLIGHT_COMMANDER_DSDL_ROOT}/src/uavcan.protocol.RestartNode_res.c"
)
foreach(FLIGHT_COMMANDER_PAIR_DSDL_SOURCE IN LISTS FLIGHT_COMMANDER_PAIR_DSDL_CANDIDATES)
    if(EXISTS "${FLIGHT_COMMANDER_PAIR_DSDL_SOURCE}")
        list(APPEND FLIGHT_COMMANDER_DRONECAN_TARGET_SOURCES
            "${FLIGHT_COMMANDER_PAIR_DSDL_SOURCE}")
    endif()
endforeach()

function(configure_flight_commander_official_target target)
    if(target IN_LIST FLIGHT_COMMANDER_LEGACY_TARGETS)
        return()
    endif()
    if(NOT TARGET "${target}.elf")
        message(FATAL_ERROR "Official Flight Commander target is not registered: ${target}")
    endif()
    target_sources("${target}.elf" PRIVATE ${FLIGHT_COMMANDER_COMMON_TARGET_SOURCES})
    target_include_directories("${target}.elf" PRIVATE
        "${FLIGHT_COMMANDER_DSDL_ROOT}/include"
        "${FLIGHT_COMMANDER_DRONECAN_ROOT}/libcanard"
    )
    target_compile_definitions("${target}.elf" PRIVATE
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

    set(FLIGHT_COMMANDER_CAN_MODE_VARIABLE "FLIGHT_COMMANDER_CAN_MODE_${target}")
    set(FLIGHT_COMMANDER_CAN_MODE "${${FLIGHT_COMMANDER_CAN_MODE_VARIABLE}}")
    if(NOT FLIGHT_COMMANDER_CAN_MODE STREQUAL "NONE")
        target_sources("${target}.elf" PRIVATE ${FLIGHT_COMMANDER_DRONECAN_TARGET_SOURCES})
        target_compile_definitions("${target}.elf" PRIVATE
            FLIGHT_COMMANDER_HAS_DRONECAN
            USE_GPS_PROTO_DRONECAN
            USE_FLIGHT_COMMANDER_DRONECAN_PAIR_MANAGER
            USE_FLIGHT_COMMANDER_DRONECAN_DNA_ALLOCATOR
            USE_FLIGHT_COMMANDER_SLCAN_BRIDGE
        )
        if(NOT FLIGHT_COMMANDER_CAN_MODE STREQUAL "TARGET")
            target_compile_definitions("${target}.elf" PRIVATE USE_DRONECAN)
            string(REPLACE "," ";" FLIGHT_COMMANDER_CAN_PINS
                "${FLIGHT_COMMANDER_CAN_MODE}")
            list(LENGTH FLIGHT_COMMANDER_CAN_PINS FLIGHT_COMMANDER_CAN_PIN_COUNT)
            if(NOT FLIGHT_COMMANDER_CAN_PIN_COUNT EQUAL 2)
                message(FATAL_ERROR "Invalid CAN pin pair for ${target}")
            endif()
            list(GET FLIGHT_COMMANDER_CAN_PINS 0 FLIGHT_COMMANDER_CAN_RX)
            list(GET FLIGHT_COMMANDER_CAN_PINS 1 FLIGHT_COMMANDER_CAN_TX)
            target_compile_definitions("${target}.elf" PRIVATE
                "CAN1_RX=${FLIGHT_COMMANDER_CAN_RX}"
                "CAN1_TX=${FLIGHT_COMMANDER_CAN_TX}"
            )
        endif()
        set_property(TARGET "${target}.elf" PROPERTY FLIGHT_COMMANDER_DRONECAN ON)
    else()
        set_property(TARGET "${target}.elf" PROPERTY FLIGHT_COMMANDER_DRONECAN OFF)
    endif()
    set_property(TARGET "${target}.elf" PROPERTY FLIGHT_COMMANDER_OFFICIAL ON)
endfunction()

function(configure_flight_commander_targets)
    foreach(FLIGHT_COMMANDER_TARGET IN LISTS FLIGHT_COMMANDER_OFFICIAL_TARGETS)
        configure_flight_commander_official_target("${FLIGHT_COMMANDER_TARGET}")
    endforeach()
endfunction()
