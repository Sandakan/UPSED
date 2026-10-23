#pragma once

#include <Arduino.h>
#include <time.h>
#include <sys/time.h>
#include <esp_sntp.h>
#include <Preferences.h>

// ============================================================================
// UPSED ESP32 Dual-Source Real-Time Clock Manager (NTP + Host RPC Piggyback)
// ============================================================================

class BridgeClock {
public:
    BridgeClock()
        : synced_(false),
          timeSource_("unsynced"),
          tzOffsetMin_(0),
          lastSyncEpochSec_(0),
          lastSyncMillis_(0) {}

    void begin() {
        Preferences p;
        p.begin("upsed-clock", true);
        tzOffsetMin_ = p.getInt("tz_min", 0);
        p.end();

        time_t now = time(nullptr);
        if (now > 1700000000) {
            synced_ = true;
            timeSource_ = "ntp";
            lastSyncEpochSec_ = static_cast<uint32_t>(now);
            lastSyncMillis_ = millis();
        }

        // Register SNTP sync notification callback
        sntp_set_time_sync_notification_cb([](struct timeval* tv) {
            if (tv != nullptr && tv->tv_sec > 1700000000) {
                extern BridgeClock bridgeClock;
                bridgeClock.onNtpSynced(static_cast<uint32_t>(tv->tv_sec));
            }
        });
    }

    void onNtpSynced(uint32_t epochSec) {
        synced_ = true;
        timeSource_ = "ntp";
        lastSyncEpochSec_ = epochSec;
        lastSyncMillis_ = millis();
    }

    bool syncFromHost(uint32_t hostTs, int32_t tzOffsetMin) {
        if (hostTs < 1700000000) {
            return false;
        }

        time_t currentRtc = time(nullptr);
        int64_t diff = static_cast<int64_t>(currentRtc) - static_cast<int64_t>(hostTs);
        if (diff < 0) diff = -diff;

        bool needSync = !synced_ || (timeSource_ != "ntp") || (diff > 2);

        if (needSync) {
            struct timeval tv;
            tv.tv_sec = static_cast<time_t>(hostTs);
            tv.tv_usec = 0;
            settimeofday(&tv, nullptr);

            synced_ = true;
            // Only overwrite timeSource if NTP was not actively keeping it locked
            if (timeSource_ != "ntp" || diff > 5) {
                timeSource_ = "host";
            }
            lastSyncEpochSec_ = hostTs;
            lastSyncMillis_ = millis();
        }

        // Update timezone offset if changed
        if (tzOffsetMin != tzOffsetMin_) {
            tzOffsetMin_ = tzOffsetMin;
            Preferences p;
            p.begin("upsed-clock", false);
            p.putInt("tz_min", tzOffsetMin_);
            p.end();
        }

        return true;
    }

    bool isSynced() const {
        return synced_ && (time(nullptr) > 1700000000);
    }

    const String& timeSource() const {
        return timeSource_;
    }

    int32_t tzOffsetMin() const {
        return tzOffsetMin_;
    }

    uint32_t nowEpochSec() const {
        time_t now = time(nullptr);
        if (now > 1700000000) {
            return static_cast<uint32_t>(now);
        }
        return 0;
    }

    uint32_t bootEpochSec() const {
        if (!isSynced()) {
            return 0;
        }
        uint32_t nowSec = nowEpochSec();
        uint32_t uptimeSec = millis() / 1000UL;
        return (nowSec >= uptimeSec) ? (nowSec - uptimeSec) : 0;
    }

    uint32_t epochForMillis(uint32_t eventMs) const {
        if (!isSynced()) {
            return eventMs / 1000UL;
        }
        uint32_t nowMs = millis();
        uint32_t nowSec = nowEpochSec();
        if (nowMs >= eventMs) {
            uint32_t deltaSec = (nowMs - eventMs) / 1000UL;
            return (nowSec >= deltaSec) ? (nowSec - deltaSec) : 0;
        } else {
            uint32_t deltaSec = (eventMs - nowMs) / 1000UL;
            return nowSec + deltaSec;
        }
    }

    String formatIso8601(uint32_t epochSec) const {
        if (epochSec < 1700000000) {
            return "";
        }

        // Apply local timezone offset
        int64_t localSec = static_cast<int64_t>(epochSec) + (static_cast<int64_t>(tzOffsetMin_) * 60);
        time_t rawLocal = static_cast<time_t>(localSec);
        struct tm tmBuf;
        gmtime_r(&rawLocal, &tmBuf);

        char buf[64];
        int tzAbsMin = abs(tzOffsetMin_);
        int tzHours = tzAbsMin / 60;
        int tzMins = tzAbsMin % 60;
        char tzSign = (tzOffsetMin_ >= 0) ? '+' : '-';

        if (tzOffsetMin_ == 0) {
            snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02dZ",
                     tmBuf.tm_year + 1900, tmBuf.tm_mon + 1, tmBuf.tm_mday,
                     tmBuf.tm_hour, tmBuf.tm_min, tmBuf.tm_sec);
        } else {
            snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02d%c%02d:%02d",
                     tmBuf.tm_year + 1900, tmBuf.tm_mon + 1, tmBuf.tm_mday,
                     tmBuf.tm_hour, tmBuf.tm_min, tmBuf.tm_sec,
                     tzSign, tzHours, tzMins);
        }
        return String(buf);
    }

private:
    bool synced_;
    String timeSource_;
    int32_t tzOffsetMin_;
    uint32_t lastSyncEpochSec_;
    uint32_t lastSyncMillis_;
};

extern BridgeClock bridgeClock;
