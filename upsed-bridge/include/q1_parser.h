#pragma once

#include <Arduino.h>

// ============================================================================
// UPSED Hardware Bridge — Lightweight Megatec Q1 / QSK Telemetry Parser
// ============================================================================
// Parses standard Q1 replies: "(MMM.M NNN.N PPP.P QQQ RR.R S.SS TT.T b7b6b5b4b3b2b1b0"
// Example: "(230.0 230.0 230.0 015 50.0 13.6 32.5 00001001"
// ============================================================================

struct UpsTelemetrySnapshot {
    bool valid = false;
    unsigned long lastUpdateMs = 0;

    float gridVoltage = 0.0f;
    float faultVoltage = 0.0f;
    float outputVoltage = 0.0f;
    int loadPct = 0;
    float freqHz = 0.0f;
    float batteryVoltage = 0.0f;
    int batteryPct = 0;
    float temperatureC = 0.0f;

    // 8-bit status flags (b7..b0)
    bool utilityFail = false;     // b7
    bool batteryLow = false;      // b6
    bool avrActive = false;       // b5
    bool upsFailed = false;       // b4
    bool standbyType = false;     // b3
    bool testInProgress = false;  // b2
    bool shutdownActive = false;  // b1
    bool beeperOn = false;        // b0

    // Derived & auxiliary states
    bool outputEnabled = false;
    bool outlet1On = true;
    bool outlet2On = true;

    const char* upsModeStr() const {
        if (!valid) return "standby";
        if (upsFailed) return "fault";
        if (utilityFail) return "battery";
        if (outputVoltage < 80.0f) return "standby";
        if (avrActive) return "bypass";
        return "line";
    }

    static int estimateBatterySoc(float battV) {
        if (battV <= 0.1f) return 0;
        // Auto-detect nominal 12V / 24V / 36V / 48V lead-acid bank or single cell voltage (1.75V-2.30V/cell)
        float vPer12V = battV;
        if (battV < 4.0f) {
            // Cell voltage (6 cells per 12V block)
            vPer12V = battV * 6.0f;
        } else if (battV >= 40.0f) {
            vPer12V = battV / 4.0f;
        } else if (battV >= 30.0f) {
            vPer12V = battV / 3.0f;
        } else if (battV >= 18.0f) {
            vPer12V = battV / 2.0f;
        }

        // Linearly map 10.5V (0%) -> 13.4V (100%)
        float pct = ((vPer12V - 10.5f) / (13.4f - 10.5f)) * 100.0f;
        if (pct < 0.0f) pct = 0.0f;
        if (pct > 100.0f) pct = 100.0f;
        return static_cast<int>(pct + 0.5f);
    }

    bool parseQ1Response(const String& raw) {
        if (!raw.startsWith("(") || raw.startsWith("(NAK") || raw.length() < 36) {
            return false;
        }

        String body = raw.substring(1);
        body.trim();

        // Tokenize 8 space-separated fields
        String tokens[8];
        int tokenCount = 0;
        int startIdx = 0;
        for (size_t i = 0; i <= body.length() && tokenCount < 8; i++) {
            if (i == body.length() || body.charAt(i) == ' ') {
                if (i > static_cast<size_t>(startIdx)) {
                    tokens[tokenCount++] = body.substring(startIdx, i);
                }
                startIdx = i + 1;
            }
        }

        if (tokenCount < 8 || tokens[7].length() < 8) {
            return false;
        }

        gridVoltage = tokens[0].toFloat();
        faultVoltage = tokens[1].toFloat();
        outputVoltage = tokens[2].toFloat();
        loadPct = tokens[3].toInt();
        freqHz = tokens[4].toFloat();
        batteryVoltage = tokens[5].toFloat();
        temperatureC = tokens[6].toFloat();

        const String& bits = tokens[7];
        utilityFail    = (bits.charAt(0) == '1');
        batteryLow     = (bits.charAt(1) == '1');
        avrActive      = (bits.charAt(2) == '1');
        upsFailed      = (bits.charAt(3) == '1');
        standbyType    = (bits.charAt(4) == '1');
        testInProgress = (bits.charAt(5) == '1');
        shutdownActive = (bits.charAt(6) == '1');
        beeperOn       = (bits.charAt(7) == '1');

        batteryPct = estimateBatterySoc(batteryVoltage);
        outputEnabled = (outputVoltage >= 80.0f);
        valid = true;
        lastUpdateMs = millis();
        return true;
    }

    bool hasDiscreteEdgeChange(const UpsTelemetrySnapshot& prev) const {
        if (!prev.valid || !valid) return false;
        return (utilityFail != prev.utilityFail) ||
               (batteryLow != prev.batteryLow) ||
               (avrActive != prev.avrActive) ||
               (upsFailed != prev.upsFailed) ||
               (testInProgress != prev.testInProgress) ||
               (shutdownActive != prev.shutdownActive) ||
               (beeperOn != prev.beeperOn) ||
               (outputEnabled != prev.outputEnabled) ||
               (outlet1On != prev.outlet1On) ||
               (outlet2On != prev.outlet2On) ||
               ((loadPct > 100) != (prev.loadPct > 100)) ||
               ((temperatureC >= 55.0f) != (prev.temperatureC >= 55.0f));
    }

    bool isUrgentCondition() const {
        if (!valid) return false;
        return testInProgress || shutdownActive || utilityFail || batteryLow ||
               avrActive || upsFailed || (loadPct > 100) || (temperatureC >= 55.0f);
    }

    void parseQskResponse(int idx, const String& raw) {
        if (raw.startsWith("(1")) {
            if (idx == 1) outlet1On = true;
            if (idx == 2) outlet2On = true;
        } else if (raw.startsWith("(0")) {
            if (idx == 1) outlet1On = false;
            if (idx == 2) outlet2On = false;
        }
    }
};
