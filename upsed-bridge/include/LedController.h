#pragma once

#include <Arduino.h>
#include "config.h"

// ============================================================================
// UPSED Bridge LED State Controller
// Non-blocking, priority-driven status lighting for WS2812 RGB LED
// ============================================================================

enum WifiLedState {
    WIFI_LED_BOOT,
    WIFI_LED_CONNECTING,
    WIFI_LED_CONNECTED,
    WIFI_LED_AUTH_FAIL,
    WIFI_LED_DISCONNECTED
};

enum UpsLedState {
    UPS_LED_UNKNOWN,
    UPS_LED_HEALTHY,
    UPS_LED_ON_BATTERY,
    UPS_LED_ERROR
};

enum ModeLedState {
    MODE_LED_PROXY,
    MODE_LED_STANDALONE,
    MODE_LED_OTA
};

class LedController {
public:
    LedController()
        : wifiState(WIFI_LED_BOOT),
          upsState(UPS_LED_UNKNOWN),
          modeState(MODE_LED_STANDALONE),
          lastActivityMs(0),
          lastRenderedR(255),
          lastRenderedG(255),
          lastRenderedB(255),
          lastUpdateMs(0) {}

    void setWifiState(WifiLedState state) {
        wifiState = state;
    }

    void setUpsState(UpsLedState state) {
        upsState = state;
    }

    void setMode(ModeLedState mode) {
        modeState = mode;
    }

    // Trigger a brief 60ms Blue activity flash when a command is executed
    void triggerActivityTick() {
        lastActivityMs = millis();
    }

    // Force immediate render (used during setup/boot)
    void forceUpdate() {
        lastUpdateMs = 0;
        lastRenderedR = 255;
        lastRenderedG = 255;
        lastRenderedB = 255;
        update();
    }

    // Called on every loop() cycle - completely non-blocking
    void update() {
        unsigned long now = millis();
        // Update LED at ~60 Hz (every 16ms) to avoid saturating GPIO / RMT bus
        if (lastUpdateMs != 0 && (now - lastUpdateMs < 16)) {
            return;
        }
        lastUpdateMs = now;

        uint8_t r = 0, g = 0, b = 0;

        // --------------------------------------------------------------------
        // Priority 1: OTA Flashing Mode (Active Firmware Upload)
        // Pattern: Pulsing Magenta (Pink-Purple)
        // --------------------------------------------------------------------
        if (modeState == MODE_LED_OTA) {
            uint8_t pulse = getBreathingFactor(now, 1200, 20, 80);
            r = pulse;
            g = 0;
            b = pulse;
            applyColor(r, g, b);
            return;
        }

        // --------------------------------------------------------------------
        // Priority 2: Critical AC Outage / Utility Fail (UPS on Battery)
        // Pattern: Fast Pulsing Alert Red (700ms cycle)
        // --------------------------------------------------------------------
        if (upsState == UPS_LED_ON_BATTERY) {
            uint8_t pulse = getBreathingFactor(now, 700, 15, 90);
            r = pulse;
            g = 0;
            b = 0;
            applyColor(r, g, b);
            return;
        }

        // --------------------------------------------------------------------
        // Priority 3: Wi-Fi Error or Reconnecting
        // --------------------------------------------------------------------
        if (wifiState == WIFI_LED_AUTH_FAIL) {
            // Fast double-blink Red (1200ms pattern: blink-blink-pause)
            uint16_t t = now % 1200;
            bool on = (t < 140) || (t >= 280 && t < 420);
            r = on ? 80 : 0;
            applyColor(r, 0, 0);
            return;
        }

        if (wifiState == WIFI_LED_DISCONNECTED) {
            // Slow blinking Amber (1000ms pattern: 500ms ON / 500ms OFF)
            bool on = (now % 1000) < 500;
            r = on ? 50 : 0;
            g = on ? 20 : 0;
            applyColor(r, g, 0);
            return;
        }

        if (wifiState == WIFI_LED_CONNECTING || wifiState == WIFI_LED_BOOT) {
            // Fast pulsing Amber (900ms cycle) while associating or booting
            uint8_t pulse = getBreathingFactor(now, 900, 10, 60);
            r = pulse;
            g = pulse / 2;
            applyColor(r, g, 0);
            return;
        }

        // --------------------------------------------------------------------
        // Priority 4: Momentary Command Activity Flash in Proxy Mode
        // Pattern: Brief 60ms Blue tick
        // --------------------------------------------------------------------
        if (modeState == MODE_LED_PROXY && (now - lastActivityMs < 60)) {
            applyColor(0, 0, 70);
            return;
        }

        // --------------------------------------------------------------------
        // Priority 5: Active Desktop Connection (Proxy Mode)
        // --------------------------------------------------------------------
        if (modeState == MODE_LED_PROXY) {
            if (upsState == UPS_LED_ERROR) {
                // Connected to desktop, but UPS serial port is timing out / NAK
                // Pattern: Pulsing Yellow
                uint8_t pulse = getBreathingFactor(now, 1500, 15, 60);
                r = pulse;
                g = (pulse * 3) / 5;
                applyColor(r, g, 0);
            } else {
                // Fully healthy: Solid Green
                applyColor(0, 45, 0);
            }
            return;
        }

        // --------------------------------------------------------------------
        // Priority 6: Desktop Offline (Standalone Logging Mode)
        // --------------------------------------------------------------------
        if (upsState == UPS_LED_ERROR) {
            // Wi-Fi online, but desktop offline AND UPS serial is silent/error
            // Pattern: Slow Amber/Yellow Pulse (1800ms)
            uint8_t pulse = getBreathingFactor(now, 1800, 10, 50);
            r = pulse;
            g = pulse / 2;
            applyColor(r, g, 0);
        } else {
            // Wi-Fi online and UPS healthy, actively logging to PSRAM buffer
            // Pattern: Gentle Breathing Cyan (2400ms cycle)
            uint8_t pulse = getBreathingFactor(now, 2400, 8, 45);
            r = 0;
            g = (pulse * 3) / 4;
            b = pulse;
            applyColor(r, g, b);
        }
    }

private:
    WifiLedState wifiState;
    UpsLedState upsState;
    ModeLedState modeState;
    unsigned long lastActivityMs;
    uint8_t lastRenderedR;
    uint8_t lastRenderedG;
    uint8_t lastRenderedB;
    unsigned long lastUpdateMs;

    // Helper: Linear breathing wave without floating point or trigonometrics
    uint8_t getBreathingFactor(unsigned long now, uint16_t periodMs, uint8_t minVal, uint8_t maxVal) {
        if (periodMs == 0) return maxVal;
        uint16_t phase = now % periodMs;
        uint16_t half = periodMs / 2;
        uint8_t range = maxVal - minVal;
        if (phase < half) {
            return minVal + static_cast<uint8_t>((static_cast<uint32_t>(phase) * range) / half);
        } else {
            return minVal + static_cast<uint8_t>((static_cast<uint32_t>(periodMs - phase) * range) / half);
        }
    }

    void applyColor(uint8_t r, uint8_t g, uint8_t b) {
        if (r != lastRenderedR || g != lastRenderedG || b != lastRenderedB) {
            lastRenderedR = r;
            lastRenderedG = g;
            lastRenderedB = b;
            setBridgeLed(r, g, b);
        }
    }
};
