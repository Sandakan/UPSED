#pragma once

#include <Arduino.h>
#include "config.h"
#include "rtc_clock.h"

// ============================================================================
// UPSED ESP32 Tiered Command Cache with Deterministic Ring-Buffer Eviction
// ============================================================================

#ifndef CMD_CACHE_CAPACITY
#define CMD_CACHE_CAPACITY 16
#endif

#ifndef UPS_CACHE_TELEMETRY_TTL_MS
#define UPS_CACHE_TELEMETRY_TTL_MS 1500UL
#endif

#ifndef UPS_CACHE_CONFIG_TTL_MS
#define UPS_CACHE_CONFIG_TTL_MS 10000UL
#endif

#ifndef UPS_CACHE_STATIC_TTL_MS
#define UPS_CACHE_STATIC_TTL_MS 60000UL
#endif

struct CacheSlot {
    bool valid = false;
    bool isNegative = false;
    String cmd = "";
    String raw = "";
    unsigned long cachedAtMs = 0;
    uint32_t rtcTs = 0;
    unsigned long ttlMs = 0;
};

class UpsCommandCache {
public:
    UpsCommandCache()
        : ringHead_(0),
          hits_(0),
          misses_(0) {}

    static bool isReadOnlyQuery(const String& cmd) {
        String clean = cmd;
        clean.trim();
        // Stage T1 Read-Only commands start with 'Q' and have length >= 2
        // ('Q' by itself is the legacy Stage T2 buzzer toggle command)
        return clean.startsWith("Q") && clean.length() >= 2;
    }

    static bool isStaticIdentityQuery(const String& cmd) {
        String clean = cmd;
        clean.trim();
        return (clean == "QPI" || clean == "QID" || clean == "QVFW" ||
                clean == "QMD" || clean == "QPIRI" || clean == "QRI" ||
                clean == "QBTAH");
    }

    static bool isConfigQuery(const String& cmd) {
        String clean = cmd;
        clean.trim();
        return (clean == "QBYV" || clean == "QBYF" || clean == "QHE" || clean == "QFLAG");
    }

    static unsigned long getTtlForCmd(const String& cmd) {
        if (isStaticIdentityQuery(cmd)) {
            return UPS_CACHE_STATIC_TTL_MS;
        }
        if (isConfigQuery(cmd)) {
            return UPS_CACHE_CONFIG_TTL_MS;
        }
        return UPS_CACHE_TELEMETRY_TTL_MS;
    }

    bool get(const String& cmd, String& outRaw, unsigned long& outAgeMs, bool& outIsNegative, uint32_t& outRtcTs) {
        String clean = cmd;
        clean.trim();

        if (!isReadOnlyQuery(clean)) {
            return false;
        }

        unsigned long nowMs = millis();

        for (size_t i = 0; i < CMD_CACHE_CAPACITY; i++) {
            if (slots_[i].valid && slots_[i].cmd == clean) {
                unsigned long age = nowMs - slots_[i].cachedAtMs;
                if (age <= slots_[i].ttlMs) {
                    hits_++;
                    outRaw = slots_[i].raw;
                    outAgeMs = age;
                    outIsNegative = slots_[i].isNegative;
                    outRtcTs = slots_[i].rtcTs;
                    return true;
                } else {
                    // Entry expired
                    slots_[i].valid = false;
                    break;
                }
            }
        }

        misses_++;
        return false;
    }

    void put(const String& cmd, const String& raw, bool isNegative = false) {
        String clean = cmd;
        clean.trim();

        if (!isReadOnlyQuery(clean)) {
            return;
        }

        unsigned long nowMs = millis();
        unsigned long ttl = getTtlForCmd(clean);
        extern BridgeClock bridgeClock;
        uint32_t rtcNow = bridgeClock.nowEpochSec();

        // 1. Check if slot for this command already exists -> update in place
        for (size_t i = 0; i < CMD_CACHE_CAPACITY; i++) {
            if (slots_[i].valid && slots_[i].cmd == clean) {
                slots_[i].raw = raw;
                slots_[i].isNegative = isNegative;
                slots_[i].cachedAtMs = nowMs;
                slots_[i].rtcTs = rtcNow;
                slots_[i].ttlMs = ttl;
                return;
            }
        }

        // 2. Check for an empty/invalid slot
        for (size_t i = 0; i < CMD_CACHE_CAPACITY; i++) {
            if (!slots_[i].valid) {
                slots_[i].valid = true;
                slots_[i].cmd = clean;
                slots_[i].raw = raw;
                slots_[i].isNegative = isNegative;
                slots_[i].cachedAtMs = nowMs;
                slots_[i].rtcTs = rtcNow;
                slots_[i].ttlMs = ttl;
                return;
            }
        }

        // 3. All slots full: overwrite oldest via ring head pointer
        size_t targetIdx = ringHead_;
        ringHead_ = (ringHead_ + 1) % CMD_CACHE_CAPACITY;

        slots_[targetIdx].valid = true;
        slots_[targetIdx].cmd = clean;
        slots_[targetIdx].raw = raw;
        slots_[targetIdx].isNegative = isNegative;
        slots_[targetIdx].cachedAtMs = nowMs;
        slots_[targetIdx].rtcTs = rtcNow;
        slots_[targetIdx].ttlMs = ttl;
    }

    void invalidateDynamic() {
        // Invalidate all dynamic telemetry and config read entries;
        // preserve static identity entries unless full clear is called
        for (size_t i = 0; i < CMD_CACHE_CAPACITY; i++) {
            if (slots_[i].valid && !isStaticIdentityQuery(slots_[i].cmd)) {
                slots_[i].valid = false;
            }
        }
    }

    void clearNegative() {
        for (size_t i = 0; i < CMD_CACHE_CAPACITY; i++) {
            if (slots_[i].valid && slots_[i].isNegative) {
                slots_[i].valid = false;
            }
        }
    }

    void clear() {
        for (size_t i = 0; i < CMD_CACHE_CAPACITY; i++) {
            slots_[i].valid = false;
            slots_[i].isNegative = false;
            slots_[i].cmd = "";
            slots_[i].raw = "";
        }
        ringHead_ = 0;
    }

    size_t validEntries() const {
        size_t count = 0;
        for (size_t i = 0; i < CMD_CACHE_CAPACITY; i++) {
            if (slots_[i].valid) count++;
        }
        return count;
    }

    size_t capacity() const { return CMD_CACHE_CAPACITY; }
    uint64_t hits() const { return hits_; }
    uint64_t misses() const { return misses_; }
    unsigned long telemetryTtlMs() const { return UPS_CACHE_TELEMETRY_TTL_MS; }

private:
    CacheSlot slots_[CMD_CACHE_CAPACITY];
    size_t ringHead_;
    uint64_t hits_;
    uint64_t misses_;
};

extern UpsCommandCache cmdCache;
