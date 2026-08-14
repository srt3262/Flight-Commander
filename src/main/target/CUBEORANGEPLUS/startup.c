/*
 * CubePilot Cube Orange+ bootloader-to-application handoff.
 *
 * The register state below is pinned to the ArduPilot 4.7.0 CubeOrangePlus hwdef.dat
 * startup contract at commit
 * 1511f27194f1dcc3728270883047bdf022b3fd53.  It runs before the C runtime is
 * initialized, so this file must not depend on writable static storage.
 */

#include <stdint.h>

#include "platform.h"

typedef struct cubeGpioConfig_s {
    uint32_t moder;
    uint32_t otyper;
    uint32_t ospeedr;
    uint32_t pupdr;
    uint32_t odr;
    uint32_t afrl;
    uint32_t afrh;
} cubeGpioConfig_t;

static const cubeGpioConfig_t cubeGpioConfig[] = {
    { 0xAA81ABFAU, 0x00000200U, 0xAAAAAAAAU, 0x24000005U, 0x0000FEFFU, 0x55500088U, 0x100AA000U },
    { 0xAAAA210FU, 0x00000F00U, 0xAAAAAAAAU, 0x00004400U, 0x0000FFFFU, 0x09000000U, 0x55594444U },
    { 0x56AAAFD4U, 0x00000000U, 0xAAAAAAAAU, 0x54555015U, 0x0000FFFFU, 0x77000000U, 0x000CCCCCU },
    { 0x299A69AAU, 0x00000000U, 0xAA8AAAAAU, 0x02555650U, 0x0000FFFFU, 0x07707C99U, 0x02207077U },
    { 0x298AA96AU, 0x00001000U, 0xAAAAAAAAU, 0x40114105U, 0x0000FFF7U, 0x75500588U, 0x01101017U },
    { 0xA0000000U, 0x0000C000U, 0xAAAAAAAAU, 0x00000000U, 0x0000FFFFU, 0x00000000U, 0x44000000U },
    { 0x00000004U, 0x00000000U, 0xAAAAAAAAU, 0x00000004U, 0x0000FFFFU, 0x00000000U, 0x00000000U },
    { 0x00000000U, 0x00000000U, 0xAAAAAAAAU, 0x00000000U, 0x0000FFFFU, 0x00000000U, 0x00000000U },
    { 0x00000000U, 0x00000000U, 0xAAAAAAAAU, 0x00000000U, 0x0000FFFFU, 0x00000000U, 0x00000000U },
    { 0x00000000U, 0x00000000U, 0xAAAAAAAAU, 0x00000000U, 0x0000FFFFU, 0x00000000U, 0x00000000U },
    { 0x00000000U, 0x00000000U, 0xAAAAAAAAU, 0x00000000U, 0x0000FFFFU, 0x00000000U, 0x00000000U },
};

static void cubeInterruptStateReset(void)
{
    SysTick->CTRL = 0U;
    SysTick->LOAD = 0U;
    SysTick->VAL = 0U;
    SCB->ICSR = SCB_ICSR_PENDSTCLR_Msk | SCB_ICSR_PENDSVCLR_Msk;

    for (unsigned i = 0; i < 8U; i++) {
        NVIC->ICER[i] = 0xFFFFFFFFU;
        NVIC->ICPR[i] = 0xFFFFFFFFU;
    }

    __DSB();
    __ISB();
}

static void cubeGpioResetAndInit(void)
{
    RCC->AHB4RSTR |= 0x000007FFU;
    RCC->AHB4RSTR &= ~0x000007FFU;
    RCC->AHB4ENR |= 0x000007FFU;
    RCC->AHB4LPENR |= 0x000007FFU;
    (void)RCC->AHB4ENR;

    GPIO_TypeDef *gpio = GPIOA;
    for (unsigned i = 0; i < 11U; i++) {
        const cubeGpioConfig_t *config = &cubeGpioConfig[i];
        gpio->OTYPER = config->otyper;
        gpio->OSPEEDR = config->ospeedr;
        gpio->PUPDR = config->pupdr;
        gpio->ODR = config->odr;
        gpio->AFR[0] = config->afrl;
        gpio->AFR[1] = config->afrh;
        gpio->MODER = config->moder;
        gpio = (GPIO_TypeDef *)((uintptr_t)gpio + 0x400U);
    }
}

static void cubePowerInit(void)
{
    PWR->CR3 = 0x00000004U;
    while ((PWR->CSR1 & 0x00002000U) == 0U) {
    }

    PWR->CR1 = 0xF000C000U;
    PWR->CR2 = 0x00000001U;
    PWR->CR3 = 0x01000004U;
    PWR->CPUCR = 0x00000000U;
    PWR->D3CR = 0x0000C000U;
    while ((PWR->D3CR & 0x00002000U) == 0U) {
    }
}

static void cubeClockInit(void)
{
    *(volatile uint32_t *)0x51008108U = 0x00000001U;
    RCC->APB4ENR |= 0x00000002U;
    RCC->APB4LPENR |= 0x00000002U;

    cubePowerInit();
    PWR->CR1 |= 0x00000100U;

    if ((RCC->BDCR & 0x00000300U) != 0U) {
        RCC->BDCR = 0x00010000U;
        RCC->BDCR = 0x00000000U;
    }

    RCC->CR |= 0x00000001U;
    while ((RCC->CR & 0x00000004U) == 0U) {
    }
    RCC->CFGR = 0x00000000U;
    while ((RCC->CFGR & 0x00000038U) != 0U) {
    }

    RCC->CR = 0x00000001U;
    RCC->HSICFGR = 0x40000000U;
    RCC->CSICFGR = 0x20000000U;
    RCC->CSR = 0x00000000U;
    RCC->PLLCFGR = 0x01FF0000U;
    RCC->CFGR = 0x08908800U;

    RCC->CR |= 0x00010000U;
    while ((RCC->CR & 0x00020000U) == 0U) {
    }
    RCC->CR |= 0x00001000U;
    while ((RCC->CR & 0x00002000U) == 0U) {
    }

    RCC->PLLCKSELR = 0x00602032U;
    RCC->PLL1FRACR = 0x00000000U;
    RCC->PLL1DIVR = 0x01090263U;
    RCC->PLL2FRACR = 0x00000000U;
    RCC->PLL2DIVR = 0x02050431U;
    RCC->PLL3FRACR = 0x00000000U;
    RCC->PLL3DIVR = 0x08050E47U;
    RCC->PLLCFGR = 0x01BF0BDDU;

    RCC->CR |= 0x15000000U;
    while ((RCC->CR & 0x2A000000U) != 0x2A000000U) {
    }

    RCC->D1CFGR = 0x00000048U;
    RCC->D2CFGR = 0x00000440U;
    RCC->D3CFGR = 0x00000040U;
    RCC->D1CCIPR = 0x20000020U;
    RCC->D2CCIP1R = 0x10010000U;
    RCC->D2CCIP2R = 0x00E01009U;
    RCC->D3CCIPR = 0x10010100U;

    FLASH->ACR = 0x00000032U;
    while ((FLASH->ACR & 0x0000000FU) != 0x00000002U) {
    }

    RCC->CFGR |= 0x00000003U;
    while ((RCC->CFGR & 0x00000038U) != 0x00000018U) {
    }

    RCC->AHB2ENR |= 0xE0000000U;
    RCC->AHB2LPENR |= 0xE0000000U;
}

static void cubeDisableCm4Boot(void)
{
    if ((FLASH->OPTSR_CUR & 0x00400000U) == 0U) {
        return;
    }

    if ((FLASH->OPTCR & 0x00000001U) != 0U) {
        FLASH->OPTKEYR = 0x08192A3BU;
        FLASH->OPTKEYR = 0x4C5D6E7FU;
    }
    while ((FLASH->OPTSR_CUR & 0x00000001U) != 0U) {
    }

    FLASH->OPTSR_PRG &= 0xFFBFFFFFU;
    FLASH->OPTCR |= 0x00000002U;
    while ((FLASH->OPTSR_CUR & 0x00000001U) != 0U) {
    }

    FLASH->OPTCR |= 0x00000001U;
    while ((FLASH->OPTSR_CUR & 0x00000001U) != 0U) {
    }
}

void cubeOrangePlusEarlyInit(void)
{
    cubeInterruptStateReset();
    cubeGpioResetAndInit();
    cubeClockInit();

    SCB->ITCMCR |= 0x00000001U;
    SCB->DTCMCR |= 0x00000001U;
    __DSB();
    __ISB();

    cubeDisableCm4Boot();
}
