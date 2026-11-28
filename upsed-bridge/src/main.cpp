#include <Arduino.h>
#include <WiFi.h>

#include "bridge_state.h"
#include "ota_manager.h"
#include "rpc_handler.h"
#include "ups_uart.h"
#include "wifi_manager.h"

static String serialLineBuf = "";

static void pollAndRecordQ1(bool isStandalone) {
    UpsTelemetrySnapshot prev = upsTelemetry;
    String q1Raw = executeUpsCommand("Q1", isStandalone);
    if (q1Raw.startsWith("(") && !q1Raw.startsWith("(NAK")) {
        backlogStore.pushRecord(getCurrentTimestampSec(), q1Raw);
        bool inUrgent = urgentFastPollEnabled && (upsTelemetry.isUrgentCondition() || (millis() < postCmdSettleUntilMs));
        if (upsTelemetry.hasDiscreteEdgeChange(prev) || inUrgent) {
            broadcastStateChanged(q1Raw, inUrgent ? "urgent_poll" : "edge_change");
        }
    }
}

void setup() {
    Serial.setRxBufferSize(2048);
    Serial.begin(PC_SERIAL_BAUD);
    pinMode(BRIDGE_BOOT_BUTTON_PIN, INPUT_PULLUP);
    UpsSerial.begin(UPS_BAUD, SERIAL_8N1, UPS_RX_PIN, UPS_TX_PIN);

    ledController.setWifiState(WIFI_LED_BOOT);
    ledController.forceUpdate();

    bridgeClock.begin();
    diagLog.setNotificationSink(broadcastLogNotification);
    backlogStore.begin();
    tuyaController.begin(&diagLog, executeUpsCommand);
    tuyaController.setStateCallback([](TuyaConnState state, const char* reason) {
        (void)reason;
        switch (state) {
            case TUYA_STATE_DISABLED:
                ledController.setTuyaState(TUYA_LED_DISABLED);
                break;
            case TUYA_STATE_WAITING_NTP:
            case TUYA_STATE_CONNECTING:
                ledController.setTuyaState(TUYA_LED_CONNECTING);
                break;
            case TUYA_STATE_CONNECTED:
                ledController.setTuyaState(TUYA_LED_CONNECTED);
                break;
            case TUYA_STATE_RETRY_BACKOFF:
                ledController.setTuyaState(
                    (tuyaController.getRetryCount() >= 2) ? TUYA_LED_ERROR : TUYA_LED_CONNECTING
                );
                break;
            case TUYA_STATE_AUTH_FAILED:
                ledController.setTuyaState(TUYA_LED_ERROR);
                break;
        }
        broadcastBridgeStatusChanged("tuya_state_changed");
    });
    tuyaController.setPublishCallback([]() {
        ledController.triggerTuyaPublishTick();
    });

    diagLog.info("[BOOT] UPSED ESP32-S3 Bridge v%s initialized (MAC: %s)",
                 BRIDGE_FIRMWARE_VER, WiFi.macAddress().c_str());
    diagLog.info("[PSRAM] %s (Free: %u bytes, Capacity: %u records)",
                 backlogStore.isUsingPsram() ? "8MB OPI PSRAM Active" : "Internal SRAM Fallback",
                 ESP.getFreePsram(), backlogStore.capacity());

    WiFi.onEvent(onWiFiEvent);
    wsServer.onEvent(onWebSocketEvent);

    prefs.begin("upsed-wifi", true);
    savedSsid = prefs.getString("ssid", "");
    savedPass = prefs.getString("pass", "");
    prefs.end();

    prefs.begin("upsed-conf", true);
    urgentFastPollEnabled = prefs.getBool("urg_fast", true);
    hostPollSec = prefs.getUInt("host_poll", 10);
    bool nightEn = prefs.getBool("night_en", false);
    uint8_t nightType = prefs.getUChar("night_type", 0);
    uint8_t nightDim = prefs.getUChar("night_dim", 10);
    bool nightWake = prefs.getBool("night_wake", true);
    uint16_t nightStart = prefs.getUShort("night_start", 1320);
    uint16_t nightEnd = prefs.getUShort("night_end", 420);
    bool stealthEn = prefs.getBool("stealth_en", false);
    uint8_t stealthType = prefs.getUChar("stealth_type", 0);
    uint8_t stealthDim = prefs.getUChar("stealth_dim", 10);
    prefs.end();

    ledController.setNightModeConfig(nightEn, nightType, nightDim, nightWake, nightStart, nightEnd);
    ledController.setProxyStealthConfig(stealthEn, stealthType, stealthDim);

    if (savedSsid.length() > 0) {
        connectToWifi(savedSsid, savedPass, 8000);
    } else {
        ledController.setWifiState(WIFI_LED_DISCONNECTED);
    }

    lastDesktopContactMs = millis();
    lastStandalonePollMs = millis();
    lastMasterPollMs = millis();
    lastWifiRetryMs = millis();
}

void loop() {
    // 1. Process incoming USB Serial lines (JSON-RPC 2.0 over UART0)
    while (Serial.available()) {
        char c = static_cast<char>(Serial.read());
        if (c == '\n' || c == '\r') {
            serialLineBuf.trim();
            if (serialLineBuf.length() > 0) {
                if (serialLineBuf.startsWith("{")) {
                    usbLastSeenMs = millis();
                    usbReqCount++;
                    String response;
                    handleJsonRpcRequest(serialLineBuf, response, -1);
                    Serial.println(response);
                }
                serialLineBuf = "";
            }
        } else if (serialLineBuf.length() < 2048) {
            serialLineBuf += c;
        } else {
            serialLineBuf = "";
        }
    }

    // 2. Process Deferred Wi-Fi Transition
    if (pendingWifiSwitch && (millis() >= pendingWifiSwitchMs)) {
        pendingWifiSwitch = false;
        diagLog.info("[WIFI] Commencing deferred network switch to '%s'...", targetSsid.c_str());
        connectToWifiWithRollback(targetSsid, targetPass, rollbackSsid, rollbackPass, 12000);
    }

    // 3. Maintain Wi-Fi & WebSocket Server
    if (WiFi.status() == WL_CONNECTED) {
        ensureNetworkServicesStarted();
        if (wsServerStarted) {
            wsServer.loop();
        }
    } else if (!pendingWifiSwitch && savedSsid.length() > 0 && (millis() - lastWifiRetryMs >= WIFI_RETRY_INTERVAL_MS)) {
        lastWifiRetryMs = millis();
        diagLog.info("[WIFI] Periodic reconnect attempt to '%s'...", savedSsid.c_str());
        WiFi.reconnect();
    }

    // 4. Maintain OTA Services (ArduinoOTA, Physical Approval & Leased HTTP Server)
    handleOtaLoop();

    // 5. Autonomous Master Hardware Polling (Proxy & Standalone Modes)
    unsigned long nowMs = millis();
    if (currentMode != MODE_OTA && currentMode != MODE_OTA_PENDING) {
        bool inUrgent = urgentFastPollEnabled && (upsTelemetry.isUrgentCondition() || (millis() < postCmdSettleUntilMs));
        if (nowMs - lastDesktopContactMs > PROXY_TIMEOUT_MS) {
            if (currentMode != MODE_STANDALONE) {
                currentMode = MODE_STANDALONE;
                ledController.setMode(MODE_LED_STANDALONE);
                diagLog.warn("[MODE] Switched to STANDALONE mode (15s desktop silence). Standalone logging active.");
            }
            unsigned long standaloneInterval = inUrgent ? BRIDGE_TURBO_POLL_MS : STANDALONE_POLL_MS;
            if (nowMs - lastStandalonePollMs >= standaloneInterval) {
                lastStandalonePollMs = nowMs;
                pollAndRecordQ1(true);
            }
        } else {
            cmdCache.setTelemetryTtlMs(inUrgent ? UPS_CACHE_TURBO_TTL_MS : UPS_CACHE_TELEMETRY_TTL_MS);
            unsigned long proxyInterval = inUrgent ? BRIDGE_TURBO_POLL_MS : (hostPollSec <= 2 ? 2000UL : BRIDGE_IDLE_POLL_MS);
            if (nowMs - lastMasterPollMs >= proxyInterval) {
                lastMasterPollMs = nowMs;
                pollAndRecordQ1(false);
            }
        }
    }

    // 6. Maintain TuyaLink MQTT Controller & Telemetry Stream
    tuyaController.updateContextState(upsTelemetry, currentMode == MODE_PROXY);
    tuyaController.loop(upsTelemetry, currentMode == MODE_PROXY, otaServerActive || currentMode == MODE_OTA || currentMode == MODE_OTA_PENDING);

    // 7. Non-blocking Status LED Update
    ledController.update();
}
