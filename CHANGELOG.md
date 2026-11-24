# UPSED Desktop Application — Changelog

All notable changes to the UPSED cross-platform desktop application are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.1.5] - 2026-11-24

### Added

- **Rust-Owned OS Action Center Notifications:** Moved native OS notification dispatch into the Rust backend (`notifications.rs`) so UPS alarms and state-change banners fire reliably via `tauri_plugin_notification` even when the WebView2 UI is completely unloaded in the system tray, minimized, or unfocused. Persisted `os_notifications_enabled` in SQLite (`get_os_notifications_enabled` / `set_os_notifications_enabled`), while keeping `react-hot-toast` for in-app toasts when the UI is active.
- **Top-Bar Master UPS Scanning Badge:** Added an animated pulsing cyan `Scanning...` badge directly inside the top-bar master UPS picker button next to the device status pill when interface scanning is in progress, eliminating the need to click open the dropdown popover to inspect scanning state.

### Changed

- **Headless System Tray Mode & Deferred WebView2 Startup:** Configured the `"main"` window (`"create": false` in `tauri.conf.json`) so `--minimized` login boot never spawns WebView2 processes, and closing the window with `close_to_minimize` enabled unloads the WebView2 UI completely (`0%` WebView2 CPU/GPU and `0 MB` WebView2 RAM in tray) while `RunEvent::ExitRequested` keeps the Rust monitor and tray icon active. Clicking the tray icon or **Open UPSED** recreates the window on demand.
- **Dependency & Toolchain Upgrades:** Updated frontend packages (TypeScript `^7.0.2`, `i18next` `^27.2.6`, `react-i18next` `^18.0.3`, Vite `8.3.8`, `@vitejs/plugin-react` `6.3.0`, `@tauri-apps/*`, Recharts `3.11.1`, TanStack Query `5.108.4`, Tailwind CSS `4.3.5`) and Rust Cargo crates (`tauri` `2.12.7`, `tauri-plugin-notification` `2.8.1`, `tauri-plugin-window-state` `2.5.0`, `tokio` `1.54.1`).

### Fixed

- **Minimized / Hidden / Unfocused Window Animation Pausing:** Updated `useWindowVisibility` to query native `isVisible()`, `isMinimized()`, and `isFocused()` on mount and track `WindowEvent::Focused` / `blur` / `focus` events, and added a root `.window-hidden` CSS rule in `App.css` to pause all CSS/SVG animations whenever the window is minimized, hidden, or unfocused behind another window.
- **Windows `cargo test` `STATUS_ENTRYPOINT_NOT_FOUND` (`0xc0000139`):** Embedded the Windows Common Controls v6 manifest in `src-tauri/build.rs` for `--lib` and integration test binaries (suppressing duplicate linker manifests on binary targets via `cargo:rustc-link-arg-bins=/MANIFEST:NO`) so `comctl32.dll` `TaskDialogIndirect` imports resolve cleanly across all `cargo test` targets.
- **WebSocket Socket Preservation on UPS Command Timeouts:** Upgraded `execute_ws_exchange` to differentiate valid JSON-RPC frames (such as code `-32000` serial hardware busy/timeout) from true TCP transport disconnects. The active WebSocket connection is kept alive on command timeouts, preventing socket churn, host failover loops, and connection flooding against the ESP32 bridge.
- **Redundant Port Scanner Probe Suppression:** Updated `scan_available_ports_with_context` to skip duplicate WebSocket probes and LAN sweeps when an ESP32 bridge is already active in `MultiPortManager`, removing connection contention on the bridge's single UART interface.

---

## [0.1.4] - 2026-11-09

### Added

- **Multi-Layered System Sleep & Wake Recovery:** Added monotonic/wall-clock time-jump detection in the Rust background monitor loop alongside frontend `visibilitychange`, `focus`, and `online` event triggers (`notify_system_resume`), automatically resetting stale WebSocket and serial handles and initiating a 2-second fast retry burst upon PC wake.
- **Automatic LAN Subnet Rediscovery Fallback:** Enhanced `BridgeTransport::try_ws_rpc` to automatically sweep the local `/24` subnet via `scan_lan_for_bridge()` when cached IPs and mDNS fail after wake or DHCP lease changes, seamlessly re-binding to the ESP32 bridge's new IP address.
- **Stale Telemetry UI Watchdog (`Reconnecting...`):** Added staleness evaluation to `getUpsOperatingState` and `DeviceStatePill` so the top bar status pill transitions from green `Online` to an amber pulsing `Reconnecting...` indicator whenever telemetry is older than 2 poll intervals (20s).

### Fixed

- **Stale WebSocket Reconnection Skip Bug:** Fixed a bug in `BridgeTransport::try_ws_rpc` where a broken pre-sleep WebSocket handle caused the primary candidate host to fail without attempting a fresh TCP/WebSocket handshake on that same host before falling back to mDNS.
- **Dead Socket Cleanup on Notification Drain:** Updated `BridgeTransport::drain_notifications` to immediately drop closed or reset WebSocket handles rather than retaining zombie sockets across poll cycles.

---

## [0.1.3] - 2026-10-31

### Added

- **Incremental Bridge Backlog Synchronization (`since_ts`):** Upgraded `sync_bridge_backlog` and device connection initialization in `commands.rs` to query the latest recorded telemetry timestamp from the local SQLite database (`get_latest_telemetry_timestamp`) and request only missing historical records from the hardware bridge.
- **Non-Destructive Backlog Sync:** Implemented `sync_backlog(since_ts)` in `BridgeTransport` using `bridge.getTelemetryHistory` (with fallback to `bridge.getBacklog`), preserving the bridge's rotating RAM buffer so multiple connecting apps can complete their databases independently without racing or wiping records.
- **Monotonic Telemetry Sequencing:** Added support for the `seq` property in `BridgeBacklogRecord`.
- **Extended Bridge Status Snapshot:** Added `backlog_oldest_ts`, `backlog_newest_ts`, and `backlog_latest_seq` to `BridgeStatus`.

---

## [0.1.2] - 2026-10-28

### Added

- **Hardware LED Illumination Policy & Controls:** Added support for autonomous Night Mode scheduling (e.g. 22:00 to 07:00, customizable 5%–30% dimming or completely off) alongside in-use Desktop Proxy Stealth Mode (dimming or extinguishing the bridge LED on your desk while actively monitoring in the UPSED desktop app).
- **Critical Alert Wakeup:** Critical UPS alarms (mains outage / on-battery mode and inverter faults) automatically override night mode and proxy stealth at full alert brightness unless explicitly disabled.
- **Tauri Illumination Commands & Gates:** Added `configure_bridge_illumination` (Stage T3 permission barrier) and `toggle_bridge_night_mode_now` (Stage T2 non-destructive manual override) with audit logging to the SQLite event trail.

---

## [0.1.1] - 2026-10-27

### Added

- **Bridge Log Playback Demarcation Banners:** Added streaming batch boundaries (`--- Starting bridge log playback ---` and `--- Completed bridge log playback (N entries, up to <timestamp>) ---`) in `BridgeTransport` RPC execution (`try_ws_rpc` and `try_serial_rpc`). Demarcates buffered ESP32 unacknowledged log bursts on connection/reconnection to clearly distinguish buffered playback replay from live events in terminal and local logs.

---

## [0.1.0] - 2026-10-24

### Fixed

- **Clean Application Termination & Instant Shutdown:** Resolved an issue where quitting the application hung or failed to immediately exit on macOS due to the dedicated `upsed-hid-actor` OS thread blocking indefinitely on an open channel receiver. Implemented `HidActorCommand::Shutdown` and `shutdown_actor()` to close open device handles and terminate the actor loop on `RunEvent::ExitRequested`, followed by an immediate process exit on `RunEvent::Exit`.
- **macOS Ad-Hoc Bundle Code Signing:** Configured `"signingIdentity": "-"` and `"hardenedRuntime": false` in `tauri.conf.json` so `npm run tauri build` signs the bundle with ad-hoc certificates, correctly binding `Info.plist` entries and preventing macOS Sequoia TCC from silently denying Local Network permissions to GUI binaries. Added quarantine clearing and re-signing instructions to the project README.
- **Startup Bridge Connection Race Condition & Granular Socket Diagnostics:** Fixed a race condition in `connect_device_internal` where multiple concurrent startup threads simultaneously dispatched WebSocket handshakes to the ESP32 bridge on port 81 by wrapping connection attempts in a serialization mutex (`CONNECT_LOCK`). Added detailed diagnostic reporting to `connect_ws` exposing DNS resolution, TCP connect, and WebSocket handshake errors directly in app logs.
- **macOS Production App Local Network Bridge Discovery & mDNS Fallback:** Resolved issue where packaged macOS application bundles reported "no devices found" for Wi-Fi connected ESP32 Bridges. Configured macOS Local Network Privacy declarations (`NSLocalNetworkUsageDescription` and `NSBonjourServices`) in `Info.plist` to prevent macOS Sequoia from blocking local socket connections. Fixed a bug in `BridgeTransport::open` where the configured fallback IP was discarded when parsing `BRIDGE:WS:` ports, and enhanced `try_ws_rpc` to automatically attempt the fallback IP when `upsed-bridge.local` fails to resolve. Improved `scan_lan_for_bridge` connection timeout (300ms) across local subnets to reliably discover Wi-Fi ESP32 devices.
- **macOS Apple Silicon PAC Signature Crash on Device Detection:** Resolved production `EXC_BREAKPOINT (SIGTRAP)` breakpoint traps in `__CFCheckCFInfoPACSignature` during USB HID device enumeration. On Apple Silicon (ARM64e), `IOHIDManager` was corrupted when `hidapi::HidApi::new()` and device handles were created and accessed across concurrent Tokio runtime worker threads. Re-architected all USB HID device discovery, UUID resolution, report I/O, and handle lifetimes into a dedicated OS actor thread (`upsed-hid-actor`), completely isolating `IOKit` / `CFRunLoop` interactions to a single OS thread and eliminating `unsafe impl Send for HidTransport`. Added regression test `hid_006` verifying multithreaded concurrent HID scanning stability.

### Added

- **Hardware Bridge Permission Gate & Audit Logging:** Extended the security barrier to protect persistent ESP32 Hardware Bridge operations. Modifying Wi-Fi provisioning credentials, TuyaLink cloud settings, dual-mode failover endpoints, or wiping flash backlogs now requires active authenticated authorization (Stage T3 equivalent), while wireless OTA firmware flashing requires fresh OS native verification (Stage T4 equivalent). All persistent bridge modifications record the verified user into the SQLite audit trail and broadcast to the in-app event stream.
- **Direct OS Auth-on-Commit in IoT View:** Integrated `useAuth` into the IoT Bridge panel with an actionable security banner, lock icons on protected action buttons, and automatic direct OS verification prompts when saving configurations or confirming OTA flashing.
- **OS Native User Verification (Touch ID & Windows Hello):** Introduced platform-native biometric and PIN authentication for hardware safety gates (`LocalAuthentication` on macOS, `UserConsentVerifier` on Windows, and `pkexec` Polkit on Linux), eliminating manual username/password setup when OS-level user locks are present.
- **Hybrid Security Fallback:** Seamlessly preserves Argon2id password authentication with OS Keyring / SQLite storage for headless systems or Windows accounts lacking biometrics/PIN without redundant keyring prompts during normal biometric operation.
- **Granular Stage T4 Fresh Verification:** Stage T4 Power Control operations (delayed shutdown, auto-restore, inverter toggle) require a fresh OS Native Auth prompt alongside typed user confirmation before command dispatch.
- **Multi-Port Hardware Management:** Auto-discovery and concurrent polling across USB HID (`0665:5161`) and serial RS-232 COM ports with persistent device profile binding and UUID roaming.
- **4-Stage Safety Command Gate:** Enforced risk-tier access control (`T1ReadOnly`, `T2NonDestructive`, `T3ConfigWrite`, `T4PowerControl`) protected by Argon2id password authentication and OS native credentials (macOS Keychain, Windows Credential Manager, Linux Secret Service) with SQLite fallback.
- **Dual-Timer Background Monitor:** 400ms fast watch tick for non-blocking bridge notification drain & direct-serial targeted test completion probes; interval tick for SQLite WAL persistence and in-place chart smoothing.
- **Direct-Serial Bus Protection:** Skips direct serial and USB HID devices during the 400ms fast tick to prevent 2400-baud UART bus contention.
- **Real-Time Interactive Topology:** Single-line electrical power flow schematic diagram visualizing active grid, rectifier, inverter, and battery charging/discharging conduits with live battery self-test animation.
- **Hardware Alarm & Notification System:** Rising-edge transition detection engine dispatching glassmorphic in-app toasts (`react-hot-toast`) and OS Action Center notifications via `@tauri-apps/plugin-notification`.
- **ESP32 Bridge Integration:** Dedicated IoT panel supporting TCP/WebSocket telemetry, Wi-Fi provisioning, TuyaLink MQTT smart home integration, and wireless in-app OTA firmware flashing with live multi-stage visualizer.
- **Battery Health & Peukert Runtime Engine:** Automatic nominal voltage detection, state-of-charge calculation, and load-compensated runtime predictions across VRLA/SLA and LiFePO4 chemistries.
- **Opt-In OS Native Battery Bridge:** Virtual laptop battery emulation across Windows Tray, Linux UPower (`/dev/uhid`), and macOS `IOPMLib` (strictly opt-in by default).
- **In-App Release Notes & Markdown Changelog Viewer:** Multi-tab About dialog rendering formatted application and firmware changelogs live via `marked` with GitHub synchronization and resilient error recovery.
- **Tuya IoT Batch Import Excel (.xlsx) Generator:** Native spreadsheet workbook generation matching official Tuya developer specifications, with strict transfer codes (`rw`/`ro`), column formatting, and native OS Save Dialog integration via `rfd` and `@tauri-apps/plugin-opener`.
- **Tuya IoT Connection Reliability & Desktop Reconnect:** Granular real-time state machine tracking (`waiting_ntp`, `connecting`, `connected`, `retrying`, `auth_failed`) with smart exponential backoff (`3s -> 6s -> 12s -> 24s -> 30s`), dedicated 60s cooldown for auth rejections, and an on-demand "Reconnect Now" RPC control in the IoT panel.
- **Tuya Hardware LED Status Overlays:** Added WS2812 RGB LED status indication guide and firmware overlay support for Tuya connecting (periodic violet pulse), connection error / auth failure (periodic orange double-blink), and telemetry report delivery (brief 80ms mint tick).
- **Multi-Environment Local PlatformIO Build Detection:** Enhanced `find_local_bridge_firmware()` to discover binaries compiled across both `esp32-s3-devkitc-1` and `esp32-s3-ota` build targets, and enabled the local build option radio button in developer mode with intelligent build status indicators.
- **OTA Diagnostic Guide & Visual State Indicators:** Documented dual-stage OTA visual feedback in the IoT bridge status guide: Blinking Magenta (200ms cycle) for authentication and staged leases, and Pulsing Magenta (800ms wave) for active firmware streaming.
