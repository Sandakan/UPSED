#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include "config.h"

// ============================================================================
// UPSED MessagePack Offline Ring Buffer (8MB Octal PSRAM Backed)
// ============================================================================
// Each telemetry sample captured during Standalone Mode is serialized using
// binary MessagePack (`serializeMsgPack`) into a compact fixed-size slot in
// PSRAM:
//   [uint8_t msgpack_len][msgpack_bytes...]
// Where the MessagePack payload represents:
//   { "ts": <uint32_t unix_epoch_or_uptime>, "raw": "(223.5 223.4 ..." }
// ============================================================================

class BacklogStore {
public:
    BacklogStore()
        : buffer_(nullptr),
          capacity_(0),
          head_(0),
          tail_(0),
          count_(0),
          usingPsram_(false) {}

    bool begin() {
        if (psramFound()) {
            size_t totalBytes = (size_t)BACKLOG_PSRAM_CAPACITY * BACKLOG_SLOT_BYTES;
            buffer_ = static_cast<uint8_t*>(ps_malloc(totalBytes));
            if (buffer_ != nullptr) {
                capacity_ = BACKLOG_PSRAM_CAPACITY;
                usingPsram_ = true;
                memset(buffer_, 0, totalBytes);
                return true;
            }
        }

        // Fallback to internal SRAM if PSRAM is not enabled
        size_t fallbackBytes = (size_t)BACKLOG_FALLBACK_CAP * BACKLOG_SLOT_BYTES;
        buffer_ = static_cast<uint8_t*>(malloc(fallbackBytes));
        if (buffer_ != nullptr) {
            capacity_ = BACKLOG_FALLBACK_CAP;
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

        JsonDocument doc;
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
            // Overwrite oldest record when full
            tail_ = (tail_ + 1) % capacity_;
        } else {
            count_++;
        }
        return true;
    }

    // Read up to `limit` records from the oldest end without removing them yet,
    // deserializing each stored MessagePack record into the target JsonArray.
    size_t peekRecordsToJson(JsonArray& outArray, size_t limit) const {
        if (!buffer_ || count_ == 0) {
            return 0;
        }

        size_t toRead = (limit < count_) ? limit : count_;
        size_t fetched = 0;

        for (size_t i = 0; i < toRead; i++) {
            size_t idx = (tail_ + i) % capacity_;
            const uint8_t* slot = slotPtr(idx);
            uint8_t packedLen = slot[0];
            if (packedLen == 0 || packedLen >= BACKLOG_SLOT_BYTES) {
                continue;
            }

            JsonDocument itemDoc;
            DeserializationError err = deserializeMsgPack(itemDoc, slot + 1, packedLen);
            if (!err) {
                JsonObject obj = outArray.add<JsonObject>();
                obj["ts"] = itemDoc["ts"].as<uint32_t>();
                obj["raw"] = itemDoc["raw"].as<const char*>();
                fetched++;
            }
        }
        return fetched;
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
    bool isUsingPsram() const { return usingPsram_; }

private:
    uint8_t* slotPtr(size_t index) const {
        return buffer_ + (index * BACKLOG_SLOT_BYTES);
    }

    uint8_t* buffer_;
    size_t capacity_;
    size_t head_;
    size_t tail_;
    size_t count_;
    bool usingPsram_;
};
