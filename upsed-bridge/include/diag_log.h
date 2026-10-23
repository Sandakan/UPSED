#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <esp_wifi.h>
#include "rtc_clock.h"

// ============================================================================
// UPSED ESP32 Diagnostic Logger & Real-Time Notification Broadcaster
// ============================================================================

#define DIAG_LOG_CAPACITY 64
#define DIAG_MSG_MAX_LEN  128

struct DiagLogEntry {
    uint32_t seq;
    uint32_t ms;
    char level[8];
    char msg[DIAG_MSG_MAX_LEN];
};

typedef void (*LogNotificationSink)(const String& jsonNotification);

class DiagLogger {
public:
    DiagLogger()
        : head_(0),
          count_(0),
          nextSeq_(1),
          sink_(nullptr) {}

    void setNotificationSink(LogNotificationSink sink) {
        sink_ = sink;
    }

    void log(const char* level, const char* format, ...) {
        char buffer[DIAG_MSG_MAX_LEN];
        va_list args;
        va_start(args, format);
        vsnprintf(buffer, sizeof(buffer), format, args);
        va_end(args);

        DiagLogEntry& entry = entries_[head_];
        entry.seq = nextSeq_++;
        entry.ms = millis();
        strncpy(entry.level, level, sizeof(entry.level) - 1);
        entry.level[sizeof(entry.level) - 1] = '\0';
        strncpy(entry.msg, buffer, sizeof(entry.msg) - 1);
        entry.msg[sizeof(entry.msg) - 1] = '\0';

        head_ = (head_ + 1) % DIAG_LOG_CAPACITY;
        if (count_ < DIAG_LOG_CAPACITY) {
            count_++;
        }

        // Real-time broadcast if sink is active
        if (sink_) {
            String jsonNotif;
            formatNotification(entry, jsonNotif);
            sink_(jsonNotif);
        }
    }

    void debug(const char* format, ...) {
        char buf[DIAG_MSG_MAX_LEN];
        va_list args;
        va_start(args, format);
        vsnprintf(buf, sizeof(buf), format, args);
        va_end(args);
        log("DEBUG", "%s", buf);
    }

    void info(const char* format, ...) {
        char buf[DIAG_MSG_MAX_LEN];
        va_list args;
        va_start(args, format);
        vsnprintf(buf, sizeof(buf), format, args);
        va_end(args);
        log("INFO", "%s", buf);
    }

    void warn(const char* format, ...) {
        char buf[DIAG_MSG_MAX_LEN];
        va_list args;
        va_start(args, format);
        vsnprintf(buf, sizeof(buf), format, args);
        va_end(args);
        log("WARN", "%s", buf);
    }

    void error(const char* format, ...) {
        char buf[DIAG_MSG_MAX_LEN];
        va_list args;
        va_start(args, format);
        vsnprintf(buf, sizeof(buf), format, args);
        va_end(args);
        log("ERROR", "%s", buf);
    }

    // Flush any unacknowledged entries (seq > ackSeq)
    template<typename F>
    void flushUnacked(uint32_t ackSeq, F&& outSink) {
        if (count_ == 0) return;

        // Oldest entry index
        size_t oldestIdx = (head_ + DIAG_LOG_CAPACITY - count_) % DIAG_LOG_CAPACITY;
        for (size_t i = 0; i < count_; i++) {
            size_t idx = (oldestIdx + i) % DIAG_LOG_CAPACITY;
            const DiagLogEntry& entry = entries_[idx];
            if (entry.seq > ackSeq) {
                String notif;
                formatNotification(entry, notif);
                outSink(notif);
            }
        }
    }

    uint32_t latestSeq() const {
        return nextSeq_ > 0 ? (nextSeq_ - 1) : 0;
    }

    static const char* wifiReasonToString(uint8_t reason) {
        switch (reason) {
            case WIFI_REASON_UNSPECIFIED: return "UNSPECIFIED";
            case WIFI_REASON_AUTH_EXPIRE: return "AUTH_EXPIRE";
            case WIFI_REASON_AUTH_LEAVE: return "AUTH_LEAVE";
            case WIFI_REASON_ASSOC_EXPIRE: return "ASSOC_EXPIRE";
            case WIFI_REASON_ASSOC_TOOMANY: return "ASSOC_TOOMANY (AP Max Clients Reached)";
            case WIFI_REASON_NOT_AUTHED: return "NOT_AUTHED";
            case WIFI_REASON_NOT_ASSOCED: return "NOT_ASSOCED";
            case WIFI_REASON_ASSOC_LEAVE: return "ASSOC_LEAVE";
            case WIFI_REASON_ASSOC_NOT_AUTHED: return "ASSOC_NOT_AUTHED";
            case WIFI_REASON_DISASSOC_PWRCAP_BAD: return "DISASSOC_PWRCAP_BAD";
            case WIFI_REASON_DISASSOC_SUPCHAN_BAD: return "DISASSOC_SUPCHAN_BAD";
            case WIFI_REASON_IE_INVALID: return "IE_INVALID";
            case WIFI_REASON_MIC_FAILURE: return "MIC_FAILURE";
            case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT: return "4WAY_HANDSHAKE_TIMEOUT (WPA handshake timed out)";
            case WIFI_REASON_GROUP_KEY_UPDATE_TIMEOUT: return "GROUP_KEY_UPDATE_TIMEOUT";
            case WIFI_REASON_IE_IN_4WAY_DIFFERS: return "IE_IN_4WAY_DIFFERS";
            case WIFI_REASON_GROUP_CIPHER_INVALID: return "GROUP_CIPHER_INVALID";
            case WIFI_REASON_PAIRWISE_CIPHER_INVALID: return "PAIRWISE_CIPHER_INVALID";
            case WIFI_REASON_AKMP_INVALID: return "AKMP_INVALID";
            case WIFI_REASON_UNSUPP_RSN_IE_VERSION: return "UNSUPP_RSN_IE_VERSION";
            case WIFI_REASON_INVALID_RSN_IE_CAP: return "INVALID_RSN_IE_CAP";
            case WIFI_REASON_802_1X_AUTH_FAILED: return "802_1X_AUTH_FAILED";
            case WIFI_REASON_CIPHER_SUITE_REJECTED: return "CIPHER_SUITE_REJECTED";
            case WIFI_REASON_BEACON_TIMEOUT: return "BEACON_TIMEOUT (Signal Lost / Out of Range)";
            case WIFI_REASON_NO_AP_FOUND: return "NO_AP_FOUND (Check 2.4GHz SSID & Band)";
            case WIFI_REASON_AUTH_FAIL: return "AUTH_FAIL (Incorrect Wi-Fi Password)";
            case WIFI_REASON_ASSOC_FAIL: return "ASSOC_FAIL (Router Rejected Association)";
            case WIFI_REASON_HANDSHAKE_TIMEOUT: return "HANDSHAKE_TIMEOUT";
            case WIFI_REASON_CONNECTION_FAIL: return "CONNECTION_FAIL";
            case WIFI_REASON_AP_TSF_RESET: return "AP_TSF_RESET";
            case WIFI_REASON_ROAMING: return "ROAMING";
            default: return "UNKNOWN_DISCONNECT_REASON";
        }
    }

private:
    static void formatNotification(const DiagLogEntry& entry, String& outStr) {
        JsonDocument doc;
        doc["jsonrpc"] = "2.0";
        doc["method"] = "bridge.log";
        JsonObject params = doc["params"].to<JsonObject>();
        params["seq"] = entry.seq;
        params["ms"] = entry.ms;
        params["level"] = entry.level;
        params["msg"] = entry.msg;

        extern BridgeClock bridgeClock;
        uint32_t epochSec = bridgeClock.epochForMillis(entry.ms);
        if (epochSec > 1700000000) {
            params["ts"] = epochSec;
            String iso = bridgeClock.formatIso8601(epochSec);
            if (iso.length() > 0) {
                params["iso_ts"] = iso;
            }
        }
        serializeJson(doc, outStr);
    }

    DiagLogEntry entries_[DIAG_LOG_CAPACITY];
    size_t head_;
    size_t count_;
    uint32_t nextSeq_;
    LogNotificationSink sink_;
};

extern DiagLogger diagLog;
