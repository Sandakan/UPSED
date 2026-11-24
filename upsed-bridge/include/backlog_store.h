#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include "config.h"

// ============================================================================
// UPSED MessagePack Telemetry Ring Buffer (PSRAM & SRAM Bounded Auto-Sizing)
// ============================================================================
// Continuously retains high-resolution rotating telemetry polls (Q1) in RAM.
// Each telemetry sample is serialized using binary MessagePack into a compact
// fixed-size slot:
//   [uint8_t msgpack_len][msgpack_bytes...]
// Where the MessagePack payload represents:
//   { "seq": <uint32_t>, "ts": <uint32_t>, "raw": "(223.5 223.4 ..." }
// ============================================================================

class BacklogStore {
public:
    BacklogStore()
        : buffer_(nullptr),
          capacity_(0),
          head_(0),
          tail_(0),
          count_(0),
          seq_(0),
          usingPsram_(false) {}

    bool begin() {
        if (psramFound()) {
            size_t freePsram = ESP.getFreePsram();
            // Maintain at least a 2.0 MB safety floor in PSRAM for OTA/TLS/WebSockets
            if (freePsram > 2 * 1024 * 1024) {
                size_t usablePsram = freePsram - (2 * 1024 * 1024);
                size_t desiredSlots = (usablePsram / 2) / BACKLOG_SLOT_BYTES;
                if (desiredSlots > BACKLOG_PSRAM_MAX_CAPACITY) {
                    desiredSlots = BACKLOG_PSRAM_MAX_CAPACITY;
                }
                if (desiredSlots < 8192) {
                    desiredSlots = 8192;
                }

                size_t totalBytes = desiredSlots * BACKLOG_SLOT_BYTES;
                buffer_ = static_cast<uint8_t*>(ps_malloc(totalBytes));
                if (buffer_ != nullptr) {
                    capacity_ = desiredSlots;
                    usingPsram_ = true;
                    memset(buffer_, 0, totalBytes);
                    return true;
                }
            }
        }

        // Safe internal SRAM fallback for lower-end chips (WROOM-32 / ESP32-C3)
        size_t freeSram = ESP.getFreeHeap();
        size_t sramSlots = (freeSram >= 160 * 1024) ? BACKLOG_SRAM_MAX_CAPACITY : BACKLOG_SRAM_MIN_CAPACITY;
        size_t fallbackBytes = sramSlots * BACKLOG_SLOT_BYTES;
        buffer_ = static_cast<uint8_t*>(malloc(fallbackBytes));
        if (buffer_ != nullptr) {
            capacity_ = sramSlots;
            usingPsram_ = false;
            memset(buffer_, 0, fallbackBytes);
            return true;
        }
        return false;
    }

    // Serialize a telemetry sample into MessagePack and push into the ring buffer
    bool pushRecord(uint32_t timestampSec, const String& rawTelemetry) {
        if (!buffer_ || capacity_ == 0) {
            return false;
        }

        seq_++;

        JsonDocument doc;
        doc["seq"] = seq_;
        doc["ts"] = timestampSec;
        doc["raw"] = rawTelemetry;

        uint8_t tempBuf[BACKLOG_SLOT_BYTES - 1];
        size_t packedLen = serializeMsgPack(doc, tempBuf, sizeof(tempBuf));
        if (packedLen == 0 || packedLen >= BACKLOG_SLOT_BYTES) {
            return false;
        }

        uint8_t* slot = slotPtr(head_);
        slot[0] = static_cast<uint8_t>(packedLen);
        memcpy(slot + 1, tempBuf, packedLen);

        head_ = (head_ + 1) % capacity_;
        if (count_ == capacity_) {
            // Overwrite oldest record when full (FIFO circular wrap)
            tail_ = (tail_ + 1) % capacity_;
        } else {
            count_++;
        }
        return true;
    }

    // Non-destructive query supporting since_ts and since_seq filters with pagination
    size_t queryRecordsToJson(JsonArray& outArray,
                              uint32_t sinceTs,
                              uint32_t sinceSeq,
                              size_t offset,
                              size_t limit,
                              size_t& totalMatching,
                              bool& hasMore,
                              uint32_t bootEpochSec = 0) const {
        totalMatching = 0;
        hasMore = false;
        if (!buffer_ || count_ == 0) {
            return 0;
        }

        // Binary search to find first matching index
        size_t firstMatch = 0;
        if (sinceSeq > 0) {
            size_t low = 0, high = count_;
            while (low < high) {
                size_t mid = low + (high - low) / 2;
                uint32_t s = 0, t = 0;
                if (readSlotHeader(mid, s, t, bootEpochSec) && s > sinceSeq) {
                    high = mid;
                } else {
                    low = mid + 1;
                }
            }
            firstMatch = low;
        } else if (sinceTs > 0) {
            size_t low = 0, high = count_;
            while (low < high) {
                size_t mid = low + (high - low) / 2;
                uint32_t s = 0, t = 0;
                if (readSlotHeader(mid, s, t, bootEpochSec) && t > sinceTs) {
                    high = mid;
                } else {
                    low = mid + 1;
                }
            }
            firstMatch = low;
        }

        if (firstMatch >= count_) {
            totalMatching = 0;
            return 0;
        }

        totalMatching = count_ - firstMatch;
        if (offset >= totalMatching) {
            return 0;
        }

        size_t available = totalMatching - offset;
        size_t toRead = (limit < available) ? limit : available;
        size_t fetched = 0;

        for (size_t i = 0; i < toRead; i++) {
            size_t vIdx = firstMatch + offset + i;
            size_t idx = (tail_ + vIdx) % capacity_;
            const uint8_t* slot = slotPtr(idx);
            uint8_t packedLen = slot[0];
            if (packedLen == 0 || packedLen >= BACKLOG_SLOT_BYTES) {
                continue;
            }

            JsonDocument itemDoc;
            DeserializationError err = deserializeMsgPack(itemDoc, slot + 1, packedLen);
            if (!err) {
                JsonObject obj = outArray.add<JsonObject>();
                uint32_t recSeq = itemDoc["seq"] | 0;
                uint32_t recTs = itemDoc["ts"].as<uint32_t>();
                if (recTs < 1700000000 && bootEpochSec > 1700000000) {
                    recTs = bootEpochSec + recTs;
                }
                if (recSeq > 0) {
                    obj["seq"] = recSeq;
                }
                obj["ts"] = recTs;
                obj["raw"] = itemDoc["raw"].as<const char*>();
                fetched++;
            }
        }

        hasMore = ((offset + fetched) < totalMatching);
        return fetched;
    }

    // Backwards-compatible peekRecordsToJson for legacy callers
    size_t peekRecordsToJson(JsonArray& outArray, size_t offset, size_t limit, uint32_t bootEpochSec = 0) const {
        size_t total = 0;
        bool more = false;
        return queryRecordsToJson(outArray, 0, 0, offset, limit, total, more, bootEpochSec);
    }

    size_t peekRecordsToJson(JsonArray& outArray, size_t limit) const {
        return peekRecordsToJson(outArray, 0, limit, 0);
    }

    // Oldest record effective timestamp (or 0 if empty)
    uint32_t oldestTs(uint32_t bootEpochSec = 0) const {
        if (!buffer_ || count_ == 0) return 0;
        uint32_t seq = 0, ts = 0;
        if (readSlotHeader(0, seq, ts, bootEpochSec)) return ts;
        return 0;
    }

    // Newest record effective timestamp (or 0 if empty)
    uint32_t newestTs(uint32_t bootEpochSec = 0) const {
        if (!buffer_ || count_ == 0) return 0;
        uint32_t seq = 0, ts = 0;
        if (readSlotHeader(count_ - 1, seq, ts, bootEpochSec)) return ts;
        return 0;
    }

    // Remove `numToPop` oldest records (or clear all if numToPop == 0 or >= count_)
    void popRecords(size_t numToPop) {
        if (numToPop == 0 || numToPop >= count_) {
            clear();
            return;
        }
        tail_ = (tail_ + numToPop) % capacity_;
        count_ -= numToPop;
    }

    void clear() {
        head_ = 0;
        tail_ = 0;
        count_ = 0;
    }

    size_t count() const { return count_; }
    size_t capacity() const { return capacity_; }
    uint32_t latestSeq() const { return seq_; }
    bool isUsingPsram() const { return usingPsram_; }

private:
    uint8_t* slotPtr(size_t index) const {
        return buffer_ + (index * BACKLOG_SLOT_BYTES);
    }

    bool readSlotHeader(size_t vIdx, uint32_t& outSeq, uint32_t& outTs, uint32_t bootEpochSec) const {
        if (!buffer_ || vIdx >= count_) return false;
        size_t idx = (tail_ + vIdx) % capacity_;
        const uint8_t* slot = slotPtr(idx);
        uint8_t packedLen = slot[0];
        if (packedLen == 0 || packedLen >= BACKLOG_SLOT_BYTES) return false;
        JsonDocument doc;
        if (deserializeMsgPack(doc, slot + 1, packedLen)) return false;
        outSeq = doc["seq"] | 0;
        uint32_t recTs = doc["ts"] | 0;
        if (recTs < 1700000000 && bootEpochSec > 1700000000) {
            recTs = bootEpochSec + recTs;
        }
        outTs = recTs;
        return true;
    }

    uint8_t* buffer_;
    size_t capacity_;
    size_t head_;
    size_t tail_;
    size_t count_;
    uint32_t seq_;
    bool usingPsram_;
};
