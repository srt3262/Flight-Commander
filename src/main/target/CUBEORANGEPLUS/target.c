/*
 * Flight Commander target hardware for the CubePilot Cube Orange+.
 */

#include <stdint.h>

#include "platform.h"

#include "drivers/bus.h"
#include "drivers/io.h"
#include "drivers/pwm_mapping.h"
#include "drivers/sensor.h"
#include "drivers/time.h"
#include "drivers/timer.h"

/* ArduPilot ROTATION_YAW_90 maps to INAV CW270_DEG. */
BUSDEV_REGISTER_SPI_TAG(cube_imu0_icm42688, DEVHW_ICM42605, BUS_SPI4, PC15, NONE, 0, DEVFLAGS_NONE, CW270_DEG);
BUSDEV_REGISTER_SPI_TAG(cube_imu0_icm45686, DEVHW_ICM45686, BUS_SPI4, PC15, NONE, 0, DEVFLAGS_NONE, CW270_DEG);

/* ArduPilot ROTATION_PITCH_180_YAW_90 maps to INAV CW270_DEG_FLIP. */
BUSDEV_REGISTER_SPI_TAG(cube_imu1_icm42688, DEVHW_ICM42605, BUS_SPI4, PC13, NONE, 1, DEVFLAGS_NONE, CW270_DEG_FLIP);
BUSDEV_REGISTER_SPI_TAG(cube_imu1_icm45686, DEVHW_ICM45686, BUS_SPI4, PC13, NONE, 1, DEVFLAGS_NONE, CW270_DEG_FLIP);

timerHardware_t timerHardware[] = {
    DEF_TIM(TIM1, CH4, PE14, TIM_USE_OUTPUT_AUTO, 0, 0), /* AUX1 */
    DEF_TIM(TIM1, CH3, PE13, TIM_USE_OUTPUT_AUTO, 0, 1), /* AUX2 */
    DEF_TIM(TIM1, CH2, PE11, TIM_USE_OUTPUT_AUTO, 0, 2), /* AUX3 */
    DEF_TIM(TIM1, CH1, PE9,  TIM_USE_OUTPUT_AUTO, 0, 3), /* AUX4 */
    DEF_TIM(TIM4, CH2, PD13, TIM_USE_OUTPUT_AUTO, 0, 7), /* AUX5 */
    DEF_TIM(TIM4, CH3, PD14, TIM_USE_OUTPUT_AUTO, 0, 0), /* AUX6, no DMA */
    DEF_TIM(TIM2, CH1, PA15, TIM_USE_BEEPER,      0, 0), /* passive buzzer */
};

const int timerHardwareCount = sizeof(timerHardware) / sizeof(timerHardware[0]);

void initialisePreBootHardware(void)
{
    const IO_t peripheralPower = IOGetByTag(IO_TAG(PA8));
    const IO_t sensorPower = IOGetByTag(IO_TAG(PE3));
    const IO_t pwmVoltage = IOGetByTag(IO_TAG(PB4));

    IOInit(peripheralPower, OWNER_SYSTEM, RESOURCE_OUTPUT, 0);
    IOConfigGPIO(peripheralPower, IOCFG_OUT_PP);
    IOLo(peripheralPower); /* nVDD_5V_PERIPH_EN is active-low. */

    IOInit(pwmVoltage, OWNER_SYSTEM, RESOURCE_OUTPUT, 1);
    IOConfigGPIO(pwmVoltage, IOCFG_OUT_PP);
    IOHi(pwmVoltage); /* Select the Cube's 3.3 V FMU PWM level. */

    IOInit(sensorPower, OWNER_SYSTEM, RESOURCE_OUTPUT, 2);
    IOConfigGPIO(sensorPower, IOCFG_OUT_PP);
    IOLo(sensorPower);
    delay(100);
    IOHi(sensorPower);
    delay(10);
}
