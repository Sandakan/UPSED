#pragma once

#include <Arduino.h>

// ============================================================================
// UPSED Hardware Bridge — Pin & Timing Configuration (ESP32-S3 DevKitC-1)
// ============================================================================

#define BRIDGE_MAGIC_ID        "UPSED_BRIDGE_V1"
#define BRIDGE_FIRMWARE_VER    "1.0.1"
#define BRIDGE_MDNS_HOSTNAME   "upsed-bridge"
#define BRIDGE_WS_PORT         81
#define BRIDGE_OTA_PORT        8080
#define BRIDGE_OTA_LEASE_MS    90000UL   // 90s auto-abort lease for on-demand HTTP OTA

#ifndef BRIDGE_OTA_SECRET
#define BRIDGE_OTA_SECRET      "upsed-ota-default-secret"
#endif

// UART0 (USB Serial Bridge to Desktop PC)
#define PC_SERIAL_BAUD         115200

// UART1 (MAX3232 RS-232 Transceiver to Voltronic/Megatec UPS)
#define UPS_RX_PIN             17
#define UPS_TX_PIN             18
#define UPS_BAUD               2400
#define UPS_READ_TIMEOUT_MS    900

// Role Handoff & Standalone Polling Intervals
#define PROXY_TIMEOUT_MS       15000UL   // Switch to Standalone Mode after 15s of PC silence
#define STANDALONE_POLL_MS     10000UL   // Poll Q1 every 10s while in Standalone Mode
#define WIFI_RETRY_INTERVAL_MS 30000UL   // Retry saved Wi-Fi every 30s if disconnected

// MessagePack PSRAM Ring Buffer Sizing
// 8192 slots * 96 bytes = 768 KB in 8MB PSRAM (~22.7 hours at 10s interval)
#define BACKLOG_PSRAM_CAPACITY 8192
#define BACKLOG_FALLBACK_CAP   256       // Fallback capacity if PSRAM is unavailable
#define BACKLOG_SLOT_BYTES     96        // Max bytes per MessagePack-encoded slot

// Addressable WS2812 RGB LED Pins (ESP32-S3 DevKitC-1 clones use GPIO 48 or 38)
#define RGB_PIN_PRIMARY        48
#define RGB_PIN_ALT            38

inline void setBridgeLed(uint8_t r, uint8_t g, uint8_t b) {
#ifdef RGB_BUILTIN
    neopixelWrite(RGB_BUILTIN, r, g, b);
#else
    neopixelWrite(RGB_PIN_PRIMARY, r, g, b);
#endif

    uint8_t primaryPin = 48;
#ifdef RGB_BUILTIN
    primaryPin = RGB_BUILTIN;
#endif
    if (RGB_PIN_ALT != primaryPin) {
        delayMicroseconds(60); // Allow WS2812 latch reset (>50us) to avoid RMT channel collision
        neopixelWrite(RGB_PIN_ALT, r, g, b);
    }
}
