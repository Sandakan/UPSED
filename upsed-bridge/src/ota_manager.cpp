#include "ota_manager.h"
#include "bridge_state.h"

#include <Update.h>
#define private public
#include <ArduinoOTA.h>
#undef private

static String generateEphemeralOtaToken() {
    char buf[33];
    for (int i = 0; i < 4; ++i) {
        uint32_t r = esp_random();
        snprintf(buf + (i * 8), 9, "%08lx", static_cast<unsigned long>(r));
    }
    buf[32] = '\0';
    return String(buf);
}

void stopOtaMode() {
    if (otaServerActive) {
        otaServer.stop();
        otaServerActive = false;
        otaUpdating = false;
        diagLog.info("[OTA] Leased OTA HTTP server stopped. Resuming normal proxy monitoring.");
    }
    activeOtaToken = "";
    otaApprovalExpiryMs = 0;
    bootBtnLowSinceMs = 0;
    if (currentMode == MODE_OTA || currentMode == MODE_OTA_PENDING) {
        currentMode = MODE_PROXY;
        lastDesktopContactMs = millis();
        ledController.setMode(MODE_LED_PROXY);
        ledController.forceUpdate();
    }
}

static void setupOtaHttpEndpoints() {
    otaServer.on("/update", HTTP_POST, []() {
        if (activeOtaToken.isEmpty() || !otaServer.hasHeader("X-UPSED-OTA-TOKEN") || otaServer.header("X-UPSED-OTA-TOKEN") != activeOtaToken) {
            otaServer.send(401, "application/json", "{\"error\":\"Unauthorized: Invalid OTA token\"}");
            return;
        }

        bool success = !Update.hasError();
        String jsonReply = String("{\"success\":") + (success ? "true" : "false") +
                           ",\"rebooting\":" + (success ? "true" : "false") +
                           ",\"error\":\"" + (success ? "" : String(Update.errorString())) + "\"}";
        otaServer.send(success ? 200 : 500, "application/json", jsonReply);

        if (success) {
            diagLog.info("[OTA] Firmware flashing succeeded! Scheduling restart in 250ms...");
            setBridgeLed(0, 90, 0);
            delay(250);
            ESP.restart();
        } else {
            diagLog.error("[OTA] Firmware update failed: %s", Update.errorString());
            stopOtaMode();
        }
    }, []() {
        HTTPUpload& upload = otaServer.upload();
        if (upload.status == UPLOAD_FILE_START) {
            if (activeOtaToken.isEmpty() || !otaServer.hasHeader("X-UPSED-OTA-TOKEN") || otaServer.header("X-UPSED-OTA-TOKEN") != activeOtaToken) {
                diagLog.warn("[OTA] Unauthorized upload attempt rejected (invalid header token).");
                return;
            }

            otaUpdating = true;
            otaLeaseExpiryMs = millis() + 120000UL;
            diagLog.info("[OTA] Commencing firmware stream: %s", upload.filename.c_str());
            currentMode = MODE_OTA;
            ledController.setMode(MODE_LED_OTA_FLASHING);
            ledController.forceUpdate();

            if (!Update.begin(UPDATE_SIZE_UNKNOWN)) {
                diagLog.error("[OTA] Update.begin failed: %s", Update.errorString());
            }
        } else if (upload.status == UPLOAD_FILE_WRITE) {
            currentMode = MODE_OTA;
            ledController.setMode(MODE_LED_OTA_FLASHING);
            ledController.update();
            if (Update.write(upload.buf, upload.currentSize) != upload.currentSize) {
                diagLog.error("[OTA] Update.write failed: %s", Update.errorString());
            }
        } else if (upload.status == UPLOAD_FILE_END) {
            if (Update.end(true)) {
                diagLog.info("[OTA] Flash written cleanly: %u bytes committed", upload.totalSize);
                setBridgeLed(0, 90, 0);
            } else {
                diagLog.error("[OTA] Update.end failed: %s", Update.errorString());
            }
            otaUpdating = false;
        } else if (upload.status == UPLOAD_FILE_ABORTED) {
            Update.end();
            otaUpdating = false;
            diagLog.warn("[OTA] Firmware stream aborted by client.");
            stopOtaMode();
        }
    });

    otaServer.onNotFound([]() {
        otaServer.send(404, "application/json", "{\"error\":\"Not Found\"}");
    });

    const char* headerkeys[] = {"X-UPSED-OTA-TOKEN"};
    size_t headerkeyssize = sizeof(headerkeys) / sizeof(char*);
    otaServer.collectHeaders(headerkeys, headerkeyssize);
}

void startOtaMode() {
    activeOtaToken = generateEphemeralOtaToken();
    currentMode = MODE_OTA;
    otaApprovalExpiryMs = 0;
    bootBtnLowSinceMs = 0;
    ledController.setMode(MODE_LED_OTA_AUTH);
    ledController.forceUpdate();
    setupOtaHttpEndpoints();
    otaServer.begin();
    otaServerActive = true;
    otaUpdating = false;
    otaLeaseExpiryMs = millis() + BRIDGE_OTA_LEASE_MS;
    diagLog.info("[OTA] Leased OTA HTTP server active on port %d (Lease %u sec)",
                 BRIDGE_OTA_PORT, BRIDGE_OTA_LEASE_MS / 1000UL);
}

void beginPendingOtaApproval() {
    activeOtaToken = "";
    currentMode = MODE_OTA_PENDING;
    otaApprovalExpiryMs = millis() + BRIDGE_OTA_APPROVAL_TIMEOUT_MS;
    bootBtnLowSinceMs = 0;
    ledController.setMode(MODE_LED_OTA_AUTH);
    ledController.forceUpdate();
    diagLog.info("[OTA] Awaiting physical BOOT button press (%u sec window)...",
                 BRIDGE_OTA_APPROVAL_TIMEOUT_MS / 1000UL);
}

void initArduinoOta() {
    if (arduinoOtaStarted) return;
    ArduinoOTA.setPort(3232);
    ArduinoOTA.setHostname(BRIDGE_MDNS_HOSTNAME);
    ArduinoOTA.setPassword(BRIDGE_OTA_SECRET);
    ArduinoOTA.onStart([]() {
        currentMode = MODE_OTA;
        ledController.setMode(MODE_LED_OTA_FLASHING);
        ledController.forceUpdate();
        diagLog.info("[OTA] ArduinoOTA flashing started over Wi-Fi...");
    });
    ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
        (void)progress;
        (void)total;
        currentMode = MODE_OTA;
        ledController.setMode(MODE_LED_OTA_FLASHING);
        ledController.update();
    });
    ArduinoOTA.onEnd([]() {
        diagLog.info("[OTA] ArduinoOTA flashing completed! Rebooting...");
        setBridgeLed(0, 90, 0);
        delay(200);
    });
    ArduinoOTA.onError([](ota_error_t error) {
        diagLog.error("[OTA] ArduinoOTA error [%u]", error);
        ledController.setUpsState(UPS_LED_ERROR);
        currentMode = MODE_STANDALONE;
        ledController.setMode(MODE_LED_STANDALONE);
        ledController.forceUpdate();
    });
    ArduinoOTA.begin();
    arduinoOtaStarted = true;
    diagLog.info("[OTA] ArduinoOTA listener started on port 3232");
}

void handleOtaLoop() {
    if (arduinoOtaStarted) {
        if (ArduinoOTA._state == OTA_WAITAUTH) {
            currentMode = MODE_OTA;
            ledController.setMode(MODE_LED_OTA_AUTH);
            ledController.update();
        } else if (currentMode == MODE_OTA && !otaServerActive && ArduinoOTA._state == OTA_IDLE) {
            currentMode = (millis() - lastDesktopContactMs > PROXY_TIMEOUT_MS) ? MODE_STANDALONE : MODE_PROXY;
            ledController.setMode(currentMode == MODE_STANDALONE ? MODE_LED_STANDALONE : MODE_LED_PROXY);
            ledController.forceUpdate();
        }
        ArduinoOTA.handle();
    }

    if (currentMode == MODE_OTA_PENDING) {
        unsigned long nowBtn = millis();
        if (digitalRead(BRIDGE_BOOT_BUTTON_PIN) == LOW) {
            if (bootBtnLowSinceMs == 0) {
                bootBtnLowSinceMs = nowBtn;
            } else if (nowBtn - bootBtnLowSinceMs >= 50) {
                diagLog.info("[OTA] Physical BOOT button pressed — authorizing ephemeral OTA lease.");
                startOtaMode();
            }
        } else {
            bootBtnLowSinceMs = 0;
        }
        if (currentMode == MODE_OTA_PENDING && nowBtn > otaApprovalExpiryMs) {
            diagLog.warn("[OTA] Physical BOOT button approval timed out.");
            stopOtaMode();
        }
    }

    if (otaServerActive) {
        otaServer.handleClient();
        if (!otaUpdating && millis() > otaLeaseExpiryMs) {
            diagLog.warn("[OTA] 90s OTA lease expired without upload. Halting OTA server.");
            stopOtaMode();
        }
    }
}
