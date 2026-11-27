# UPSED — Detailed Features Guide

> Back to [README](../README.md)

## Table of Contents

- [Direct Hardware Communication & Multi-Device Support](#-direct-hardware-communication--multi-device-support)
- [Safety-First Command Gate & Authenticated Permission Barrier](#-safety-first-command-gate--authenticated-permission-barrier)
- [Comprehensive UPS Power Management](#-comprehensive-ups-power-management)
- [Real-Time Outage Interval Detection](#-real-time-outage-interval-detection)
- [Data Gap Visualization & Offline Highlighting](#-data-gap-visualization--offline-highlighting)
- [Configurable Time-Series Downsampling (LTTB / SQL Decimation)](#-configurable-time-series-downsampling-lttb--sql-decimation)
- [Internationalization (i18n) Multi-Language Support](#-internationalization-i18n-multi-language-support)
- [Hardware Profile & Peukert Active Runtime Estimation](#-hardware-profile--peukert-active-runtime-estimation)
- [Headless System Tray Lifecycle, Focus Throttling & Autostart](#-headless-system-tray-lifecycle-focus-throttling--autostart)
- [System / Light / Dark Theme Engine](#-system--light--dark-theme-engine)
- [Events Hub & SQLite Persistence](#-events-hub--sqlite-persistence)
- [Diagnostic Logging & Window Persistence](#-diagnostic-logging--window-persistence)
- [Automatic Application Updates & Release Integrity](#-automatic-application-updates--release-integrity)
- [ESP32-S3 IoT Hardware Bridge & Wireless OTA Flashing](#-esp32-s3-iot-hardware-bridge--wireless-ota-flashing)
- [OS Native Battery Bridge (Opt-In)](#-os-native-battery-bridge-opt-in)

---

### ⚡ Direct Hardware Communication & Multi-Device Support

- Connects directly to native USB HID interfaces (`VID 0x0665 / PID 0x5161` via `hidapi`) or RS-232/USB serial COM ports (`serialport` crate).
- Zero external drivers, zero Java runtime, zero Tomcat web servers, and zero open network listening ports.
- Safely auto-discovers connected hardware on both USB HID and COM ports using strictly non-destructive Stage T1 read-only queries (`QPI\r`).
- Concurrent multi-UPS management with independent communication channels and telemetry caches.

### 🛡️ Safety-First Command Gate & Authenticated Permission Barrier

- Enforces a ViewPower-style user permission barrier atop a 4-tier risk classification (see [Architecture & Safety Gate](ARCHITECTURE_AND_SAFETY.md)):
  - **Stage T1 (Read-Only):** Non-modifying telemetry queries (`QPI`, `Q1`, `QPIGS`, `QPIWS`) remain open without authentication for auto-discovery and telemetry monitoring.
  - **Stages T2–T4 (Protected):** Diagnostic self-tests (`T`, `CT`), persistent EEPROM writes (`MCHGC`, `PBVH`, `PBVL`), ESP32 bridge provisioning/cloud config, and power control require an active authenticated administrator session.
  - **Stage T4 (Power Control & Wireless OTA):** Live load-drop operations (`ShutdownWithDelay`, `ShutdownAndRestore`, `OutputOff`, `OutletOff`) and wireless bridge OTA flashing (`flash_bridge_firmware`) require fresh OS verification and/or typed confirmation ("type UPS name or SHUTDOWN") before execution.
- Primary authentication via **OS Native User Verification** (Windows Hello PIN / Biometrics, macOS Touch ID / Apple Watch, Linux Polkit), with **Argon2id** password hashing stored in the OS native credential manager (macOS Keychain, Windows Credential Manager, Linux Secret Service) and SQLite fallback.
- In-memory sliding session expires after 15 minutes of inactivity; brute-force protection locks out login after 5 failed attempts.
- Completely eliminates raw string command injection vulnerabilities (such as ViewPower's `controlNew` flaw). Every interaction is a strongly typed variant of the `VoltronicCommand` enum.
- Strict physical parameter bounds validation in Rust before any byte payload reaches the transport layer.

### ⚡ Comprehensive UPS Power Management

- **Delayed Output Shutdown (`S.<M>` / `S<M>`):** Safely power off AC inverter output after a configurable delay (presets from 18 seconds to 10 minutes, or custom minutes 0.1–99).
- **Shutdown & Auto-Restore (`S..R..`):** Shuts down AC output after delay, then automatically re-engages output once mains AC returns and a restore timer elapses.
- **Inverter Output Toggle (`SON` / `SOFF`):** Directly toggle inverter output on/off for P-series hardware without powering down internal monitoring logic.
- **Switchable Outlet Groups (`SKON` / `SKOFF`):** Independently control outlet banks 1 and 2 for smart load shedding and peripheral equipment cycling.
- **Active Shutdown Countdown & Abort:** Real-time ticker synchronized with the hardware status bit (`shutdown_active`) and one-click immediate abort (`CS`).
- **Host PC Power Safety Guard:** Prominent warnings prevent accidental power cuts to the machine running UPSED.

### 📉 Real-Time Outage Interval Detection

- Hybrid outage detection combining physical voltage thresholds (< 50V line failure) with rising-edge event correlation (`UTILITY_FAIL` and `UTILITY_RESTORE`).
- Automatic real-time status tracking with visual outage bands across charts (`OutageReferenceArea`) highlighting ongoing blackouts with live `Outage (Active)` badges.

### 🔍 Data Gap Visualization & Offline Highlighting

- Automatically flags communication gaps and offline periods when the delta exceeds `max(3.5 * medianStepMs, 3 * pollIntervalSecs, 45s)`.
- Renders responsive SVG diagonal hatch pattern textures (`DataGapReferenceArea`) across time-series charts.
- Responsive duration formatting (`45s`, `14m`, `2h 15m`, `1d 6h`) with dynamic label density (expanded label at ≥ 110px width, concise "No Data" at 60–109px, subtle texture without text at < 60px).
- Boundary anchor point injection (`injectGapAnchorPoints`) preserves true proportional duration along categorical time axes without misleading line interpolation.

### 📊 Configurable Time-Series Downsampling (LTTB / SQL Decimation)

- Balances high-frequency waveform fidelity with rapid UI rendering across extensive historical datasets.
- User-selectable graph resolution thresholds in Settings:
  - **1,500 points** — Aggressive / Lightest (ideal for low-power machines or long historical spans)
  - **3,000 points** — Balanced
  - **5,000 points** — Default (High Detail)
  - **10,000 points** — Ultra Detail
  - **Raw Data** — Unlimited (No decimation)
- Server-side SQL window decimation engine uses `ROW_NUMBER() OVER (ORDER BY id ASC)` with step modulus `(rn - 1) % step = 0` to preserve uniform temporal distribution and constant memory footprint across large historical time spans, with Raw Data mode for uncompressed transient analysis.

### 🌐 Internationalization (i18n) Multi-Language Support

- Comprehensive multi-language support covering **English (`en`)** and **French (`fr`)**.
- Modular localization across 10 translation namespaces: `common`, `nav`, `dashboard`, `control`, `config`, `history`, `events`, `settings`, `modals`, and `notifications`.
- Automatic system locale detection (`getSystemLanguage`) with explicit user overrides persisted across sessions.
- Locale-aware timestamp formatting integrated with `date-fns/locale` (`enUS`, `fr`).

### 🔋 Hardware Profile & Peukert Active Runtime Estimation

- Configurable UPS metadata specifications: Rated VA, Power Factor (0.6 Line-Interactive, 0.8 Business/Server, 0.9 Online, 1.0 Unity Enterprise), and calculated Rated Active Watts.
- Multi-chemistry battery modeling: Standard Sealed Lead-Acid (VRLA / AGM), Gel Cell, and Lithium Iron Phosphate (LiFePO4) with calibrated cell cutoff, nominal, and float voltages.
- Peukert load-derated discharge runtime estimation modeling non-linear capacity drop under high C-rate discharge (accounting for ~90–93% inverter conversion efficiency).

### 🖥️ Headless System Tray Lifecycle, Focus Throttling & Autostart

- System tray icon with live battery capacity rendering, operational tooltips, and desktop menu ("Open UPSED", "Quit UPSED").
- **Headless System Tray Mode:** Closing the window with `close_to_minimize` enabled unloads the WebView2 UI completely (`0%` WebView2 CPU/GPU and `0 MB` WebView2 RAM in the tray) while the Rust background monitor, tray icon, and OS notifications remain active. Clicking the tray icon or **Open UPSED** recreates the UI on demand.
- **Deferred `--minimized` Startup:** Booting with `start_minimized` and `--minimized` skips spawning WebView2 processes until the user opens the window.
- **Focus & Visibility Animation Pausing:** Automatically pauses CSS/SVG UI animations whenever the window is minimized, hidden, or unfocused behind another window.
- **Rust-Owned OS Action Center Notifications:** Dispatches native OS notifications directly from Rust (`tauri-plugin-notification`) when the UI is unloaded, minimized, or unfocused.
- System startup integration via `tauri-plugin-autostart` (Windows Registry Run key, macOS LaunchAgent, Linux XDG autostart).
- Native cold-boot dark background initialization (`#22262f`) eliminating white or black screen flash before initial paint.

### 🎨 System / Light / Dark Theme Engine

- Full support for **System Default**, **Light**, and **Dark** themes with instant, flash-free transitions.
- Dynamically responds to OS color scheme shifts via `prefers-color-scheme` media queries when set to System mode.
- Dual-layer synchronization across frontend `localStorage` (`upsed-theme-mode`) and the SQLite settings store.

### 📋 Events Hub & SQLite Persistence

- Dedicated Events Hub with real-time unread counter, severity classification (`Critical`, `Warning`, `Success`, `Info`), keyword search, and CSV export.
- Embedded SQLite storage (`%APPDATA%\com.adsandakannipunajith.upsed\upsed.db`) with automatic WAL journal mode.

### 📝 Diagnostic Logging & Window Persistence

- Multi-target structured logging powered by `tauri-plugin-log`: streams to terminal `stdout`, webview console, and local rotating log files (`%LOCALAPPDATA%\com.adsandakannipunajith.upsed\logs\upsed.log`).
- Window geometry persistence via `tauri-plugin-window-state`: remembers dimensions, screen position, and maximized state across reboots.

### 🔄 Automatic Application Updates & Release Integrity

- **Signed In-App Updates (`tauri-plugin-updater` + `tauri-plugin-process`):** Checks GitHub Releases (`latest.json`) on startup and on-demand via **About → Check for Updates**, verifies cryptographic `.sig` signatures against the embedded `pubkey` in `tauri.conf.json`, and provides a non-intrusive update banner with download progress and one-click **Update & Restart** (see [Automatic Updates & Release Signing](AUTO_UPDATE_AND_SIGNING.md)).
- **Release `manifest.json` Verification:** CI generates `manifest.json` per release containing SHA-256 checksums for all desktop setup binaries and ESP32-S3 bridge firmware (`version`, `size`, `sha256`), enabling verified bridge firmware version checks and OTA SHA-256 verification before flashing.

### 📡 ESP32-S3 IoT Hardware Bridge & Wireless OTA Flashing

- **Wireless Hardware Gateway:** Connects UPS units to UPSED over 2.4GHz Wi-Fi WebSocket (`ws://upsed-bridge.local:81`) or high-speed USB CDC Serial (115,200 baud), with automatic sleep/wake recovery and `/24` LAN subnet rediscovery fallback.
- **Continuous Flight-Recorder PSRAM Ring Buffer:** Auto-sizes up to **32,768 telemetry records** on 8MB PSRAM (~45.5 hours at 5s idle / ~91 hours at 10s standalone cadence) across both Proxy and Standalone modes, syncing missing intervals (`since_ts` / `since_seq`) into SQLite history on reconnect.
- **Autonomous Master Polling & Turbo Mode:** Polls at 5s idle (`BRIDGE_IDLE_POLL_MS`) with automatic 2s turbo acceleration (`BRIDGE_TURBO_POLL_MS`) during utility fail, low battery, self-tests, or faults.
- **TuyaLink Cloud MQTT & Illumination Policy:** Supports 19-DP TuyaLink cloud telemetry with exponential backoff, autonomous Night Mode LED scheduling, Desktop Proxy Stealth Mode, and Critical Alert Wakeup.
- **On-Demand Leased Wireless OTA Flashing:**
  - **In-App Desktop OTA:** One-click wireless flashing from GitHub releases or local builds directly from the UPSED UI.
  - **PlatformIO CLI:** `npm run bridge:ota` for terminal flashing over Wi-Fi.
  - **Fail-Safe Security:** Port 8080 opened strictly for 90 seconds on-demand with a hardware watchdog lease; requires `UPSED_OTA_SECRET` authentication token in `.env`. Telemetry UART paused during flash.
- **Multi-State WS2812 RGB Status LED Engine:** Priority-ranked 60Hz hardware indicator communicating real-time operational states (Solid Green proxy, Breathing Cyan standalone logging, Pulsing Red power outage), network alerts (Wi-Fi connecting/auth fail and TuyaLink status overlays), and dual-stage OTA feedback (Blinking Magenta authentication & Pulsing Magenta firmware streaming).

### 🔋 OS Native Battery Bridge (Opt-In)

- Emulates an internal system battery for desktop operating systems:
  - **Windows:** Custom taskbar tray battery level gauge & tooltips.
  - **Linux:** Virtual HID device via `/dev/uhid` recognized by UPower for GNOME/KDE desktop battery widgets.
  - **macOS:** Native menu bar power source integration via `IOPMLib`.
- **Strictly opt-in:** Disabled by default to respect user system preferences.
