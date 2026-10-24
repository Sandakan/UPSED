# UPSED Desktop Application — Changelog

All notable changes to the UPSED cross-platform desktop application are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - 2026-10-24

### Added
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
