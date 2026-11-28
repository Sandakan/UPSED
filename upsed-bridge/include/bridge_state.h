#pragma once

#include <Arduino.h>
#include <Preferences.h>
#include <WebSocketsServer.h>
#include <WebServer.h>
#include <ArduinoJson.h>

#include "config.h"
#include "rtc_clock.h"
#include "cmd_cache.h"
#include "backlog_store.h"
#include "diag_log.h"
#include "LedController.h"
#include "q1_parser.h"
#include "tuya_mqtt.h"

struct WsClientSession {
    bool active = false;
    uint8_t clientNum = 0;
    String ip = "";
    uint32_t connectedMs = 0;
    uint32_t lastSeenMs = 0;
    uint64_t reqCount = 0;
};

enum BridgeOperatingMode {
    MODE_PROXY = 0,
    MODE_STANDALONE = 1,
    MODE_OTA = 2,
    MODE_OTA_PENDING = 3
};

// Shared Hardware & Service Instances
extern HardwareSerial UpsSerial;
extern WebSocketsServer wsServer;
extern WebServer otaServer;
extern Preferences prefs;
extern BacklogStore backlogStore;
extern DiagLogger diagLog;
extern BridgeClock bridgeClock;
extern UpsCommandCache cmdCache;
extern LedController ledController;
extern UpsTelemetrySnapshot upsTelemetry;
extern TuyaMqttController tuyaController;

// Shared Runtime State
extern WsClientSession wsClients[BRIDGE_MAX_WS_CLIENTS];
extern uint32_t usbLastSeenMs;
extern uint64_t usbReqCount;

extern BridgeOperatingMode currentMode;
extern unsigned long lastDesktopContactMs;
extern unsigned long lastStandalonePollMs;
extern unsigned long lastWifiRetryMs;
extern bool wsServerStarted;
extern bool mdnsStarted;
extern bool arduinoOtaStarted;
extern bool ntpStarted;
extern bool otaServerActive;
extern bool otaUpdating;
extern unsigned long otaLeaseExpiryMs;
extern unsigned long otaApprovalExpiryMs;
extern unsigned long bootBtnLowSinceMs;
extern String activeOtaToken;

extern String savedSsid;
extern String savedPass;
extern bool pendingWifiSwitch;
extern unsigned long pendingWifiSwitchMs;
extern String targetSsid;
extern String targetPass;
extern String rollbackSsid;
extern String rollbackPass;
extern String lastWifiError;

extern bool urgentFastPollEnabled;
extern uint32_t hostPollSec;
extern unsigned long postCmdSettleUntilMs;
extern unsigned long lastMasterPollMs;
extern bool inPostCmdSync;

uint32_t getCurrentTimestampSec();
void populateStatusObject(JsonObject& res);
void broadcastLogNotification(const String& jsonNotif);
void broadcastCommandExecuted(const String& cmd, const String& rawResp, const String& source);
void broadcastStateChanged(const String& rawQ1, const char* reason);
void broadcastBridgeStatusChanged(const char* reason = "status_updated");
