#pragma once

#include <Arduino.h>
#include "config.h"
#include "rtc_clock.h"

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
    MODE_LED_OTA,
    MODE_LED_OTA_AUTH,
    MODE_LED_OTA_FLASHING = MODE_LED_OTA
};

enum TuyaLedState {
    TUYA_LED_DISABLED,
    TUYA_LED_CONNECTING,
    TUYA_LED_CONNECTED,
    TUYA_LED_ERROR
};

class LedController {
public:
    LedController()
        : wifiState(WIFI_LED_BOOT),
          upsState(UPS_LED_UNKNOWN),
          modeState(MODE_LED_STANDALONE),
          tuyaState(TUYA_LED_DISABLED),
          lastActivityMs(0),
          lastTuyaPublishMs(0),
          tuyaConnectingStartMs(0),
          lastRenderedR(255),
          lastRenderedG(255),
          lastRenderedB(255),
          lastUpdateMs(0),
          nightEnabled(false),
          nightType(0),
          nightDimPct(10),
          nightWakeAlert(true),
          nightStartMin(1320), // 22:00
          nightEndMin(420),    // 07:00
          nightOverride(0),
          stealthEnabled(false),
          stealthType(0),
          stealthDimPct(10) {}

    void setWifiState(WifiLedState state) {
        wifiState = state;
    }

    void setUpsState(UpsLedState state) {
        upsState = state;
    }

    void setMode(ModeLedState mode) {
        modeState = mode;
    }

    void setTuyaState(TuyaLedState state) {
        if (state == TUYA_LED_CONNECTING && tuyaState != TUYA_LED_CONNECTING) {
            tuyaConnectingStartMs = millis();
        }
        tuyaState = state;
    }

    // ------------------------------------------------------------------------
    // Illumination Policy Configuration (Night Mode & Desktop Stealth)
    // ------------------------------------------------------------------------
    void setNightModeConfig(bool enabled, uint8_t type, uint8_t dimPct, bool wakeAlert, uint16_t startMin, uint16_t endMin) {
        nightEnabled = enabled;
        nightType = (type == 1) ? 1 : 0;
        nightDimPct = constrain(dimPct, 5, 30);
        nightWakeAlert = wakeAlert;
        nightStartMin = (startMin < 1440) ? startMin : 1320;
        nightEndMin = (endMin < 1440) ? endMin : 420;
        forceUpdate();
    }

    void setNightOverride(int8_t overrideVal) {
        nightOverride = (overrideVal > 0) ? 1 : (overrideVal < 0) ? -1 : 0;
        forceUpdate();
    }

    void setProxyStealthConfig(bool enabled, uint8_t type, uint8_t dimPct) {
        stealthEnabled = enabled;
        stealthType = (type == 1) ? 1 : 0;
        stealthDimPct = constrain(dimPct, 5, 30);
        forceUpdate();
    }

    bool isNightModeActive() const {
        if (nightOverride == 1) return true;
        if (nightOverride == -1) return false;
        if (!nightEnabled) return false;

        extern BridgeClock bridgeClock;
        if (!bridgeClock.isSynced()) return false;

        uint16_t currMin = bridgeClock.localMinuteOfDay();
        if (nightStartMin <= nightEndMin) {
            return (currMin >= nightStartMin && currMin < nightEndMin);
        } else {
            return (currMin >= nightStartMin || currMin < nightEndMin);
        }
    }

    bool isProxyStealthActive() const {
        return stealthEnabled && (modeState == MODE_LED_PROXY);
    }

    bool isNightEnabled() const { return nightEnabled; }
    uint8_t getNightType() const { return nightType; }
    uint8_t getNightDimPct() const { return nightDimPct; }
    bool getNightWakeAlert() const { return nightWakeAlert; }
    uint16_t getNightStartMin() const { return nightStartMin; }
    uint16_t getNightEndMin() const { return nightEndMin; }
    int8_t getNightOverride() const { return nightOverride; }

    bool isStealthEnabled() const { return stealthEnabled; }
    uint8_t getStealthType() const { return stealthType; }
    uint8_t getStealthDimPct() const { return stealthDimPct; }

    // Trigger a brief 60ms Blue activity flash when a command is executed
    void triggerActivityTick() {
        lastActivityMs = millis();
    }

    // Trigger a brief 80ms Mint/White activity flash when telemetry is published to Tuya
    void triggerTuyaPublishTick() {
        lastTuyaPublishMs = millis();
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
        // Priority 1A: OTA Authenticating / Handshaking / Lease Staged
        // Pattern: Sharp Blinking Magenta (400ms: 200ms ON / 200ms OFF)
        // --------------------------------------------------------------------
        if (modeState == MODE_LED_OTA_AUTH) {
            bool on = (now % 400) < 200;
            uint8_t mag = on ? 85 : 0;
            applyColor(mag, 0, mag);
            return;
        }

        // --------------------------------------------------------------------
        // Priority 1B: OTA Active Flashing Mode (Writing Firmware Stream)
        // Pattern: Pulsing Magenta (Pink-Purple, 800ms wave)
        // --------------------------------------------------------------------
        if (modeState == MODE_LED_OTA) {
            uint8_t pulse = getBreathingFactor(now, 800, 20, 95);
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
        // Priority 4: Momentary Command Activity Flash or Tuya Publish Tick
        // --------------------------------------------------------------------
        if (modeState == MODE_LED_PROXY && (now - lastActivityMs < 60)) {
            applyColor(0, 0, 70);
            return;
        }

        if (tuyaState != TUYA_LED_DISABLED && (now - lastTuyaPublishMs < 80)) {
            applyColor(10, 75, 55); // Brief 80ms Mint/White tick on Tuya publish
            return;
        }

        // --------------------------------------------------------------------
        // Tuya Cloud Status Overlay (Only when UPS is healthy and not in error)
        // Overlays subtle pulses/blinks every 3000ms over base Green/Cyan mode
        // --------------------------------------------------------------------
        if (upsState != UPS_LED_ERROR && tuyaState != TUYA_LED_DISABLED && tuyaState != TUYA_LED_CONNECTED) {
            if (tuyaState == TUYA_LED_CONNECTING) {
                bool immediateFlash = (tuyaConnectingStartMs > 0 && (now - tuyaConnectingStartMs < 200));
                uint16_t cycle = now % 3000;
                if (immediateFlash || cycle < 450) {
                    uint8_t p = getBreathingFactor(cycle, 450, 15, 75);
                    applyColor(p, 0, (p * 4) / 3); // Violet pulse (55, 0, 80)
                    return;
                }
            } else if (tuyaState == TUYA_LED_ERROR) {
                uint16_t cycle = now % 3000;
                if ((cycle < 100) || (cycle >= 200 && cycle < 300)) {
                    applyColor(80, 20, 0); // Alert Orange double-blink
                    return;
                }
            }
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
    TuyaLedState tuyaState;
    unsigned long lastActivityMs;
    unsigned long lastTuyaPublishMs;
    unsigned long tuyaConnectingStartMs;
    uint8_t lastRenderedR;
    uint8_t lastRenderedG;
    uint8_t lastRenderedB;
    unsigned long lastUpdateMs;

    // Illumination Policy State
    bool nightEnabled;
    uint8_t nightType;
    uint8_t nightDimPct;
    bool nightWakeAlert;
    uint16_t nightStartMin;
    uint16_t nightEndMin;
    int8_t nightOverride;
    bool stealthEnabled;
    uint8_t stealthType;
    uint8_t stealthDimPct;

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

    uint8_t scaleDimmed(uint8_t val, uint8_t pct) const {
        if (val == 0) return 0;
        uint32_t scaled = (static_cast<uint32_t>(val) * pct) / 100UL;
        return (scaled == 0) ? 1 : static_cast<uint8_t>(scaled);
    }

    void applyColor(uint8_t r, uint8_t g, uint8_t b) {
        uint8_t outR = r;
        uint8_t outG = g;
        uint8_t outB = b;

        bool isCriticalAlert = (upsState == UPS_LED_ON_BATTERY || upsState == UPS_LED_ERROR || modeState == MODE_LED_OTA || modeState == MODE_LED_OTA_AUTH);

        // Priority 1: Critical alert wake-up bypasses night mode and stealth mode
        if (isCriticalAlert && nightWakeAlert) {
            // Keep full unscaled brightness
        } else if (isNightModeActive()) {
            if (nightType == 1) {
                // Completely Off
                outR = 0;
                outG = 0;
                outB = 0;
            } else {
                // Dimmed (scale down to nightDimPct)
                outR = scaleDimmed(outR, nightDimPct);
                outG = scaleDimmed(outG, nightDimPct);
                outB = scaleDimmed(outB, nightDimPct);
            }
        } else if (isProxyStealthActive()) {
            if (stealthType == 1) {
                // Completely Off
                outR = 0;
                outG = 0;
                outB = 0;
            } else {
                // Dimmed (scale down to stealthDimPct)
                outR = scaleDimmed(outR, stealthDimPct);
                outG = scaleDimmed(outG, stealthDimPct);
                outB = scaleDimmed(outB, stealthDimPct);
            }
        }

        if (outR != lastRenderedR || outG != lastRenderedG || outB != lastRenderedB) {
            lastRenderedR = outR;
            lastRenderedG = outG;
            lastRenderedB = outB;
            setBridgeLed(outR, outG, outB);
        }
    }
};
