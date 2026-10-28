#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WebSocketsServer.h>
#include <WebServer.h>
#include <Update.h>
#define private public
#include <ArduinoOTA.h>
#undef private
#include <ArduinoJson.h>
#include <time.h>

#include "config.h"
#include "rtc_clock.h"
#include "cmd_cache.h"
#include "backlog_store.h"
#include "diag_log.h"
#include "LedController.h"
#include "q1_parser.h"
#include "tuya_mqtt.h"

// ============================================================================
// Global Instances & State
// ============================================================================

HardwareSerial UpsSerial(1);
WebSocketsServer wsServer(BRIDGE_WS_PORT);
WebServer otaServer(BRIDGE_OTA_PORT);
Preferences prefs;
BacklogStore backlogStore;
DiagLogger diagLog;
BridgeClock bridgeClock;
UpsCommandCache cmdCache;
static LedController ledController;
static UpsTelemetrySnapshot upsTelemetry;
static TuyaMqttController tuyaController;

// Connected Client Tracking
struct WsClientSession {
    bool active = false;
    uint8_t clientNum = 0;
    String ip = "";
    uint32_t connectedMs = 0;
    uint32_t lastSeenMs = 0;
    uint64_t reqCount = 0;
};

static WsClientSession wsClients[BRIDGE_MAX_WS_CLIENTS];
static uint32_t usbLastSeenMs = 0;
static uint64_t usbReqCount = 0;

enum BridgeOperatingMode {
    MODE_PROXY = 0,
    MODE_STANDALONE = 1,
    MODE_OTA = 2
};

static BridgeOperatingMode currentMode = MODE_PROXY;
static unsigned long lastDesktopContactMs = 0;
static unsigned long lastStandalonePollMs = 0;
static unsigned long lastWifiRetryMs = 0;
static bool wsServerStarted = false;
static bool mdnsStarted = false;
static bool arduinoOtaStarted = false;
static bool ntpStarted = false;
static bool otaServerActive = false;
static bool otaUpdating = false;
static unsigned long otaLeaseExpiryMs = 0;
static String savedSsid = "";
static String savedPass = "";
static bool pendingWifiSwitch = false;
static unsigned long pendingWifiSwitchMs = 0;
static String targetSsid = "";
static String targetPass = "";
static String rollbackSsid = "";
static String rollbackPass = "";
static String serialLineBuf = "";
static String lastWifiError = "None";

// Autonomous Master Polling & Urgent Event State
static bool urgentFastPollEnabled = true;
static uint32_t hostPollSec = 10;
static unsigned long postCmdSettleUntilMs = 0;
static unsigned long lastMasterPollMs = 0;
static UpsTelemetrySnapshot prevUpsTelemetry;
static bool inPostCmdSync = false;

// Forward Declarations
void populateStatusObject(JsonObject& res);
void broadcastStateChanged(const String& rawQ1, const char* reason);
void broadcastBridgeStatusChanged(const char* reason = "status_updated");

// Real-time broadcast sink for DiagLogger
void broadcastLogNotification(const String& jsonNotif) {
    Serial.println(jsonNotif);
    if (wsServerStarted) {
        String copy = jsonNotif;
        wsServer.broadcastTXT(copy);
    }
}

// Real-time broadcast sink for Stage T2/T3/T4 commands executed by any client
void broadcastCommandExecuted(const String& cmd, const String& rawResp, const String& source) {
    JsonDocument notifDoc;
    notifDoc["jsonrpc"] = "2.0";
    notifDoc["method"] = "bridge.cmdExecuted";
    JsonObject params = notifDoc["params"].to<JsonObject>();
    params["cmd"] = cmd;
    params["raw"] = rawResp;
    params["source"] = source;

    uint32_t ts = bridgeClock.nowEpochSec();
    if (ts > 1700000000) {
        params["ts"] = ts;
        String iso = bridgeClock.formatIso8601(ts);
        if (iso.length() > 0) {
            params["iso_ts"] = iso;
        }
    }

    String serialized;
    serializeJson(notifDoc, serialized);
    Serial.println(serialized);
    if (wsServerStarted) {
        wsServer.broadcastTXT(serialized);
    }
}

// Real-time broadcast sink for telemetry state edge transitions or urgent events
void broadcastStateChanged(const String& rawQ1, const char* reason) {
    JsonDocument notifDoc;
    notifDoc["jsonrpc"] = "2.0";
    notifDoc["method"] = "bridge.stateChanged";
    JsonObject params = notifDoc["params"].to<JsonObject>();
    params["raw"] = rawQ1;
    params["reason"] = reason;
    params["is_urgent"] = upsTelemetry.isUrgentCondition();

    uint32_t ts = bridgeClock.nowEpochSec();
    if (ts > 1700000000) {
        params["ts"] = ts;
        String iso = bridgeClock.formatIso8601(ts);
        if (iso.length() > 0) {
            params["iso_ts"] = iso;
        }
    }

    String serialized;
    serializeJson(notifDoc, serialized);
    Serial.println(serialized);
    if (wsServerStarted) {
        wsServer.broadcastTXT(serialized);
    }
}

// Real-time broadcast sink for bridge connectivity / configuration changes
void broadcastBridgeStatusChanged(const char* reason) {
    JsonDocument notifDoc;
    notifDoc["jsonrpc"] = "2.0";
    notifDoc["method"] = "bridge.statusChanged";
    JsonObject params = notifDoc["params"].to<JsonObject>();
    params["reason"] = reason;
    JsonObject statusObj = params["status"].to<JsonObject>();
    populateStatusObject(statusObj);

    uint32_t ts = bridgeClock.nowEpochSec();
    if (ts > 1700000000) {
        params["ts"] = ts;
    }

    String serialized;
    serializeJson(notifDoc, serialized);
    Serial.println(serialized);
    if (wsServerStarted) {
        wsServer.broadcastTXT(serialized);
    }
}

// ============================================================================
// Helper: Current Timestamp (Unix Epoch if synced, else Uptime Seconds)
// ============================================================================
uint32_t getCurrentTimestampSec() {
    uint32_t nowSec = bridgeClock.nowEpochSec();
    if (nowSec > 1700000000) {
        return nowSec;
    }
    return static_cast<uint32_t>(millis() / 1000UL);
}

// ============================================================================
// Helper: Execute Command on UPS RS-232 UART1 (GPIO 17 RX / GPIO 18 TX)
// ============================================================================
static unsigned long lastUpsCmdEndMs = 0;

String executeUpsCommand(const String& rawCmd, bool isStandalonePoll = false) {
    // Inter-command guard delay on 2400-baud bus to avoid collision
    unsigned long now = millis();
    unsigned long elapsed = now - lastUpsCmdEndMs;
    if (elapsed < UPS_GUARD_DELAY_MS) {
        delay(UPS_GUARD_DELAY_MS - elapsed);
    }

    // Clean any stale bytes in UART1 receive buffer
    while (UpsSerial.available()) {
        UpsSerial.read();
    }

    String cleanCmd = rawCmd;
    cleanCmd.trim();
    if (cleanCmd.length() == 0) {
        lastUpsCmdEndMs = millis();
        return "";
    }

    // Flash momentary activity tick
    ledController.triggerActivityTick();

    UpsSerial.print(cleanCmd);
    UpsSerial.print('\r');
    UpsSerial.flush();

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

    // 150ms retry logic for Megatec/P01 Q1 query (up to 2 retries, 3 attempts total)
    if ((response.length() == 0 || response.startsWith("(NAK")) && cleanCmd == "Q1") {
        for (int retry = 1; retry <= 2; retry++) {
            delay(150);
            while (UpsSerial.available()) {
                UpsSerial.read();
            }
            UpsSerial.print("Q1\r");
            UpsSerial.flush();

            response = "";
            startWait = millis();
            while (millis() - startWait < UPS_READ_TIMEOUT_MS) {
                if (UpsSerial.available()) {
                    char c = static_cast<char>(UpsSerial.read());
                    if (c == '\r') break;
                    if (c != '\n') response += c;
                } else {
                    delay(1);
                }
            }
            response.trim();
            if (response.startsWith("(") && !response.startsWith("(NAK")) {
                // Recovered cleanly on retry; avoid filling ring buffer with benign recovery entries
                break;
            }
        }
        if (response.length() == 0 || response.startsWith("(NAK")) {
            diagLog.warn("[UPS] Q1 failed after 3 attempts (resp: '%s')", response.c_str());
        }
    }

    lastUpsCmdEndMs = millis();

    // Update command cache based on query type and outcome
    if (response.length() == 0 || response.startsWith("(NAK")) {
        ledController.setUpsState(UPS_LED_ERROR);
        if (cleanCmd == "Q1") {
            // Live poll failed: clear negative cache so subsequent identity queries aren't falsely rejected
            cmdCache.clearNegative();
        } else if (upsTelemetry.valid && UpsCommandCache::isStaticIdentityQuery(cleanCmd)) {
            // UPS is confirmed online via Q1, but ignores unsupported identity command (e.g. Megatec P00):
            // Cache negative result for 60s to prevent 1.4s UART timeouts on subsequent client connections
            cmdCache.put(cleanCmd, response, true);
        }
    } else if (response.startsWith("(")) {
        if (UpsCommandCache::isReadOnlyQuery(cleanCmd)) {
            cmdCache.put(cleanCmd, response, false);
        } else {
            // Stage T2/T3/T4 control or configuration write: invalidate dynamic telemetry cache
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

        // Post-command settling and immediate Q1 query for state-modifying actions
        if (!UpsCommandCache::isReadOnlyQuery(cleanCmd) && !inPostCmdSync) {
            inPostCmdSync = true;
            postCmdSettleUntilMs = millis() + 15000UL;
            String q1Resp = executeUpsCommand("Q1", false);
            inPostCmdSync = false;
            if (q1Resp.startsWith("(") && !q1Resp.startsWith("(NAK")) {
                broadcastStateChanged(q1Resp, "post_command");
            }
        }

        // Check if this is a Q1 status response with Utility Fail bit
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

// ============================================================================
// Helper: Start Network Services (mDNS + WebSocket Server + NTP)
// ============================================================================
void ensureNetworkServicesStarted() {
    if (WiFi.status() == WL_CONNECTED) {
        if (!mdnsStarted) {
            if (MDNS.begin(BRIDGE_MDNS_HOSTNAME)) {
                MDNS.addService("ws", "tcp", BRIDGE_WS_PORT);
                mdnsStarted = true;
                diagLog.info("[MDNS] Started responder: ws://%s.local:%d", BRIDGE_MDNS_HOSTNAME, BRIDGE_WS_PORT);
            }
        }
        if (!wsServerStarted) {
            wsServer.begin();
            wsServerStarted = true;
            diagLog.info("[WS] WebSocket server listening on port %d", BRIDGE_WS_PORT);
        }
        if (!arduinoOtaStarted) {
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
                currentMode = MODE_OTA;
                ledController.setMode(MODE_LED_OTA_FLASHING);
                ledController.update();
            });
            ArduinoOTA.onEnd([]() {
                diagLog.info("[OTA] ArduinoOTA flashing completed! Rebooting...");
                setBridgeLed(0, 90, 0); // Solid green final flash before reboot
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
        if (!ntpStarted) {
            configTime(bridgeClock.tzOffsetMin() * 60, 0, "pool.ntp.org", "time.nist.gov", "time.google.com");
            ntpStarted = true;
            diagLog.info("[NTP] SNTP client initialized (offset: %d min, pool.ntp.org, time.nist.gov, time.google.com)",
                         bridgeClock.tzOffsetMin());
        }
    }
}

// ============================================================================
// On-Demand Leased OTA HTTP Server Implementation (Port 8080)
// ============================================================================
void stopOtaMode() {
    if (otaServerActive) {
        otaServer.stop();
        otaServerActive = false;
        otaUpdating = false;
        diagLog.info("[OTA] Leased OTA HTTP server stopped. Resuming normal proxy monitoring.");
    }
    if (currentMode == MODE_OTA) {
        currentMode = MODE_PROXY;
        lastDesktopContactMs = millis();
        ledController.setMode(MODE_LED_PROXY);
        ledController.forceUpdate();
    }
}

void setupOtaHttpEndpoints() {
    otaServer.on("/update", HTTP_POST, []() {
        if (!otaServer.hasHeader("X-UPSED-OTA-TOKEN") || otaServer.header("X-UPSED-OTA-TOKEN") != BRIDGE_OTA_SECRET) {
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
            setBridgeLed(0, 90, 0); // Solid green final flash before reboot
            delay(250);
            ESP.restart();
        } else {
            diagLog.error("[OTA] Firmware update failed: %s", Update.errorString());
            stopOtaMode();
        }
    }, []() {
        HTTPUpload& upload = otaServer.upload();
        if (upload.status == UPLOAD_FILE_START) {
            if (!otaServer.hasHeader("X-UPSED-OTA-TOKEN") || otaServer.header("X-UPSED-OTA-TOKEN") != BRIDGE_OTA_SECRET) {
                diagLog.warn("[OTA] Unauthorized upload attempt rejected (invalid header token).");
                return;
            }

            otaUpdating = true;
            otaLeaseExpiryMs = millis() + 120000UL; // Extend lease during upload
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
                setBridgeLed(0, 90, 0); // Solid green confirmation
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
    currentMode = MODE_OTA;
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

// ============================================================================
// Helper: Connect to Wi-Fi (Non-destructive, keeps radio powered)
// ============================================================================
bool connectToWifi(const String& ssid, const String& pass, uint32_t timeoutMs) {
    if (ssid.length() == 0) {
        ledController.setWifiState(WIFI_LED_DISCONNECTED);
        return false;
    }

    ledController.setWifiState(WIFI_LED_CONNECTING);
    diagLog.info("[WIFI] Associating with 2.4GHz network '%s'...", ssid.c_str());
    WiFi.mode(WIFI_STA);
    WiFi.setTxPower(WIFI_POWER_15dBm); // 15dBm limits peak transmission current spikes to eliminate brownouts
    WiFi.setHostname(BRIDGE_MDNS_HOSTNAME);
    WiFi.disconnect(false, true);
    WiFi.begin(ssid.c_str(), pass.c_str());

    unsigned long startMs = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - startMs) < timeoutMs) {
        delay(50);
        ledController.update();
    }

    if (WiFi.status() == WL_CONNECTED) {
        lastWifiError = "None";
        ledController.setWifiState(WIFI_LED_CONNECTED);
        ensureNetworkServicesStarted();
        return true;
    }
    ledController.setWifiState(WIFI_LED_DISCONNECTED);
    return false;
}

// ============================================================================
// Helper: Connect to Wi-Fi with Automatic Rollback on Failure
// ============================================================================
bool connectToWifiWithRollback(const String& newSsid, const String& newPass,
                               const String& prevSsid, const String& prevPass,
                               uint32_t timeoutMs = 12000) {
    if (newSsid.length() == 0) {
        return false;
    }

    ledController.setWifiState(WIFI_LED_CONNECTING);
    diagLog.info("[WIFI] Associating with 2.4GHz network '%s' (timeout %u ms)...", newSsid.c_str(), timeoutMs);

    WiFi.disconnect(false, true);
    delay(50);
    WiFi.mode(WIFI_STA);
    WiFi.setTxPower(WIFI_POWER_15dBm);
    WiFi.setHostname(BRIDGE_MDNS_HOSTNAME);
    WiFi.begin(newSsid.c_str(), newPass.c_str());

    unsigned long startMs = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - startMs) < timeoutMs) {
        delay(50);
        ledController.update();
    }

    if (WiFi.status() == WL_CONNECTED) {
        lastWifiError = "None";
        ledController.setWifiState(WIFI_LED_CONNECTED);
        diagLog.info("[WIFI] Successfully associated with '%s'! IP: %s",
                     newSsid.c_str(), WiFi.localIP().toString().c_str());
        // Cleanly re-announce mDNS responder on the newly acquired IP address
        if (mdnsStarted) {
            MDNS.end();
            mdnsStarted = false;
        }
        ensureNetworkServicesStarted();
        return true;
    }

    // Association failed! Rollback if we have previous working credentials
    diagLog.warn("[WIFI] Connection to '%s' failed (error: %s). Initiating automatic rollback...",
                 newSsid.c_str(), lastWifiError.c_str());
    ledController.setWifiState(WIFI_LED_AUTH_FAIL);

    if (prevSsid.length() > 0 && prevSsid != newSsid) {
        diagLog.info("[WIFI] Restoring previous network credentials for '%s' in NVS Flash...", prevSsid.c_str());
        prefs.begin("upsed-wifi", false);
        prefs.putString("ssid", prevSsid);
        prefs.putString("pass", prevPass);
        prefs.end();
        savedSsid = prevSsid;
        savedPass = prevPass;

        WiFi.disconnect(false, true);
        delay(50);
        WiFi.begin(prevSsid.c_str(), prevPass.c_str());

        startMs = millis();
        while (WiFi.status() != WL_CONNECTED && (millis() - startMs) < 10000) {
            delay(50);
            ledController.update();
        }

        if (WiFi.status() == WL_CONNECTED) {
            ledController.setWifiState(WIFI_LED_CONNECTED);
            diagLog.info("[WIFI] Rollback successful! Reconnected to '%s' (IP: %s)",
                         prevSsid.c_str(), WiFi.localIP().toString().c_str());
            if (mdnsStarted) {
                MDNS.end();
                mdnsStarted = false;
            }
            ensureNetworkServicesStarted();
            return false;
        } else {
            ledController.setWifiState(WIFI_LED_DISCONNECTED);
            diagLog.error("[WIFI] Rollback connection to '%s' also failed! (error: %s)",
                          prevSsid.c_str(), lastWifiError.c_str());
        }
    } else {
        diagLog.warn("[WIFI] No previous rollback credentials available.");
    }

    return false;
}

// ============================================================================
// Helper: Populate Bridge Status Object
// ============================================================================
void populateStatusObject(JsonObject& res) {
    res["bridge"] = BRIDGE_MAGIC_ID;
    res["fw"] = BRIDGE_FIRMWARE_VER;
    res["mac"] = WiFi.macAddress();
    res["mode"] = (currentMode == MODE_OTA) ? "ota" : (currentMode == MODE_PROXY) ? "proxy" : "standalone";
    bool wifiConn = (WiFi.status() == WL_CONNECTED);
    res["wifi_connected"] = wifiConn;
    res["ssid"] = wifiConn ? WiFi.SSID() : savedSsid;
    res["ip"] = wifiConn ? WiFi.localIP().toString() : "";
    res["hostname"] = String(BRIDGE_MDNS_HOSTNAME) + ".local";
    res["ws_port"] = BRIDGE_WS_PORT;
    res["ota_port"] = BRIDGE_OTA_PORT;
    res["ota_active"] = otaServerActive;
    res["rssi"] = wifiConn ? WiFi.RSSI() : 0;
    res["wifi_last_error"] = lastWifiError;
    res["log_seq"] = diagLog.latestSeq();
    res["backlog_records"] = backlogStore.count();
    res["backlog_capacity"] = backlogStore.capacity();
    res["psram_active"] = backlogStore.isUsingPsram();
    res["psram_free"] = ESP.getFreePsram();
    res["uptime_sec"] = millis() / 1000UL;
    res["tuya_enabled"] = tuyaController.isEnabled();
    res["tuya_connected"] = tuyaController.isConnected();
    res["tuya_state"] = tuyaController.getConnStateStr();
    res["tuya_retry_count"] = tuyaController.getRetryCount();
    res["tuya_next_retry_sec"] = tuyaController.getNextRetrySec();
    res["tuya_region"] = tuyaController.getRegion();
    res["tuya_last_error"] = tuyaController.getLastError();

    // Dual-source RTC clock telemetry
    uint32_t rtcNow = bridgeClock.nowEpochSec();
    res["rtc_ts"] = rtcNow;
    res["rtc_iso"] = bridgeClock.formatIso8601(rtcNow);
    res["time_synced"] = bridgeClock.isSynced();
    res["time_source"] = bridgeClock.timeSource();
    res["tz_offset_min"] = bridgeClock.tzOffsetMin();

    // Multi-client telemetry
    size_t activeWsCount = 0;
    for (size_t i = 0; i < BRIDGE_MAX_WS_CLIENTS; i++) {
        if (wsClients[i].active) activeWsCount++;
    }
    res["ws_clients"] = activeWsCount;
    bool usbActive = (usbLastSeenMs > 0 && (millis() - usbLastSeenMs <= PROXY_TIMEOUT_MS));
    res["usb_client_active"] = usbActive;

    JsonArray clientsArr = res["connected_clients"].to<JsonArray>();
    if (usbActive) {
        JsonObject usbObj = clientsArr.add<JsonObject>();
        usbObj["id"] = "usb:0";
        usbObj["medium"] = "usb";
        usbObj["ip"] = "USB-CDC";
        usbObj["connected_sec"] = (millis() - usbLastSeenMs) / 1000UL;
        usbObj["req_count"] = usbReqCount;
    }
    for (size_t i = 0; i < BRIDGE_MAX_WS_CLIENTS; i++) {
        if (wsClients[i].active) {
            JsonObject wsObj = clientsArr.add<JsonObject>();
            wsObj["id"] = "ws:" + String(wsClients[i].clientNum);
            wsObj["medium"] = "websocket";
            wsObj["ip"] = wsClients[i].ip;
            wsObj["connected_sec"] = (millis() - wsClients[i].connectedMs) / 1000UL;
            wsObj["req_count"] = wsClients[i].reqCount;
        }
    }

    // Cache telemetry
    res["cache_hits"] = cmdCache.hits();
    res["cache_misses"] = cmdCache.misses();
    res["cache_entries"] = cmdCache.validEntries();
    res["cache_capacity"] = cmdCache.capacity();
    res["cache_ttl_ms"] = cmdCache.telemetryTtlMs();
    res["urgent_fast_poll"] = urgentFastPollEnabled;
    res["host_poll_sec"] = hostPollSec;
    res["is_urgent"] = upsTelemetry.isUrgentCondition();
}

// ============================================================================
// JSON-RPC 2.0 Request Router (Shared by USB Serial & Wi-Fi WebSocket)
// ============================================================================
void handleJsonRpcRequest(const String& jsonLine, String& jsonResponseOut, int clientNum = -1) {
    JsonDocument reqDoc;
    DeserializationError err = deserializeJson(reqDoc, jsonLine);

    JsonDocument resDoc;
    resDoc["jsonrpc"] = "2.0";

    if (err) {
        resDoc["id"] = nullptr;
        JsonObject errObj = resDoc["error"].to<JsonObject>();
        errObj["code"] = -32700;
        errObj["message"] = "Parse error";
        serializeJson(resDoc, jsonResponseOut);
        return;
    }

    if (reqDoc["id"].isNull()) {
        resDoc["id"] = nullptr;
    } else {
        resDoc["id"] = reqDoc["id"];
    }

    // 1. Piggybacked Host Real-Time Clock Synchronization
    if (!reqDoc["params"].isNull() && reqDoc["params"]["host_ts"].is<uint32_t>()) {
        uint32_t hostTs = reqDoc["params"]["host_ts"].as<uint32_t>();
        int32_t tzMin = reqDoc["params"]["tz_offset_min"] | 0;
        bridgeClock.syncFromHost(hostTs, tzMin);
    }

    // 2. Piggybacked Adaptive Urgent Fast-Polling & Host Cadence Configuration
    if (!reqDoc["params"].isNull()) {
        if (reqDoc["params"]["urgent_fast_poll"].is<bool>()) {
            bool en = reqDoc["params"]["urgent_fast_poll"].as<bool>();
            if (en != urgentFastPollEnabled) {
                urgentFastPollEnabled = en;
                prefs.begin("upsed-conf", false);
                prefs.putBool("urg_fast", en);
                prefs.end();
            }
        }
        if (reqDoc["params"]["host_poll_sec"].is<uint32_t>()) {
            uint32_t hps = reqDoc["params"]["host_poll_sec"].as<uint32_t>();
            if (hps != hostPollSec && hps >= 1) {
                hostPollSec = hps;
                prefs.begin("upsed-conf", false);
                prefs.putUInt("host_poll", hostPollSec);
                prefs.end();
            }
        }
    }

    // 2. Unicast Unacknowledged Log Notifications (Send only to requesting client)
    if (!reqDoc["params"].isNull() && reqDoc["params"]["ack_seq"].is<uint32_t>()) {
        uint32_t ackSeq = reqDoc["params"]["ack_seq"].as<uint32_t>();
        if (clientNum >= 0 && wsServerStarted) {
            uint8_t cNum = static_cast<uint8_t>(clientNum);
            diagLog.flushUnacked(ackSeq, [cNum](const String& notif) {
                wsServer.sendTXT(cNum, notif.c_str());
            });
        } else {
            diagLog.flushUnacked(ackSeq, [](const String& notif) {
                Serial.println(notif);
            });
        }
    }

    const char* method = reqDoc["method"] | "";

    // Activity heartbeat -> transition to Proxy Mode
    if (currentMode != MODE_PROXY) {
        diagLog.info("[MODE] Switched to PROXY mode (desktop contact)");
    }
    lastDesktopContactMs = millis();
    currentMode = MODE_PROXY;
    ledController.setMode(MODE_LED_PROXY);

    if (strcmp(method, "bridge.ping") == 0 || strcmp(method, "bridge.getStatus") == 0) {
        JsonObject result = resDoc["result"].to<JsonObject>();
        populateStatusObject(result);
    }
    else if (strcmp(method, "ups.cmd") == 0) {
        const char* cmd = reqDoc["params"]["cmd"] | "";
        if (strlen(cmd) == 0) {
            JsonObject errObj = resDoc["error"].to<JsonObject>();
            errObj["code"] = -32602;
            errObj["message"] = "Missing 'cmd' parameter";
        } else {
            bool forceRefresh = reqDoc["params"]["force_refresh"] | false;
            String cachedRaw;
            unsigned long cachedAgeMs = 0;
            bool isNegative = false;
            uint32_t cachedRtcTs = 0;

            if (!forceRefresh && cmdCache.get(String(cmd), cachedRaw, cachedAgeMs, isNegative, cachedRtcTs)) {
                if (isNegative || cachedRaw.length() == 0) {
                    JsonObject errObj = resDoc["error"].to<JsonObject>();
                    errObj["code"] = -32000;
                    errObj["message"] = "UPS serial read timeout (cached)";
                } else {
                    JsonObject result = resDoc["result"].to<JsonObject>();
                    result["raw"] = cachedRaw;
                    result["cached"] = true;
                    result["cache_age_ms"] = cachedAgeMs;
                    result["rtc_ts"] = cachedRtcTs;
                    result["backlog_records"] = backlogStore.count();
                    result["log_seq"] = diagLog.latestSeq();
                    result["ip"] = (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString() : "";
                }
            } else {
                String upsReply = executeUpsCommand(String(cmd), false);
                if (String(cmd) == "Q1") {
                    lastMasterPollMs = millis();
                }
                if (upsReply.length() == 0) {
                    JsonObject errObj = resDoc["error"].to<JsonObject>();
                    errObj["code"] = -32000;
                    errObj["message"] = "UPS serial read timeout";
                } else {
                    // Broadcast command execution notification to all other connected clients if state-modifying
                    if (!UpsCommandCache::isReadOnlyQuery(String(cmd))) {
                        String source = (clientNum >= 0 && clientNum < BRIDGE_MAX_WS_CLIENTS)
                            ? ("ws:" + wsClients[clientNum].ip)
                            : "usb";
                        broadcastCommandExecuted(String(cmd), upsReply, source);
                    }

                    JsonObject result = resDoc["result"].to<JsonObject>();
                    result["raw"] = upsReply;
                    result["cached"] = false;
                    result["cache_age_ms"] = 0;
                    result["rtc_ts"] = bridgeClock.nowEpochSec();
                    result["backlog_records"] = backlogStore.count();
                    result["log_seq"] = diagLog.latestSeq();
                    result["ip"] = (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString() : "";
                }
            }
        }
    }
    else if (strcmp(method, "bridge.syncTime") == 0) {
        uint32_t hostTs = reqDoc["params"]["host_ts"] | 0;
        int32_t tzMin = reqDoc["params"]["tz_offset_min"] | 0;
        bool ok = bridgeClock.syncFromHost(hostTs, tzMin);
        JsonObject result = resDoc["result"].to<JsonObject>();
        populateStatusObject(result);
        result["synced"] = ok;
        broadcastBridgeStatusChanged("time_synced");
    }
    else if (strcmp(method, "bridge.clearCache") == 0) {
        cmdCache.clear();
        JsonObject result = resDoc["result"].to<JsonObject>();
        result["cleared"] = true;
    }
    else if (strcmp(method, "bridge.scanWifi") == 0) {
        diagLog.info("[WIFI] Scanning 2.4GHz Wi-Fi networks...");
        int n = WiFi.scanNetworks(false, false);
        JsonObject result = resDoc["result"].to<JsonObject>();
        JsonArray netArr = result["networks"].to<JsonArray>();

        for (int i = 0; i < n && i < 20; i++) {
            String currSsid = WiFi.SSID(i);
            if (currSsid.length() == 0) continue;

            // Simple dedup: check if already in array
            bool exists = false;
            for (JsonObject item : netArr) {
                if (item["ssid"].as<String>() == currSsid) {
                    exists = true;
                    break;
                }
            }
            if (!exists) {
                JsonObject obj = netArr.add<JsonObject>();
                obj["ssid"] = currSsid;
                obj["rssi"] = WiFi.RSSI(i);
                obj["open"] = (WiFi.encryptionType(i) == WIFI_AUTH_OPEN);
                obj["channel"] = WiFi.channel(i);
            }
        }
        WiFi.scanDelete();
        diagLog.info("[WIFI] Scan complete: found %d networks", n);
    }
    else if (strcmp(method, "bridge.setWifi") == 0) {
        const char* ssid = reqDoc["params"]["ssid"] | "";
        const char* pass = reqDoc["params"]["pass"] | "";

        if (strlen(ssid) == 0) {
            JsonObject errObj = resDoc["error"].to<JsonObject>();
            errObj["code"] = -32602;
            errObj["message"] = "SSID cannot be empty";
        } else {
            // Stage target credentials and preserve current working credentials as rollback buffer
            rollbackSsid = savedSsid;
            rollbackPass = savedPass;
            targetSsid = String(ssid);
            targetPass = String(pass);

            // Persist target credentials to NVS Flash
            prefs.begin("upsed-wifi", false);
            prefs.putString("ssid", targetSsid);
            prefs.putString("pass", targetPass);
            prefs.end();
            savedSsid = targetSsid;
            savedPass = targetPass;

            diagLog.info("[WIFI] Staged new credentials for '%s' to NVS Flash", targetSsid.c_str());

            // Prepare immediate JSON-RPC ACK so WebSocket client receives confirmation before Wi-Fi resets
            JsonObject result = resDoc["result"].to<JsonObject>();
            populateStatusObject(result);
            result["saved"] = true;
            result["reconnecting"] = true;
            result["target_ssid"] = targetSsid;
            result["rollback_ssid"] = rollbackSsid;
            result["current_ip"] = (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString() : "";

            // Arm deferred switch: wait 250ms in loop() before disconnecting Wi-Fi
            // to allow TCP buffers to flush the JSON-RPC response over WebSocket or USB
            pendingWifiSwitch = true;
            pendingWifiSwitchMs = millis() + 250;
        }
    }
    else if (strcmp(method, "bridge.getBacklog") == 0) {
        size_t offset = reqDoc["params"]["offset"] | 0;
        size_t limit = reqDoc["params"]["limit"] | 50;
        if (limit > 100) limit = 100;

        JsonObject result = resDoc["result"].to<JsonObject>();
        JsonArray recordsArr = result["records"].to<JsonArray>();
        uint32_t bootSec = bridgeClock.bootEpochSec();
        size_t fetched = backlogStore.peekRecordsToJson(recordsArr, offset, limit, bootSec);
        result["fetched"] = fetched;
        result["offset"] = offset;
        result["total_remaining"] = backlogStore.count();
        result["has_more"] = ((offset + fetched) < backlogStore.count());
    }
    else if (strcmp(method, "bridge.clearBacklog") == 0) {
        size_t countToPop = reqDoc["params"]["count"] | 0;
        backlogStore.popRecords(countToPop);

        JsonObject result = resDoc["result"].to<JsonObject>();
        result["remaining"] = backlogStore.count();
    }
    else if (strcmp(method, "bridge.startOta") == 0) {
        const char* token = reqDoc["params"]["token"] | "";
        if (strcmp(token, BRIDGE_OTA_SECRET) != 0) {
            JsonObject errObj = resDoc["error"].to<JsonObject>();
            errObj["code"] = -32602;
            errObj["message"] = "Invalid OTA authentication token";
            diagLog.warn("[OTA] Rejected bridge.startOta: invalid token");
        } else {
            startOtaMode();
            JsonObject result = resDoc["result"].to<JsonObject>();
            result["ota_ready"] = true;
            result["port"] = BRIDGE_OTA_PORT;
            result["lease_sec"] = BRIDGE_OTA_LEASE_MS / 1000UL;
            result["ip"] = (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString() : "";
        }
    }
    else if (strcmp(method, "bridge.abortOta") == 0) {
        stopOtaMode();
        JsonObject result = resDoc["result"].to<JsonObject>();
        result["aborted"] = true;
    }
    else if (strcmp(method, "bridge.getTuyaConfig") == 0) {
        JsonObject result = resDoc["result"].to<JsonObject>();
        tuyaController.populateConfigJson(result, upsTelemetry, currentMode == MODE_PROXY);
    }
    else if (strcmp(method, "bridge.setTuyaConfig") == 0) {
        bool en = reqDoc["params"]["enabled"] | false;
        const char* reg = reqDoc["params"]["region"] | "eu";
        const char* prodId = reqDoc["params"]["product_id"] | "";
        const char* devId = reqDoc["params"]["device_id"] | "";
        const char* secret = reqDoc["params"]["device_secret"] | "";
        const char* offMd = reqDoc["params"]["off_mode"] | "SOFF";
        int interlock = reqDoc["params"]["interlock_pct"] | 8;

        tuyaController.saveConfig(en, String(reg), String(prodId), String(devId),
                                  String(secret), String(offMd), interlock);
        JsonObject result = resDoc["result"].to<JsonObject>();
        tuyaController.populateConfigJson(result, upsTelemetry, currentMode == MODE_PROXY);
    }
    else if (strcmp(method, "bridge.testTuyaPublish") == 0) {
        if (!upsTelemetry.valid) {
            String q1Raw = executeUpsCommand("Q1", false);
            upsTelemetry.parseQ1Response(q1Raw);
        }
        bool ok = tuyaController.publishTelemetryReport(upsTelemetry, currentMode == MODE_PROXY);
        JsonObject result = resDoc["result"].to<JsonObject>();
        result["published"] = ok;
        tuyaController.populateConfigJson(result, upsTelemetry, currentMode == MODE_PROXY);
    }
    else if (strcmp(method, "bridge.reconnectTuya") == 0) {
        tuyaController.forceReconnect();
        JsonObject result = resDoc["result"].to<JsonObject>();
        result["reconnecting"] = true;
        tuyaController.populateConfigJson(result, upsTelemetry, currentMode == MODE_PROXY);
        broadcastBridgeStatusChanged("tuya_reconnecting");
    }
    else {
        JsonObject errObj = resDoc["error"].to<JsonObject>();
        errObj["code"] = -32601;
        errObj["message"] = "Method not found";
    }

    serializeJson(resDoc, jsonResponseOut);
}

// ============================================================================
// WebSocket Server Event Callback
// ============================================================================
void onWebSocketEvent(uint8_t clientNum, WStype_t type, uint8_t* payload, size_t length) {
    if (type == WStype_CONNECTED) {
        IPAddress ip = wsServer.remoteIP(clientNum);
        diagLog.info("[WS] Client #%u connected from %s", clientNum, ip.toString().c_str());
        if (clientNum < BRIDGE_MAX_WS_CLIENTS) {
            wsClients[clientNum].active = true;
            wsClients[clientNum].clientNum = clientNum;
            wsClients[clientNum].ip = ip.toString();
            wsClients[clientNum].connectedMs = millis();
            wsClients[clientNum].lastSeenMs = millis();
            wsClients[clientNum].reqCount = 0;
        }
        broadcastBridgeStatusChanged("ws_connected");
    } else if (type == WStype_DISCONNECTED) {
        diagLog.info("[WS] Client #%u disconnected", clientNum);
        if (clientNum < BRIDGE_MAX_WS_CLIENTS) {
            wsClients[clientNum].active = false;
        }
        broadcastBridgeStatusChanged("ws_disconnected");
    } else if (type == WStype_TEXT && payload != nullptr && length > 0) {
        if (clientNum < BRIDGE_MAX_WS_CLIENTS) {
            wsClients[clientNum].lastSeenMs = millis();
            wsClients[clientNum].reqCount++;
        }
        String reqStr = String(reinterpret_cast<const char*>(payload), length);
        reqStr.trim();
        if (reqStr.length() > 0) {
            String resStr;
            handleJsonRpcRequest(reqStr, resStr, clientNum);
            wsServer.sendTXT(clientNum, resStr);
        }
    }
}

// ============================================================================
// Wi-Fi Event Handler Callback
// ============================================================================
void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
    switch (event) {
        case ARDUINO_EVENT_WIFI_STA_CONNECTED:
            ledController.setWifiState(WIFI_LED_CONNECTING);
            diagLog.info("[WIFI] Connected to AP '%s' (BSSID %02X:%02X:%02X:%02X:%02X:%02X)",
                         WiFi.SSID().c_str(),
                         info.wifi_sta_connected.bssid[0], info.wifi_sta_connected.bssid[1],
                         info.wifi_sta_connected.bssid[2], info.wifi_sta_connected.bssid[3],
                         info.wifi_sta_connected.bssid[4], info.wifi_sta_connected.bssid[5]);
            break;
        case ARDUINO_EVENT_WIFI_STA_GOT_IP:
            ledController.setWifiState(WIFI_LED_CONNECTED);
            diagLog.info("[WIFI] DHCP IP Assigned: %s (Gateway: %s, RSSI: %d dBm)",
                         WiFi.localIP().toString().c_str(),
                         WiFi.gatewayIP().toString().c_str(),
                         WiFi.RSSI());
            lastWifiError = "None";
            ensureNetworkServicesStarted();
            broadcastBridgeStatusChanged("wifi_got_ip");
            break;
        case ARDUINO_EVENT_WIFI_STA_DISCONNECTED: {
            ntpStarted = false;
            uint8_t reason = info.wifi_sta_disconnected.reason;
            lastWifiError = String(DiagLogger::wifiReasonToString(reason));
            if (reason == WIFI_REASON_AUTH_EXPIRE || reason == WIFI_REASON_AUTH_FAIL ||
                reason == WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT || reason == WIFI_REASON_HANDSHAKE_TIMEOUT) {
                ledController.setWifiState(WIFI_LED_AUTH_FAIL);
            } else {
                ledController.setWifiState(WIFI_LED_DISCONNECTED);
            }
            diagLog.warn("[WIFI] Disconnected from AP: %s (Reason code %d)",
                         lastWifiError.c_str(), reason);
            broadcastBridgeStatusChanged("wifi_disconnected");
            break;
        }
        default:
            break;
    }
}

// ============================================================================
// Setup & Loop
// ============================================================================
void setup() {
    // 1. Configure USB UART RX buffer BEFORE calling begin()
    Serial.setRxBufferSize(2048);
    Serial.begin(PC_SERIAL_BAUD);

    UpsSerial.begin(UPS_BAUD, SERIAL_8N1, UPS_RX_PIN, UPS_TX_PIN);

    // 2. Immediately render initial boot state on RGB LED
    ledController.setWifiState(WIFI_LED_BOOT);
    ledController.forceUpdate();

    bridgeClock.begin();
    diagLog.setNotificationSink(broadcastLogNotification);
    backlogStore.begin();
    tuyaController.begin(&diagLog, executeUpsCommand);
    tuyaController.setStateCallback([](TuyaConnState state, const char* reason) {
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
                if (tuyaController.getRetryCount() >= 2) {
                    ledController.setTuyaState(TUYA_LED_ERROR);
                } else {
                    ledController.setTuyaState(TUYA_LED_CONNECTING);
                }
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
    prefs.end();

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
        } else {
            if (serialLineBuf.length() < 2048) {
                serialLineBuf += c;
            } else {
                serialLineBuf = "";
            }
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

    // 4. Maintain OTA Services (ArduinoOTA & Leased HTTP Server)
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
    if (otaServerActive) {
        otaServer.handleClient();
        if (!otaUpdating && millis() > otaLeaseExpiryMs) {
            diagLog.warn("[OTA] 90s OTA lease expired without upload. Halting OTA server.");
            stopOtaMode();
        }
    }

    // 5. Autonomous Master Hardware Polling (Proxy & Standalone Modes)
    unsigned long nowMs = millis();
    if (currentMode != MODE_OTA) {
        if (nowMs - lastDesktopContactMs > PROXY_TIMEOUT_MS) {
            // Standalone Mode (Desktop offline)
            if (currentMode != MODE_STANDALONE) {
                currentMode = MODE_STANDALONE;
                ledController.setMode(MODE_LED_STANDALONE);
                diagLog.warn("[MODE] Switched to STANDALONE mode (15s desktop silence). Standalone logging active.");
            }

            bool inUrgent = urgentFastPollEnabled && (upsTelemetry.isUrgentCondition() || (millis() < postCmdSettleUntilMs));
            unsigned long standaloneInterval = inUrgent ? BRIDGE_TURBO_POLL_MS : STANDALONE_POLL_MS;

            if (nowMs - lastStandalonePollMs >= standaloneInterval) {
                lastStandalonePollMs = nowMs;
                UpsTelemetrySnapshot prev = upsTelemetry;
                String q1Raw = executeUpsCommand("Q1", true);
                if (q1Raw.startsWith("(") && !q1Raw.startsWith("(NAK")) {
                    backlogStore.pushRecord(getCurrentTimestampSec(), q1Raw);
                    if (upsTelemetry.hasDiscreteEdgeChange(prev) || inUrgent) {
                        broadcastStateChanged(q1Raw, inUrgent ? "urgent_poll" : "edge_change");
                    }
                }
            }
        } else {
            // Proxy Mode (Desktop connected)
            bool inUrgent = urgentFastPollEnabled && (upsTelemetry.isUrgentCondition() || (millis() < postCmdSettleUntilMs));
            cmdCache.setTelemetryTtlMs(inUrgent ? UPS_CACHE_TURBO_TTL_MS : UPS_CACHE_TELEMETRY_TTL_MS);
            unsigned long proxyInterval = inUrgent ? BRIDGE_TURBO_POLL_MS : (hostPollSec <= 2 ? 2000UL : BRIDGE_IDLE_POLL_MS);

            if (nowMs - lastMasterPollMs >= proxyInterval) {
                lastMasterPollMs = nowMs;
                UpsTelemetrySnapshot prev = upsTelemetry;
                String q1Raw = executeUpsCommand("Q1", false);
                if (q1Raw.startsWith("(") && !q1Raw.startsWith("(NAK")) {
                    if (upsTelemetry.hasDiscreteEdgeChange(prev) || inUrgent) {
                        broadcastStateChanged(q1Raw, inUrgent ? "urgent_poll" : "edge_change");
                    }
                }
            }
        }
    }

    // 6. Maintain TuyaLink MQTT Controller & Telemetry Stream
    tuyaController.updateContextState(upsTelemetry, currentMode == MODE_PROXY);
    tuyaController.loop(upsTelemetry, currentMode == MODE_PROXY, otaServerActive || currentMode == MODE_OTA);

    // 7. Non-blocking Status LED Update
    ledController.update();
}
