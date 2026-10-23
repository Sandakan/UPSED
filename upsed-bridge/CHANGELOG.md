# UPSED ESP32-S3 Bridge — Firmware Changelog

All notable changes to the UPSED ESP32-S3 Hardware Bridge firmware are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.0] - 2026-10-23

### Added
- **Multi-App Concurrency Support:** Allowed concurrent management of the UPS across up to 8 desktop/laptop UPSED client instances over Wi-Fi WebSocket (`WEBSOCKETS_SERVER_CLIENT_MAX=8`) and USB CDC without serial bus contention.
- **Hardware Bridge Serial Command Cache:** Implemented a fixed 16-slot ring-buffer command cache (`UpsCommandCache`) with tiered TTLs (1.5s for live telemetry queries, 10s for configuration queries, and 60s for static identity queries). Includes negative caching for unsupported static commands (e.g. `QPI`/`QID`/`QVFW` on Megatec P00) and immediate dynamic invalidation upon any mutating command.
- **Dual-Source RTC Real-World Clock:** Built `BridgeClock` supporting automatic background Wi-Fi NTP synchronization alongside host RPC timestamp piggybacking (`host_ts` + `tz_offset_min`). Provides retroactive real-world timestamp backfilling for early boot diagnostic logs and offline PSRAM backlog records.
- **Real-Time Cross-Client Event Broadcasting:** Broadcasts `bridge.cmdExecuted` JSON-RPC notifications to all other connected clients whenever any client dispatches a mutating UPS command.
- **Non-Destructive Backlog Pagination:** Upgraded `bridge.getBacklog` with `offset` and `limit` support, allowing multiple apps to pull offline backlog without clearing or racing data.
- **Bridge RPC Endpoints:** Added `bridge.syncTime` and `bridge.clearCache` endpoints.

---

## [1.0.2] - 2026-10-20

### Changed
- **Extended UART Read Timeout:** Increased `UPS_READ_TIMEOUT_MS` from 900 ms to 1400 ms in `config.h` to accommodate slower 2400-baud Voltronic/Megatec microcontroller ADC sampling routines for 50Hz/60Hz AC RMS calculations.
- **Standardized Guard Delay:** Extracted and standardized `UPS_GUARD_DELAY_MS` to 150 ms between successive UART frames to eliminate RS-232 transceiver line contention.

### Fixed
- **Suppressed Benign Retry Log Spam:** Removed routine `[UPS] Q1 recovered on retry attempt 1` debug logs from flooding the 64-slot in-memory circular ring buffer during normal operation. Genuine failures are logged as `WARN` only after all 3 retry attempts fail.

---

## [1.0.1] - 2026-10-20

### Changed
- **Wi-Fi RF Peak Power Management:** Reduced Wi-Fi transmission power to `15dBm` (`WIFI_POWER_15dBm`) to prevent current draw spikes and eliminate power-rail dips during network association.

### Fixed
- **Hardware UART Buffer Initialization:** Moved `Serial.setRxBufferSize(2048)` prior to `Serial.begin(115200)` to fix the `setRxBufferSize(): RX Buffer can't be resized when Serial is already running` driver crash.
- **WS2812 RMT Channel Contention:** Added a 60 µs latch delay between primary (GPIO 48) and secondary (GPIO 38) addressable RGB LED updates to prevent ESP32-S3 RMT transmitter collisions on DevKit clones.
- **Brownout Detector Safety:** Verified and retained hardware brownout monitoring enabled on the ESP32-S3 power management subsystem.
- **Immediate Boot LED Indication:** Added synchronous `ledController.forceUpdate()` call during `setup()` to render the initial amber boot state instantly.

---

## [1.0.0] - 2026-10-18

### Added
- **Initial Bridge Firmware Release:** Initial dual-mode ESP32-S3 firmware supporting both Proxy Mode (USB CDC / Wi-Fi WebSocket) and Standalone Mode (offline logging).
- **8MB Octal PSRAM Ring Buffer:** MessagePack-based circular storage holding up to 8,192 telemetry records (~22.7 hours at 10s intervals) with automatic replay upon desktop reconnection.
- **JSON-RPC 2.0 Streaming Engine:** Framed bidirectional RPC supporting `ups.query`, `bridge.status`, `bridge.backlog_pull`, `wifi.scan`, `wifi.provision`, and real-time `bridge.log` notifications.
- **On-Demand Leased HTTP OTA:** Authenticated web endpoint on port 8080 with 90-second lease timeout for secure over-the-air firmware upgrades.
- **Multi-Color WS2812 LED State Engine:** Real-time visual feedback for Wi-Fi status, desktop proxy connection, standalone logging, and active OTA flashes.
