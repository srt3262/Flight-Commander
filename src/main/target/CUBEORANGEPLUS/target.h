/*
 * Flight Commander target for the CubePilot Cube Orange+.
 * Hardware mappings follow CubePilot's STM32H757 CubeOrangePlus definition.
 */

#pragma once

#define TARGET_BOARD_IDENTIFIER "COPL"
#define USBD_PRODUCT_STRING      "Flight Commander CubeOrange+"

/* The amber FMU LED is active-low. */
#define LED0                     PE12
#define LED0_INVERTED

/* Passive buzzer driven by TIM2_CH1. */
#define BEEPER                   PA15
#define BEEPER_PWM_FREQUENCY     2500

/* Power rails and PWM voltage selection are set before sensor startup. */
#define USE_HARDWARE_PREBOOT_SETUP

/* Onboard sensor buses. */
#define USE_SPI
#define USE_SPI_DEVICE_1
#define USE_SPI_DEVICE_4

#define SPI1_SCK_PIN             PA5
#define SPI1_MISO_PIN            PA6
#define SPI1_MOSI_PIN            PA7

#define SPI4_SCK_PIN             PE2
#define SPI4_MISO_PIN            PE5
#define SPI4_MOSI_PIN            PE6

/*
 * Cube Orange+ revisions place ICM42688-P or ICM45686 parts at two SPI4
 * positions. target.c supplies tagged descriptors so gyro_to_use selects the
 * isolated primary (0) or secondary (1) sensor without changing pin mappings.
 */
#define USE_TARGET_IMU_HARDWARE_DESCRIPTORS
#define USE_DUAL_GYRO
#define USE_IMU_ICM42605
#define USE_IMU_ICM45686

/* Primary isolated MS5611. The second onboard MS5611 remains a cold spare. */
#define USE_BARO
#define USE_BARO_MS5611
#define MS5611_SPI_BUS            BUS_SPI4
#define MS5611_CS_PIN             PC14

/* External I2C compass and peripheral buses. */
#define USE_I2C
#define USE_I2C_DEVICE_1
#define USE_I2C_DEVICE_2
#define USE_I2C_DEVICE_4

#define I2C1_SCL                  PB8
#define I2C1_SDA                  PB9
#define I2C2_SCL                  PB10
#define I2C2_SDA                  PB11
#define I2C4_SCL                  PF14
#define I2C4_SDA                  PF15

#define DEFAULT_I2C_BUS           BUS_I2C1
#define USE_MAG
#define USE_MAG_ALL
#define MAG_I2C_BUS               BUS_I2C1
#define FLIGHT_COMMANDER_MAG_DEFAULT_ALIGN CW0_DEG

#define USE_RANGEFINDER
#define USE_RANGEFINDER_MSP
#define USE_OPFLOW
#define USE_OPFLOW_MSP

/* USB and Cube connector UARTs; USART6 is reserved for the onboard IOMCU. */
#define USE_VCP

#define USE_UART2
#define UART2_RX_PIN              PD6
#define UART2_TX_PIN              PD5

#define USE_UART3
#define UART3_RX_PIN              PD9
#define UART3_TX_PIN              PD8

#define USE_UART4
#define UART4_RX_PIN              PA1
#define UART4_TX_PIN              PA0

#define USE_UART7
#define UART7_RX_PIN              PE7
#define UART7_TX_PIN              PE8

#define USE_UART8
#define UART8_RX_PIN              PE0
#define UART8_TX_PIN              PE1

#define SERIAL_PORT_COUNT         6

/* RC_CHANNELS_OVERRIDE arrives on the bidirectional MAVLink telemetry port. */
#define DEFAULT_RX_TYPE           RX_TYPE_SERIAL
#define SERIALRX_PROVIDER         SERIALRX_MAVLINK

/* microSD on SDMMC1. */
#define USE_SDCARD
#define USE_SDCARD_SDIO
#define SDCARD_SDIO_DEVICE        SDIODEV_1
#define SDCARD_SDIO_4BIT
#define ENABLE_BLACKBOX_LOGGING_ON_SDCARD_BY_DEFAULT

/* Power Brick 1 voltage/current inputs. */
#define USE_ADC
#define ADC_INSTANCE              ADC1
#define ADC_CHANNEL_1_PIN         PA2
#define ADC_CHANNEL_2_PIN         PA3
#define VBAT_ADC_CHANNEL          ADC_CHN_1
#define CURRENT_METER_ADC_CHANNEL ADC_CHN_2
#define VBAT_SCALE_DEFAULT        1010
#define CURRENT_METER_SCALE       588

#define DEFAULT_FEATURES (FEATURE_VBAT | FEATURE_CURRENT_METER | FEATURE_TELEMETRY | FEATURE_GPS | FEATURE_BLACKBOX)

#define USE_DSHOT
#define USE_ESC_SENSOR
#define USE_SERIAL_4WAY_BLHELI_INTERFACE

#define TARGET_IO_PORTA 0xffff
#define TARGET_IO_PORTB 0xffff
#define TARGET_IO_PORTC 0xffff
#define TARGET_IO_PORTD 0xffff
#define TARGET_IO_PORTE 0xffff
#define TARGET_IO_PORTF 0xffff
#define TARGET_IO_PORTG 0xffff

/* The eight MAIN outputs and physical RC input belong to the Cube IOMCU. */
#define MAX_PWM_OUTPUT_PORTS 6
