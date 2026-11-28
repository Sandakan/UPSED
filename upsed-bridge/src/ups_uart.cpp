#include "ups_uart.h"
#include "bridge_state.h"

static unsigned long lastUpsCmdEndMs = 0;

static String readUpsFrame() {
    String response = "";
    unsigned long startWait = millis();
    while (millis() - startWait < UPS_READ_TIMEOUT_MS) {
        if (UpsSerial.available()) {
            char c = static_cast<char>(UpsSerial.read());
            if (c == '\r') {
                break;
            }
            if (c != '\n') {
                response += c;
            }
        } else {
            delay(1);
        }
    }
    response.trim();
    return response;
}

String executeUpsCommand(const String& rawCmd, bool isStandalonePoll) {
    (void)isStandalonePoll;
    unsigned long now = millis();
    unsigned long elapsed = now - lastUpsCmdEndMs;
    if (elapsed < UPS_GUARD_DELAY_MS) {
        delay(UPS_GUARD_DELAY_MS - elapsed);
    }

    while (UpsSerial.available()) {
        UpsSerial.read();
    }

    String cleanCmd = rawCmd;
    cleanCmd.trim();
    if (cleanCmd.length() == 0) {
        lastUpsCmdEndMs = millis();
        return "";
    }

    ledController.triggerActivityTick();

    UpsSerial.print(cleanCmd);
    UpsSerial.print('\r');
    UpsSerial.flush();

    String response = readUpsFrame();

    // 150ms retry logic for Megatec/P01 Q1 query (up to 2 retries, 3 attempts total)
    if ((response.length() == 0 || response.startsWith("(NAK")) && cleanCmd == "Q1") {
        for (int retry = 1; retry <= 2; retry++) {
            delay(150);
            while (UpsSerial.available()) {
                UpsSerial.read();
            }
            UpsSerial.print("Q1\r");
            UpsSerial.flush();

            response = readUpsFrame();
            if (response.startsWith("(") && !response.startsWith("(NAK")) {
                break;
            }
        }
        if (response.length() == 0 || response.startsWith("(NAK")) {
            diagLog.warn("[UPS] Q1 failed after 3 attempts (resp: '%s')", response.c_str());
        }
    }

    lastUpsCmdEndMs = millis();

    if (response.length() == 0 || response.startsWith("(NAK")) {
        ledController.setUpsState(UPS_LED_ERROR);
        if (cleanCmd == "Q1") {
            cmdCache.clearNegative();
        } else if (upsTelemetry.valid && UpsCommandCache::isStaticIdentityQuery(cleanCmd)) {
            cmdCache.put(cleanCmd, response, true);
        }
    } else if (response.startsWith("(")) {
        if (UpsCommandCache::isReadOnlyQuery(cleanCmd)) {
            cmdCache.put(cleanCmd, response, false);
        } else {
            cmdCache.invalidateDynamic();
        }

        if (cleanCmd == "Q1") {
            upsTelemetry.parseQ1Response(response);
            tuyaController.updateContextState(upsTelemetry, currentMode == MODE_PROXY);
        } else if (cleanCmd == "QSK1") {
            upsTelemetry.parseQskResponse(1, response);
        } else if (cleanCmd == "QSK2") {
            upsTelemetry.parseQskResponse(2, response);
        }

        if (!UpsCommandCache::isReadOnlyQuery(cleanCmd) && !inPostCmdSync) {
            inPostCmdSync = true;
            postCmdSettleUntilMs = millis() + 15000UL;
            String q1Resp = executeUpsCommand("Q1", false);
            inPostCmdSync = false;
            if (q1Resp.startsWith("(") && !q1Resp.startsWith("(NAK")) {
                broadcastStateChanged(q1Resp, "post_command");
            }
        }

        int lastSpace = response.lastIndexOf(' ');
        if (lastSpace > 0 && (response.length() - lastSpace - 1) == 8) {
            char utilityFailBit = response.charAt(lastSpace + 1);
            if (utilityFailBit == '1') {
                ledController.setUpsState(UPS_LED_ON_BATTERY);
                return response;
            }
        }
        ledController.setUpsState(UPS_LED_HEALTHY);
    }

    return response;
}
