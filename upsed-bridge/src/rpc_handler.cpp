#include "rpc_handler.h"
#include "bridge_state.h"
#include "ota_manager.h"
#include "ups_uart.h"

#include <WiFi.h>

void handleJsonRpcRequest(const String& jsonLine, String& jsonResponseOut, int clientNum) {
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

    // 3. Unicast Unacknowledged Log Notifications
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
            rollbackSsid = savedSsid;
            rollbackPass = savedPass;
            targetSsid = String(ssid);
            targetPass = String(pass);

            prefs.begin("upsed-wifi", false);
            prefs.putString("ssid", targetSsid);
            prefs.putString("pass", targetPass);
            prefs.end();
            savedSsid = targetSsid;
            savedPass = targetPass;

            diagLog.info("[WIFI] Staged new credentials for '%s' to NVS Flash", targetSsid.c_str());

            JsonObject result = resDoc["result"].to<JsonObject>();
            populateStatusObject(result);
            result["saved"] = true;
            result["reconnecting"] = true;
            result["target_ssid"] = targetSsid;
            result["rollback_ssid"] = rollbackSsid;
            result["current_ip"] = (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString() : "";

            pendingWifiSwitch = true;
            pendingWifiSwitchMs = millis() + 250;
        }
    }
    else if (strcmp(method, "bridge.getBacklog") == 0 || strcmp(method, "bridge.getTelemetryHistory") == 0) {
        uint32_t sinceTs = reqDoc["params"]["since_ts"] | 0;
        uint32_t sinceSeq = reqDoc["params"]["since_seq"] | 0;
        size_t offset = reqDoc["params"]["offset"] | 0;
        size_t limit = reqDoc["params"]["limit"] | 50;
        if (limit > 100) limit = 100;

        JsonObject result = resDoc["result"].to<JsonObject>();
        JsonArray recordsArr = result["records"].to<JsonArray>();
        uint32_t bootSec = bridgeClock.bootEpochSec();
        size_t totalMatching = 0;
        bool hasMore = false;
        size_t fetched = backlogStore.queryRecordsToJson(recordsArr, sinceTs, sinceSeq, offset, limit, totalMatching, hasMore, bootSec);
        result["fetched"] = fetched;
        result["offset"] = offset;
        result["total_matching"] = totalMatching;
        result["total_remaining"] = totalMatching;
        result["has_more"] = hasMore;
        result["buffer_count"] = backlogStore.count();
        result["buffer_capacity"] = backlogStore.capacity();
        result["oldest_ts"] = backlogStore.oldestTs(bootSec);
        result["newest_ts"] = backlogStore.newestTs(bootSec);
    }
    else if (strcmp(method, "bridge.clearBacklog") == 0) {
        size_t countToPop = reqDoc["params"]["count"] | 0;
        backlogStore.popRecords(countToPop);

        JsonObject result = resDoc["result"].to<JsonObject>();
        result["remaining"] = backlogStore.count();
    }
    else if (strcmp(method, "bridge.startOta") == 0) {
        if (clientNum < 0) {
            startOtaMode();
            JsonObject result = resDoc["result"].to<JsonObject>();
            result["ota_ready"] = true;
            result["ota_token"] = activeOtaToken;
            result["port"] = BRIDGE_OTA_PORT;
            result["lease_sec"] = BRIDGE_OTA_LEASE_MS / 1000UL;
            result["ip"] = (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString() : "";
        } else {
            beginPendingOtaApproval();
            JsonObject result = resDoc["result"].to<JsonObject>();
            result["ota_pending"] = true;
            result["approval_timeout_sec"] = BRIDGE_OTA_APPROVAL_TIMEOUT_MS / 1000UL;
            result["ip"] = (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString() : "";
        }
    }
    else if (strcmp(method, "bridge.pollOtaApproval") == 0) {
        JsonObject result = resDoc["result"].to<JsonObject>();
        if (currentMode == MODE_OTA && !activeOtaToken.isEmpty()) {
            result["approved"] = true;
            result["ota_ready"] = true;
            result["ota_token"] = activeOtaToken;
            result["port"] = BRIDGE_OTA_PORT;
            result["lease_sec"] = BRIDGE_OTA_LEASE_MS / 1000UL;
            result["ip"] = (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString() : "";
        } else if (currentMode == MODE_OTA_PENDING) {
            unsigned long nowMs = millis();
            unsigned long remSec = (otaApprovalExpiryMs > nowMs) ? ((otaApprovalExpiryMs - nowMs + 999UL) / 1000UL) : 0;
            result["approved"] = false;
            result["pending"] = true;
            result["remaining_sec"] = remSec;
        } else {
            result["approved"] = false;
            result["pending"] = false;
            result["expired"] = true;
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
    else if (strcmp(method, "bridge.setIllumination") == 0) {
        if (!reqDoc["params"].isNull() && reqDoc["params"].is<JsonObject>()) {
            JsonObject p = reqDoc["params"].as<JsonObject>();
            bool nightEn = p["night_enabled"] | ledController.isNightEnabled();
            const char* nTypeStr = p["night_type"] | ((ledController.getNightType() == 1) ? "off" : "dimmed");
            uint8_t nType = (strcmp(nTypeStr, "off") == 0) ? 1 : 0;
            uint8_t nDim = p["night_dim_pct"] | ledController.getNightDimPct();
            bool nWake = p["night_wake_alert"] | ledController.getNightWakeAlert();
            uint16_t nStart = p["night_start_min"] | ledController.getNightStartMin();
            uint16_t nEnd = p["night_end_min"] | ledController.getNightEndMin();

            bool sEn = p["stealth_enabled"] | ledController.isStealthEnabled();
            const char* sTypeStr = p["stealth_type"] | ((ledController.getStealthType() == 1) ? "off" : "dimmed");
            uint8_t sType = (strcmp(sTypeStr, "off") == 0) ? 1 : 0;
            uint8_t sDim = p["stealth_dim_pct"] | ledController.getStealthDimPct();

            ledController.setNightModeConfig(nightEn, nType, nDim, nWake, nStart, nEnd);
            ledController.setProxyStealthConfig(sEn, sType, sDim);

            prefs.begin("upsed-conf", false);
            prefs.putBool("night_en", nightEn);
            prefs.putUChar("night_type", nType);
            prefs.putUChar("night_dim", nDim);
            prefs.putBool("night_wake", nWake);
            prefs.putUShort("night_start", nStart);
            prefs.putUShort("night_end", nEnd);
            prefs.putBool("stealth_en", sEn);
            prefs.putUChar("stealth_type", sType);
            prefs.putUChar("stealth_dim", sDim);
            prefs.end();

            diagLog.info("[LED] Illumination policy saved (Night: %s, %s %d%% [%02d:%02d-%02d:%02d], Stealth: %s, %s %d%%)",
                         nightEn ? "true" : "false", (nType == 1) ? "off" : "dimmed", nDim,
                         nStart / 60, nStart % 60, nEnd / 60, nEnd % 60,
                         sEn ? "true" : "false", (sType == 1) ? "off" : "dimmed", sDim);
            broadcastBridgeStatusChanged("illumination_changed");
        }
        JsonObject res = resDoc["result"].to<JsonObject>();
        populateStatusObject(res);
    }
    else if (strcmp(method, "bridge.toggleNightModeNow") == 0) {
        int8_t overrideVal = 0;
        if (!reqDoc["params"].isNull() && reqDoc["params"].is<JsonObject>() && reqDoc["params"]["override"].is<int8_t>()) {
            overrideVal = reqDoc["params"]["override"].as<int8_t>();
        } else {
            overrideVal = ledController.isNightModeActive() ? -1 : 1;
        }
        ledController.setNightOverride(overrideVal);
        diagLog.info("[LED] Manual night override set to %d (Active: %s)",
                     overrideVal, ledController.isNightModeActive() ? "true" : "false");
        broadcastBridgeStatusChanged("night_override_changed");
        JsonObject res = resDoc["result"].to<JsonObject>();
        populateStatusObject(res);
    }
    else {
        JsonObject errObj = resDoc["error"].to<JsonObject>();
        errObj["code"] = -32601;
        errObj["message"] = "Method not found";
    }

    serializeJson(resDoc, jsonResponseOut);
}
