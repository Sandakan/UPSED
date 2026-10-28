# UPSED ESP32-S3 Bridge — Firmware Changelog

All notable changes to the UPSED ESP32-S3 Hardware Bridge firmware are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.5.0] - 2026-10-28

### Added
- **Hardware LED Illumination Policy (Night Schedule + Desktop Stealth Mode):** Added dual-tier autonomous illumination control for the onboard WS2812 RGB LED:
  - **Autonomous Night Schedule:** Scheduled dimming (5%–30% customizable, default 10%) or total dark mode (completely off) running on the bridge's local real-time clock across overnight spans (e.g. 22:00 to 07:00).
  - **Proxy Stealth Mode:** Dims or extinguishes the LED on your desk while the UPSED desktop application is actively monitoring, eliminating desk glare and automatically restoring normal status lighting when the app is closed.
  - **Critical Alert Wakeup Bypass:** Critical hardware alerts (AC power outage / on-battery mode, inverter faults) automatically override both Night Mode and Stealth Mode at full brightness, ensuring power emergencies are never missed.
  - **Manual Override & JSON-RPC Controls:** Added `bridge.setIllumination` and `bridge.toggleNightModeNow` JSON-RPC 2.0 endpoints with NVS flash persistence (`"upsed-conf"`).
  - **Local Time Minute Helper:** Added `localMinuteOfDay()` to `BridgeClock` for efficient integer-based scheduling.

---

## [1.4.2] - 2026-10-27

### Fixed
- **Standalone Mode NTP Daemon Churn & TuyaLink Connect Failure:** Resolved an issue where TuyaLink failed to connect while the hardware bridge was in standalone mode. `ensureNetworkServicesStarted()` in `main.cpp` was repeatedly calling `configTime()` on every main loop iteration, continuously aborting lwIP SNTP client UDP queries and preventing clock synchronization (`time(nullptr) < 1700000000`). Guarded `configTime()` with an `ntpStarted` flag that initializes once per Wi-Fi connection.
- **TuyaLink NTP Configuration Conflict:** Removed redundant `configTime(0, 0, ...)` re-trigger loop in `tuya_mqtt.h` that was churning SNTP every 30 seconds with conflicting UTC timezone parameters; TuyaLink now passively waits for centralized system clock synchronization before initiating TLS handshakes.

---

## [1.4.1] - 2026-10-25

### Added
- **Blinking Magenta OTA Authentication State:** Added dedicated `MODE_LED_OTA_AUTH` (sharp 200ms blinking magenta `85, 0, 85`) to visually indicate when ArduinoOTA UDP invitations/PBKDF2 challenge-response handshakes are in progress, or when an on-demand HTTP OTA lease is staged awaiting firmware chunks on port 8080.
- **Pulsing Magenta Continuous Stream Indication:** Added `ArduinoOTA.onProgress` callback and HTTP `UPLOAD_FILE_WRITE` LED driver hooks to continually refresh the pulsing magenta breathing wave (`20..95`) during active flash streaming, preventing LED render starvation during blocking ESP32 OTA flash writes.
- **Solid Green Flash Confirmation:** Set bridge LED to solid green (`0, 90, 0`) upon successful flash write across both ArduinoOTA and HTTP OTA before scheduling system reboot.
- **OTA Error Recovery:** Automatically reverts bridge LED mode to standalone/proxy if ArduinoOTA returns to `OTA_IDLE` following an authentication rejection or aborted handshake.

---

## [1.4.0] - 2026-10-25

### Added
- **Tuya Connection Self-Healing & Exponential Backoff:** Replaced naive fixed reconnection intervals with smart exponential backoff (`3s -> 6s -> 12s -> 24s -> 30s` cap) for transient network/TLS errors, and dedicated 60-second cooldown backoff for MQTT authentication/credential rejections (`rc=4`, `rc=5`).
- **Clean Socket Teardown:** Added strict `tlsClient.stop()` and `mqttClient.disconnect()` socket cleanup before every connection attempt to prevent leaked `mbedtls` contexts and TLS `-2` error cascades.
- **Explicit DNS Verification:** Pre-validates regional TuyaLink broker endpoints (`WiFi.hostByName`) to distinguish DNS failures from TLS handshake or credential faults.
- **Non-Blocking Multi-Server NTP Polling:** Added non-blocking 2-second clock checks against a multi-server pool (`pool.ntp.org`, `time.cloudflare.com`, `time.google.com`) with 30-second SNTP re-request throttling.
- **Tuya RGB LED Status Overlays:**
  - **Violet Pulse (`55, 0, 80`):** Periodic 450ms pulse every 3000ms window during active connection handshakes or NTP waits, plus immediate 200ms flash upon initiating connection.
  - **Orange Double-Blink (`80, 20, 0`):** 300ms double-blink pattern every 3000ms window when authentication fails or after repeated connection drops.
  - **Mint/White Telemetry Flash (`10, 75, 55`):** Brief 80ms flash whenever a telemetry report is successfully published to Tuya Cloud.
- **Bridge Reconnect Tuya RPC:** Added `bridge.reconnectTuya` JSON-RPC method to trigger an immediate, on-demand connection retry without needing to re-save configuration.
- **Granular Tuya State Telemetry:** Exposed `tuya_state`, `tuya_retry_count`, and `tuya_next_retry_sec` in `BridgeStatus` and Tuya configuration payloads.

### Fixed
- **OTA Build Flag & Authentication Secret Parity:** Attached `pre_ota.py` to the base `[env:esp32-s3-devkitc-1]` PlatformIO environment to inject `-DBRIDGE_OTA_SECRET` from `.env` on all builds, and added a factory default fallback in the OTA uploader wrapper so devices with pre-existing default secrets migrate seamlessly without `Authentication Failed` errors.

---

## [1.3.0] - 2026-10-24

### Added
- **Autonomous Master Telemetry Polling:** Implemented autonomous 5000 ms background polling (`BRIDGE_IDLE_POLL_MS`) with 6500 ms cache TTL (`UPS_CACHE_TELEMETRY_TTL_MS`), serving all host dashboard queries in <2ms with zero UART bus contention.
- **Adaptive Urgent Event Turbo Cadence:** Bridge automatically accelerates hardware polling to 2000 ms (`BRIDGE_TURBO_POLL_MS`) with 2200 ms TTL whenever urgent operating conditions occur (`utility_fail`, `battery_low`, `test_in_progress`, or fault).
- **Unsolicited State Transition Broadcasts:** Added `bridge.stateChanged` JSON-RPC notifications broadcast immediately over TCP/WebSocket on discrete state edge transitions.
- **Force Refresh Hardware Bypass:** Added `force_refresh: true` support in `ups.cmd` to bypass cached responses and query live hardware on demand.
- **Piggybacked NVS Persistent Settings:** Synchronizes host configuration (`urgent_fast_poll` and `host_poll_sec`) on RPC calls and persists to ESP32 flash without protocol overhead.

### Fixed
- **Full Status Snapshot on Time Synchronization:** Upgraded `bridge.syncTime` to populate and return full `BridgeStatus` (`populateStatusObject`) and broadcast `broadcastBridgeStatusChanged("time_synced")` to all connected clients.

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
