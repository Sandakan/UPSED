#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <mbedtls/md.h>
#include <time.h>

#include "q1_parser.h"
#include "diag_log.h"

// ============================================================================
// UPSED Hardware Bridge — TuyaLink MQTT over TLS Controller (Port 8883)
// ============================================================================

typedef String (*UpsCommandExecutorFn)(const String& rawCmd, bool isStandalonePoll);

class TuyaMqttController {
public:
    TuyaMqttController() : mqttClient(tlsClient) {}

    void begin(DiagLogger* logger, UpsCommandExecutorFn cmdExec) {
        log = logger;
        execCmd = cmdExec;

        loadConfig();
        tlsClient.setInsecure();
        mqttClient.setBufferSize(2048);
        mqttClient.setKeepAlive(60);
        mqttClient.setSocketTimeout(5);
        mqttClient.setCallback([this](char* topic, byte* payload, unsigned int length) {
            this->onMqttMessage(topic, payload, length);
        });
    }

    void loadConfig() {
        Preferences p;
        p.begin("upsed-tuya", true);
        enabled = p.getBool("enabled", false);
        region = p.getString("region", "eu");
        productId = p.getString("prod_id", "");
        deviceId = p.getString("dev_id", "");
        deviceSecret = p.getString("secret", "");
        offMode = p.getString("off_mode", "SOFF");
        interlockPct = p.getInt("interlock", 8);
        p.end();

        if (interlockPct < 1) interlockPct = 1;
        if (interlockPct > 50) interlockPct = 50;
        if (offMode != "SOFF" && offMode != "S.2") offMode = "SOFF";
    }

    void saveConfig(bool en, const String& reg, const String& prodId, const String& devId,
                    const String& secret, const String& offMd, int interlock) {
        enabled = en;
        region = reg.length() > 0 ? reg : "eu";
        productId = prodId;
        deviceId = devId;
        // Preserve existing secret if user passes masked placeholder or empty string when already configured
        if (secret.length() > 0 && secret != "********") {
            deviceSecret = secret;
        }
        offMode = (offMd == "S.2") ? "S.2" : "SOFF";
        interlockPct = constrain(interlock, 1, 50);

        Preferences p;
        p.begin("upsed-tuya", false);
        p.putBool("enabled", enabled);
        p.putString("region", region);
        p.putString("prod_id", productId);
        p.putString("dev_id", deviceId);
        p.putString("secret", deviceSecret);
        p.putString("off_mode", offMode);
        p.putInt("interlock", interlockPct);
        p.end();

        if (mqttClient.connected()) {
            mqttClient.disconnect();
        }
        lastReconnectAttemptMs = 0;
        lastError = enabled ? "Reconnecting with updated config..." : "Disabled";
        if (log) {
            log->info("[TUYA] Configuration saved (Enabled: %s, Region: %s, DeviceID: %s, OffMode: %s, Interlock: %d%%)",
                      enabled ? "true" : "false", region.c_str(), deviceId.c_str(), offMode.c_str(), interlockPct);
        }
    }

    const char* getBrokerHost() const {
        if (region == "us") return "m1.tuyaus.com";
        if (region == "cn") return "m1.tuyacn.com";
        if (region == "in") return "m1.tuyain.com";
        return "m1.tuyaeu.com";
    }

    bool isEnabled() const { return enabled; }
    bool isConnected() { return enabled && mqttClient.connected(); }
    const String& getRegion() const { return region; }
    const String& getLastError() const { return lastError; }

    void populateConfigJson(JsonObject& obj, const UpsTelemetrySnapshot& snap, bool isProxyMode) {
        obj["enabled"] = enabled;
        obj["region"] = region;
        obj["broker"] = getBrokerHost();
        obj["product_id"] = productId;
        obj["device_id"] = deviceId;
        obj["has_secret"] = (deviceSecret.length() > 0);
        obj["off_mode"] = offMode;
        obj["interlock_pct"] = interlockPct;
        obj["connected"] = isConnected();
        obj["last_error"] = lastError;
        obj["output_enabled"] = snap.outputEnabled;
        obj["pc_online"] = isPcOnline(snap, isProxyMode);
    }

    bool isPcOnline(const UpsTelemetrySnapshot& snap, bool isProxyMode) const {
        return isProxyMode || (snap.valid && snap.loadPct > interlockPct);
    }

    void loop(const UpsTelemetrySnapshot& snap, bool isProxyMode, bool isOtaActive) {
        if (!enabled || isOtaActive || WiFi.status() != WL_CONNECTED) {
            if (mqttClient.connected() && (!enabled || isOtaActive)) {
                mqttClient.disconnect();
            }
            return;
        }

        if (productId.length() == 0 || deviceId.length() == 0 || deviceSecret.length() == 0) {
            lastError = "Missing ProductID, DeviceID, or DeviceSecret";
            return;
        }

        unsigned long nowMs = millis();

        if (!mqttClient.connected()) {
            if (nowMs - lastReconnectAttemptMs >= 15000UL || lastReconnectAttemptMs == 0) {
                lastReconnectAttemptMs = nowMs;
                attemptConnect();
            }
            return;
        }

        mqttClient.loop();

        // Check for immediate rising/falling edge changes on critical DPs
        bool currPcOnline = isPcOnline(snap, isProxyMode);
        bool edgeChanged = false;
        if (snap.valid) {
            if (snap.utilityFail != prevUtilityFail ||
                snap.batteryLow != prevBatteryLow ||
                snap.outputEnabled != prevOutputEnabled ||
                currPcOnline != prevPcOnline) {
                edgeChanged = true;
            }
        }

        if (edgeChanged || (snap.valid && (nowMs - lastReportMs >= 10000UL))) {
            publishTelemetryReport(snap, isProxyMode);
        }
    }

    bool publishTelemetryReport(const UpsTelemetrySnapshot& snap, bool isProxyMode) {
        if (!mqttClient.connected()) {
            lastError = "MQTT not connected";
            return false;
        }

        bool currPcOnline = isPcOnline(snap, isProxyMode);
        prevUtilityFail = snap.utilityFail;
        prevBatteryLow = snap.batteryLow;
        prevOutputEnabled = snap.outputEnabled;
        prevPcOnline = currPcOnline;
        lastReportMs = millis();

        uint32_t tsSec = getEpochSec();
        uint64_t tsMs = static_cast<uint64_t>(tsSec) * 1000ULL;

        JsonDocument doc;
        String msgId = String(tsSec) + String(millis() % 1000);
        doc["msgId"] = msgId;
        doc["time"] = tsMs;

        JsonObject data = doc["data"].to<JsonObject>();

        // A. Core Power & Status DPs
        data["ups_power_switch"] = snap.outputEnabled;
        data["force_shutdown"] = false;
        data["cancel_shutdown"] = false;
        data["output_enabled"] = snap.outputEnabled;
        data["pc_online"] = currPcOnline;

        // B. Live Telemetry DPs
        data["grid_voltage"] = serialized(String(snap.gridVoltage, 1));
        data["output_voltage"] = serialized(String(snap.outputVoltage, 1));
        data["load_pct"] = snap.loadPct;
        data["battery_pct"] = snap.batteryPct;
        data["battery_voltage"] = serialized(String(snap.batteryVoltage, 2));
        data["temperature_c"] = serialized(String(snap.temperatureC, 1));
        data["ups_mode"] = snap.upsModeStr();
        data["utility_fail"] = snap.utilityFail;
        data["battery_low"] = snap.batteryLow;

        // C. Diagnostic, Audio & Outlet DPs
        data["buzzer_mute"] = !snap.beeperOn;
        data["battery_test_10s"] = snap.testInProgress;
        data["deep_battery_test"] = false;
        data["cancel_test"] = false;
        data["outlet_1_switch"] = snap.outlet1On;
        data["outlet_2_switch"] = snap.outlet2On;

        String payload;
        serializeJson(doc, payload);

        String topic = "tylink/" + deviceId + "/thing/property/report";
        bool ok = mqttClient.publish(topic.c_str(), payload.c_str());
        if (!ok) {
            lastError = "Publish to property/report failed";
        }
        return ok;
    }

    void updateContextState(const UpsTelemetrySnapshot& snap, bool isProxyMode) {
        latestSnap = snap;
        latestProxyMode = isProxyMode;
    }

private:
    WiFiClientSecure tlsClient;
    PubSubClient mqttClient;
    DiagLogger* log = nullptr;
    UpsCommandExecutorFn execCmd = nullptr;

    bool enabled = false;
    String region = "eu";
    String productId = "";
    String deviceId = "";
    String deviceSecret = "";
    String offMode = "SOFF";
    int interlockPct = 8;
    String lastError = "Idle";

    unsigned long lastReconnectAttemptMs = 0;
    unsigned long lastReportMs = 0;

    bool prevUtilityFail = false;
    bool prevBatteryLow = false;
    bool prevOutputEnabled = false;
    bool prevPcOnline = false;

    UpsTelemetrySnapshot latestSnap;
    bool latestProxyMode = false;

    static uint32_t getEpochSec() {
        time_t now = time(nullptr);
        if (now > 1700000000) {
            return static_cast<uint32_t>(now);
        }
        return 1700000000 + (millis() / 1000UL);
    }

    static String computeHmacSha256Hex(const String& key, const String& message) {
        byte hmacResult[32];
        mbedtls_md_context_t ctx;
        mbedtls_md_type_t md_type = MBEDTLS_MD_SHA256;

        mbedtls_md_init(&ctx);
        mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(md_type), 1);
        mbedtls_md_hmac_starts(&ctx, reinterpret_cast<const unsigned char*>(key.c_str()), key.length());
        mbedtls_md_hmac_update(&ctx, reinterpret_cast<const unsigned char*>(message.c_str()), message.length());
        mbedtls_md_hmac_finish(&ctx, hmacResult);
        mbedtls_md_free(&ctx);

        char hexBuf[65];
        for (int i = 0; i < 32; i++) {
            snprintf(&hexBuf[i * 2], 3, "%02x", hmacResult[i]);
        }
        hexBuf[64] = '\0';
        return String(hexBuf);
    }

    void attemptConnect() {
        time_t now = time(nullptr);
        if (now < 1700000000) {
            configTime(0, 0, "pool.ntp.org", "time.nist.gov");
            lastError = "Waiting for NTP clock sync...";
            if (log) log->warn("[TUYA] Waiting for NTP time sync before TLS MQTT handshake...");
            return;
        }

        const char* host = getBrokerHost();
        mqttClient.setServer(host, 8883);

        String tsStr = String(static_cast<uint32_t>(now));
        String clientId = "tuyalink_" + deviceId;
        String username = deviceId + "|signMethod=hmacSha256,timestamp=" + tsStr + ",secureMode=1,accessType=1";
        String signContent = "deviceId=" + deviceId + ",timestamp=" + tsStr + ",secureMode=1,accessType=1";
        String password = computeHmacSha256Hex(deviceSecret, signContent);

        if (log) {
            log->info("[TUYA] Connecting to %s:8883 (ClientID: %s)...", host, clientId.c_str());
        }

        if (mqttClient.connect(clientId.c_str(), username.c_str(), password.c_str())) {
            lastError = "None";
            String setTopic = "tylink/" + deviceId + "/thing/property/set";
            mqttClient.subscribe(setTopic.c_str());
            if (log) {
                log->info("[TUYA] Connected to TuyaLink MQTT (%s:8883) and subscribed to %s", host, setTopic.c_str());
            }
            if (latestSnap.valid) {
                publishTelemetryReport(latestSnap, latestProxyMode);
            }
        } else {
            int st = mqttClient.state();
            lastError = "MQTT connect failed (rc=" + String(st) + ")";
            if (log) {
                log->warn("[TUYA] Connection to %s:8883 failed (rc=%d)", host, st);
            }
        }
    }

    void onMqttMessage(char* topic, byte* payload, unsigned int length) {
        if (payload == nullptr || length == 0 || execCmd == nullptr) return;

        String jsonStr = String(reinterpret_cast<const char*>(payload), length);
        if (log) {
            log->info("[TUYA] Downlink property/set received: %s", jsonStr.c_str());
        }

        JsonDocument reqDoc;
        DeserializationError err = deserializeJson(reqDoc, jsonStr);
        if (err) {
            if (log) log->warn("[TUYA] Invalid JSON in property/set payload");
            return;
        }

        const char* msgId = reqDoc["msgId"] | "";
        JsonObject data = reqDoc["data"].as<JsonObject>();
        if (data.isNull()) return;

        bool anyExecuted = false;

        // 1. Core Power Switch (SON / SOFF or S.2) with Smart Load/Host Interlock
        if (!data["ups_power_switch"].isNull()) {
            bool turnOn = data["ups_power_switch"].as<bool>();
            if (turnOn) {
                if (log) log->info("[TUYA] Executing UPS Power ON ('SON')...");
                execCmd("SON", false);
                anyExecuted = true;
            } else {
                // Enforce Smart Load & Host Interlock
                bool pcActive = isPcOnline(latestSnap, latestProxyMode);
                if (pcActive) {
                    lastError = "Blocked ups_power_switch=false: PC online or load > " + String(interlockPct) + "%";
                    if (log) {
                        log->warn("[TUYA] INTERLOCK BLOCKED ups_power_switch=false! (ProxyMode=%d, Load=%d%% > %d%%). Use force_shutdown to override.",
                                  latestProxyMode ? 1 : 0, latestSnap.loadPct, interlockPct);
                    }
                } else {
                    if (log) log->info("[TUYA] Interlock passed (PC offline). Executing UPS Power OFF ('%s')...", offMode.c_str());
                    execCmd(offMode, false);
                    anyExecuted = true;
                }
            }
        }

        // 2. Force Shutdown Override (Bypasses Load/Host Interlock)
        if (data["force_shutdown"].is<bool>() && data["force_shutdown"].as<bool>()) {
            if (log) log->warn("[TUYA] FORCE SHUTDOWN triggered! Dispatching '%s'...", offMode.c_str());
            execCmd(offMode, false);
            anyExecuted = true;
        }

        // 3. Cancel Shutdown
        if (data["cancel_shutdown"].is<bool>() && data["cancel_shutdown"].as<bool>()) {
            if (log) log->info("[TUYA] Cancelling UPS shutdown ('CS')...");
            execCmd("CS", false);
            anyExecuted = true;
        }

        // 4. Buzzer Mute Toggle
        if (!data["buzzer_mute"].isNull()) {
            bool wantMute = data["buzzer_mute"].as<bool>();
            bool currentlyMuted = !latestSnap.beeperOn;
            if (wantMute != currentlyMuted) {
                if (log) log->info("[TUYA] Toggling UPS beeper ('Q')...");
                execCmd("Q", false);
                anyExecuted = true;
            }
        }

        // 5. Battery Self-Tests
        if (data["battery_test_10s"].is<bool>() && data["battery_test_10s"].as<bool>()) {
            if (log) log->info("[TUYA] Starting 10-second battery test ('T')...");
            execCmd("T", false);
            anyExecuted = true;
        }
        if (data["deep_battery_test"].is<bool>() && data["deep_battery_test"].as<bool>()) {
            if (log) log->info("[TUYA] Starting deep battery test ('TL')...");
            execCmd("TL", false);
            anyExecuted = true;
        }
        if (data["cancel_test"].is<bool>() && data["cancel_test"].as<bool>()) {
            if (log) log->info("[TUYA] Cancelling battery self-test ('CT')...");
            execCmd("CT", false);
            anyExecuted = true;
        }

        // 6. Programmable Outlet Groups
        if (!data["outlet_1_switch"].isNull()) {
            bool on = data["outlet_1_switch"].as<bool>();
            execCmd(on ? "SKON1" : "SKOFF1", false);
            latestSnap.outlet1On = on;
            anyExecuted = true;
        }
        if (!data["outlet_2_switch"].isNull()) {
            bool on = data["outlet_2_switch"].as<bool>();
            execCmd(on ? "SKON2" : "SKOFF2", false);
            latestSnap.outlet2On = on;
            anyExecuted = true;
        }

        // Send TuyaLink set_response ACK
        JsonDocument ackDoc;
        ackDoc["msgId"] = msgId;
        ackDoc["time"] = static_cast<uint64_t>(getEpochSec()) * 1000ULL;
        ackDoc["code"] = 0;
        String ackPayload;
        serializeJson(ackDoc, ackPayload);
        String ackTopic = "tylink/" + deviceId + "/thing/property/set_response";
        mqttClient.publish(ackTopic.c_str(), ackPayload.c_str());

        // Immediately refresh Q1 telemetry and publish updated DPs back to Tuya
        if (anyExecuted) {
            String q1Raw = execCmd("Q1", false);
            latestSnap.parseQ1Response(q1Raw);
            publishTelemetryReport(latestSnap, latestProxyMode);
        }
    }
};
