#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>
#include <time.h>

#include "config.h"
#include "backlog_store.h"
#include "diag_log.h"

// ============================================================================
// Global Instances & State
// ============================================================================

HardwareSerial UpsSerial(1);
WebSocketsServer wsServer(BRIDGE_WS_PORT);
Preferences prefs;
BacklogStore backlogStore;
DiagLogger diagLog;

enum BridgeOperatingMode {
    MODE_PROXY = 0,
    MODE_STANDALONE = 1
};

static BridgeOperatingMode currentMode = MODE_PROXY;
static unsigned long lastDesktopContactMs = 0;
static unsigned long lastStandalonePollMs = 0;
static unsigned long lastWifiRetryMs = 0;
static bool wsServerStarted = false;
static bool mdnsStarted = false;
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

// Real-time broadcast sink for DiagLogger
void broadcastLogNotification(const String& jsonNotif) {
    Serial.println(jsonNotif);
    if (wsServerStarted) {
        String copy = jsonNotif;
        wsServer.broadcastTXT(copy);
    }
}

// ============================================================================
// Helper: Current Timestamp (Unix Epoch if NTP synced, else Uptime Seconds)
// ============================================================================
uint32_t getCurrentTimestampSec() {
    time_t now = time(nullptr);
    if (now > 1700000000) {
        return static_cast<uint32_t>(now);
    }
    return static_cast<uint32_t>(millis() / 1000UL);
}

// ============================================================================
// Helper: Execute Command on UPS RS-232 UART1 (GPIO 17 RX / GPIO 18 TX)
// ============================================================================
static unsigned long lastUpsCmdEndMs = 0;

String executeUpsCommand(const String& rawCmd, bool isStandalonePoll = false) {
    // 120ms inter-command guard delay on 2400-baud bus to avoid collision
    unsigned long now = millis();
    unsigned long elapsed = now - lastUpsCmdEndMs;
    if (elapsed < 120) {
        delay(120 - elapsed);
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

    // Visual indicator: Blue while waiting in Proxy Mode, Cyan in Standalone Mode
    if (isStandalonePoll) {
        setBridgeLed(0, 40, 50);
    } else {
        setBridgeLed(0, 0, 50);
    }

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
                diagLog.debug("[UPS] Q1 recovered on retry attempt %d", retry);
                break;
            }
        }
        if (response.length() == 0 || response.startsWith("(NAK")) {
            diagLog.warn("[UPS] Q1 failed after 3 attempts (resp: '%s')", response.c_str());
        }
    }

    lastUpsCmdEndMs = millis();

    // Update RGB LED based on UPS response
    if (response.length() == 0 || response.startsWith("(NAK")) {
        setBridgeLed(60, 40, 0); // Yellow: Timeout or (NAK
    } else if (response.startsWith("(")) {
        // Check if this is a Q1 status response with Utility Fail bit
        int lastSpace = response.lastIndexOf(' ');
        if (lastSpace > 0 && (response.length() - lastSpace - 1) == 8) {
            char utilityFailBit = response.charAt(lastSpace + 1);
            if (utilityFailBit == '1') {
                setBridgeLed(80, 0, 0); // Red: Utility Fail / On Battery!
                return response;
            }
        }
        if (isStandalonePoll) {
            setBridgeLed(35, 0, 50); // Purple: Standalone Mode healthy
        } else {
            setBridgeLed(0, 50, 0);  // Green: Proxy Mode healthy
        }
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
        configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    }
}

// ============================================================================
// Helper: Connect to Wi-Fi (Non-destructive, keeps radio powered)
// ============================================================================
bool connectToWifi(const String& ssid, const String& pass, uint32_t timeoutMs) {
    if (ssid.length() == 0) {
        return false;
    }

    diagLog.info("[WIFI] Associating with 2.4GHz network '%s'...", ssid.c_str());
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.setHostname(BRIDGE_MDNS_HOSTNAME);
    WiFi.disconnect(false, true);
    WiFi.begin(ssid.c_str(), pass.c_str());

    unsigned long startMs = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - startMs) < timeoutMs) {
        delay(100);
    }

    if (WiFi.status() == WL_CONNECTED) {
        lastWifiError = "None";
        ensureNetworkServicesStarted();
        return true;
    }
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

    diagLog.info("[WIFI] Associating with 2.4GHz network '%s' (timeout %u ms)...", newSsid.c_str(), timeoutMs);
    setBridgeLed(50, 25, 0); // Amber indication during transition

    WiFi.disconnect(false, true);
    delay(50);
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.setHostname(BRIDGE_MDNS_HOSTNAME);
    WiFi.begin(newSsid.c_str(), newPass.c_str());

    unsigned long startMs = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - startMs) < timeoutMs) {
        delay(100);
    }

    if (WiFi.status() == WL_CONNECTED) {
        lastWifiError = "None";
        diagLog.info("[WIFI] Successfully associated with '%s'! IP: %s",
                     newSsid.c_str(), WiFi.localIP().toString().c_str());
        // Cleanly re-announce mDNS responder on the newly acquired IP address
        if (mdnsStarted) {
            MDNS.end();
            mdnsStarted = false;
        }
        ensureNetworkServicesStarted();
        setBridgeLed(0, 50, 0); // Green
        return true;
    }

    // Association failed! Rollback if we have previous working credentials
    diagLog.warn("[WIFI] Connection to '%s' failed (error: %s). Initiating automatic rollback...",
                 newSsid.c_str(), lastWifiError.c_str());
    setBridgeLed(60, 0, 0); // Red indication of failed attempt

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
            delay(100);
        }

        if (WiFi.status() == WL_CONNECTED) {
            diagLog.info("[WIFI] Rollback successful! Reconnected to '%s' (IP: %s)",
                         prevSsid.c_str(), WiFi.localIP().toString().c_str());
            if (mdnsStarted) {
                MDNS.end();
                mdnsStarted = false;
            }
            ensureNetworkServicesStarted();
            setBridgeLed(35, 0, 50); // Purple indication
            return false;
        } else {
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
    res["mode"] = (currentMode == MODE_PROXY) ? "proxy" : "standalone";
    bool wifiConn = (WiFi.status() == WL_CONNECTED);
    res["wifi_connected"] = wifiConn;
    res["ssid"] = wifiConn ? WiFi.SSID() : savedSsid;
    res["ip"] = wifiConn ? WiFi.localIP().toString() : "";
    res["hostname"] = String(BRIDGE_MDNS_HOSTNAME) + ".local";
    res["ws_port"] = BRIDGE_WS_PORT;
    res["rssi"] = wifiConn ? WiFi.RSSI() : 0;
    res["wifi_last_error"] = lastWifiError;
    res["log_seq"] = diagLog.latestSeq();
    res["backlog_records"] = backlogStore.count();
    res["backlog_capacity"] = backlogStore.capacity();
    res["psram_active"] = backlogStore.isUsingPsram();
    res["psram_free"] = ESP.getFreePsram();
    res["uptime_sec"] = millis() / 1000UL;
}

// ============================================================================
// JSON-RPC 2.0 Request Router (Shared by USB Serial & Wi-Fi WebSocket)
// ============================================================================
void handleJsonRpcRequest(const String& jsonLine, String& jsonResponseOut) {
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

    // Flush any unacknowledged log notifications before responding
    if (!reqDoc["params"].isNull() && reqDoc["params"]["ack_seq"].is<uint32_t>()) {
        uint32_t ackSeq = reqDoc["params"]["ack_seq"].as<uint32_t>();
        diagLog.flushUnacked(ackSeq, broadcastLogNotification);
    }

    const char* method = reqDoc["method"] | "";

    // Activity heartbeat -> transition to Proxy Mode
    if (currentMode != MODE_PROXY) {
        diagLog.info("[MODE] Switched to PROXY mode (desktop contact)");
    }
    lastDesktopContactMs = millis();
    currentMode = MODE_PROXY;

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
            String upsReply = executeUpsCommand(String(cmd), false);
            if (upsReply.length() == 0) {
                JsonObject errObj = resDoc["error"].to<JsonObject>();
                errObj["code"] = -32000;
                errObj["message"] = "UPS serial read timeout";
            } else {
                JsonObject result = resDoc["result"].to<JsonObject>();
                result["raw"] = upsReply;
                result["backlog_records"] = backlogStore.count();
                result["log_seq"] = diagLog.latestSeq();
                result["ip"] = (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString() : "";
            }
        }
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
        size_t limit = reqDoc["params"]["limit"] | 50;
        if (limit > 100) limit = 100;

        JsonObject result = resDoc["result"].to<JsonObject>();
        JsonArray recordsArr = result["records"].to<JsonArray>();
        size_t fetched = backlogStore.peekRecordsToJson(recordsArr, limit);
        result["fetched"] = fetched;
        result["total_remaining"] = backlogStore.count();
    }
    else if (strcmp(method, "bridge.clearBacklog") == 0) {
        size_t countToPop = reqDoc["params"]["count"] | 0;
        backlogStore.popRecords(countToPop);

        JsonObject result = resDoc["result"].to<JsonObject>();
        result["remaining"] = backlogStore.count();
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
    } else if (type == WStype_DISCONNECTED) {
        diagLog.info("[WS] Client #%u disconnected", clientNum);
    } else if (type == WStype_TEXT && payload != nullptr && length > 0) {
        String reqStr = String(reinterpret_cast<const char*>(payload), length);
        reqStr.trim();
        if (reqStr.length() > 0) {
            String resStr;
            handleJsonRpcRequest(reqStr, resStr);
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
            diagLog.info("[WIFI] Connected to AP '%s' (BSSID %02X:%02X:%02X:%02X:%02X:%02X)",
                         WiFi.SSID().c_str(),
                         info.wifi_sta_connected.bssid[0], info.wifi_sta_connected.bssid[1],
                         info.wifi_sta_connected.bssid[2], info.wifi_sta_connected.bssid[3],
                         info.wifi_sta_connected.bssid[4], info.wifi_sta_connected.bssid[5]);
            break;
        case ARDUINO_EVENT_WIFI_STA_GOT_IP:
            diagLog.info("[WIFI] DHCP IP Assigned: %s (Gateway: %s, RSSI: %d dBm)",
                         WiFi.localIP().toString().c_str(),
                         WiFi.gatewayIP().toString().c_str(),
                         WiFi.RSSI());
            lastWifiError = "None";
            ensureNetworkServicesStarted();
            break;
        case ARDUINO_EVENT_WIFI_STA_DISCONNECTED: {
            uint8_t reason = info.wifi_sta_disconnected.reason;
            lastWifiError = String(DiagLogger::wifiReasonToString(reason));
            diagLog.warn("[WIFI] Disconnected from AP: %s (Reason code %d)",
                         lastWifiError.c_str(), reason);
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
    setBridgeLed(40, 25, 0); // Amber

    Serial.begin(PC_SERIAL_BAUD);
    Serial.setRxBufferSize(2048);

    UpsSerial.begin(UPS_BAUD, SERIAL_8N1, UPS_RX_PIN, UPS_TX_PIN);

    diagLog.setNotificationSink(broadcastLogNotification);
    backlogStore.begin();

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

    if (savedSsid.length() > 0) {
        connectToWifi(savedSsid, savedPass, 8000);
    }

    lastDesktopContactMs = millis();
    lastStandalonePollMs = millis();
    lastWifiRetryMs = millis();

    setBridgeLed(0, 30, 0); // Ready: Green
}

void loop() {
    // 1. Process incoming USB Serial lines (JSON-RPC 2.0 over UART0)
    while (Serial.available()) {
        char c = static_cast<char>(Serial.read());
        if (c == '\n' || c == '\r') {
            serialLineBuf.trim();
            if (serialLineBuf.length() > 0) {
                if (serialLineBuf.startsWith("{")) {
                    String response;
                    handleJsonRpcRequest(serialLineBuf, response);
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

    // 4. 15-Second Heartbeat Watchdog: Handoff to Standalone Mode if Desktop is offline
    unsigned long nowMs = millis();
    if (nowMs - lastDesktopContactMs > PROXY_TIMEOUT_MS) {
        if (currentMode != MODE_STANDALONE) {
            currentMode = MODE_STANDALONE;
            diagLog.warn("[MODE] Switched to STANDALONE mode (15s desktop silence). Standalone logging active.");
            setBridgeLed(35, 0, 50); // Purple
        }

        if (nowMs - lastStandalonePollMs >= STANDALONE_POLL_MS) {
            lastStandalonePollMs = nowMs;
            String q1Raw = executeUpsCommand("Q1", true);
            if (q1Raw.startsWith("(") && !q1Raw.startsWith("(NAK")) {
                backlogStore.pushRecord(getCurrentTimestampSec(), q1Raw);
            }
        }
    }
}
