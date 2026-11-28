#include "bridge_state.h"
#include <WiFi.h>

HardwareSerial UpsSerial(1);
WebSocketsServer wsServer(BRIDGE_WS_PORT);
WebServer otaServer(BRIDGE_OTA_PORT);
Preferences prefs;
BacklogStore backlogStore;
DiagLogger diagLog;
BridgeClock bridgeClock;
UpsCommandCache cmdCache;
LedController ledController;
UpsTelemetrySnapshot upsTelemetry;
TuyaMqttController tuyaController;

WsClientSession wsClients[BRIDGE_MAX_WS_CLIENTS];
uint32_t usbLastSeenMs = 0;
uint64_t usbReqCount = 0;

BridgeOperatingMode currentMode = MODE_PROXY;
unsigned long lastDesktopContactMs = 0;
unsigned long lastStandalonePollMs = 0;
unsigned long lastWifiRetryMs = 0;
bool wsServerStarted = false;
bool mdnsStarted = false;
bool arduinoOtaStarted = false;
bool ntpStarted = false;
bool otaServerActive = false;
bool otaUpdating = false;
unsigned long otaLeaseExpiryMs = 0;
unsigned long otaApprovalExpiryMs = 0;
unsigned long bootBtnLowSinceMs = 0;
String activeOtaToken = "";

String savedSsid = "";
String savedPass = "";
bool pendingWifiSwitch = false;
unsigned long pendingWifiSwitchMs = 0;
String targetSsid = "";
String targetPass = "";
String rollbackSsid = "";
String rollbackPass = "";
String lastWifiError = "None";

bool urgentFastPollEnabled = true;
uint32_t hostPollSec = 10;
unsigned long postCmdSettleUntilMs = 0;
unsigned long lastMasterPollMs = 0;
bool inPostCmdSync = false;

uint32_t getCurrentTimestampSec() {
    uint32_t nowSec = bridgeClock.nowEpochSec();
    if (nowSec > 1700000000) {
        return nowSec;
    }
    return static_cast<uint32_t>(millis() / 1000UL);
}

void broadcastLogNotification(const String& jsonNotif) {
    Serial.println(jsonNotif);
    if (wsServerStarted) {
        String copy = jsonNotif;
        wsServer.broadcastTXT(copy);
    }
}

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

void populateStatusObject(JsonObject& res) {
    res["bridge"] = BRIDGE_MAGIC_ID;
    res["fw"] = BRIDGE_FIRMWARE_VER;
    res["mac"] = WiFi.macAddress();
    res["mode"] = (currentMode == MODE_OTA)
        ? "ota"
        : (currentMode == MODE_OTA_PENDING)
            ? "ota_pending"
            : (currentMode == MODE_PROXY) ? "proxy" : "standalone";
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
    res["backlog_oldest_ts"] = backlogStore.oldestTs(bridgeClock.bootEpochSec());
    res["backlog_newest_ts"] = backlogStore.newestTs(bridgeClock.bootEpochSec());
    res["backlog_latest_seq"] = backlogStore.latestSeq();
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

    uint32_t rtcNow = bridgeClock.nowEpochSec();
    res["rtc_ts"] = rtcNow;
    res["rtc_iso"] = bridgeClock.formatIso8601(rtcNow);
    res["time_synced"] = bridgeClock.isSynced();
    res["time_source"] = bridgeClock.timeSource();
    res["tz_offset_min"] = bridgeClock.tzOffsetMin();

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

    res["cache_hits"] = cmdCache.hits();
    res["cache_misses"] = cmdCache.misses();
    res["cache_entries"] = cmdCache.validEntries();
    res["cache_capacity"] = cmdCache.capacity();
    res["cache_ttl_ms"] = cmdCache.telemetryTtlMs();
    res["urgent_fast_poll"] = urgentFastPollEnabled;
    res["host_poll_sec"] = hostPollSec;
    res["is_urgent"] = upsTelemetry.isUrgentCondition();

    res["night_mode_active"] = ledController.isNightModeActive();
    res["night_mode_enabled"] = ledController.isNightEnabled();
    res["night_mode_type"] = (ledController.getNightType() == 1) ? "off" : "dimmed";
    res["night_dim_pct"] = ledController.getNightDimPct();
    res["night_wake_alert"] = ledController.getNightWakeAlert();
    res["night_start_min"] = ledController.getNightStartMin();
    res["night_end_min"] = ledController.getNightEndMin();
    res["night_override"] = ledController.getNightOverride();
    res["proxy_stealth_active"] = ledController.isProxyStealthActive();
    res["proxy_stealth_enabled"] = ledController.isStealthEnabled();
    res["proxy_stealth_type"] = (ledController.getStealthType() == 1) ? "off" : "dimmed";
    res["proxy_stealth_dim_pct"] = ledController.getStealthDimPct();
}
