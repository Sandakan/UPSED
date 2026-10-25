# UPSED — Agent Guidelines & Invariants

This document establishes the universal rules, safety constraints, and architectural invariants that any AI agent or developer must adhere to when working within the **UPSED** (pronounced *"U-P-S'd"*, `/juː-piː-ɛst/`) repository.

---

## 🛡️ 1. Hardware Safety & Command Gate Invariants

- **NEVER bypass the CommandGate:** Every command dispatched to a serial transport or hardware port MUST flow through `CommandGate::check_command`.
- **Command Gate & Permission Barrier Invariant:** Commands obey a four-tier risk classification, enforced by an authenticated user permission barrier:
  - `T1ReadOnly`: Non-modifying queries (`QPI`, `Q1`, `QPIGS`, `QPIWS`, `QPIRI`, `QID`, `QVFW`, `QSK1`, `QSK2`). Always permitted without authentication.
  - `T2NonDestructive`: Observable diagnostics that do not alter flash/EEPROM or drop load (`Q`, `T`, `CT`). Requires an active authenticated session.
  - `T3ConfigWrite`: Persistent parameters (`MCHGC`, `PBVH`, `PBVL`, `PSDV`) and persistent hardware bridge settings (ESP32 Wi-Fi credentials provisioning, TuyaLink cloud keys/interlock thresholds, failover host endpoint, clearing flash backlog). Requires an active authenticated session.
  - `T4PowerControl`: Power drop and shutdown operations (`S.3`, `CS`, `OLON`, `OLOFF`, `SON`, `SOFF`, `SKON`, `SKOFF`) and wireless OTA bridge firmware flashing (`flash_bridge_firmware`). Requires an active authenticated session, fresh OS native user verification, and explicit modal confirmation.
- **Credential Storage & Session Security:** Privileged access is authenticated primarily via OS Native User Verification (macOS Touch ID / Apple Watch / System Password via `LocalAuthentication.framework`, Windows Hello PIN / Biometrics via `UserConsentVerifier`, and Linux Polkit). If OS biometrics/PIN are unavailable, a hybrid fallback uses Argon2id hashed credentials stored in the OS native credential manager (macOS Keychain, Windows Credential Manager, Linux Secret Service) with secure SQLite fallback. Sessions expire after 15 minutes of inactivity; Stage T4 power control operations require an additional fresh OS authentication prompt alongside typed user confirmation.
- **NO Raw Command Injection:** Never implement or expose raw string command endpoints (such as ViewPower's vulnerable `controlNew` method). All hardware interactions must be strongly typed variants of the `VoltronicCommand` enum.
- **Pre-Transmission Validation:** All parameters (charging current, bypass voltages, battery cutoff thresholds) must be validated against physical safety limits and device-rated specs in Rust before any bytes are transmitted to the serial port.
- **Port Discovery & Probing Invariant:** Serial and USB HID auto-discovery and automated live hardware probes must strictly and exclusively send Stage T1 Read-Only commands (`QPI\r`, fallback `Q1\r`, `QID\r`, `QVFW\r`). Probing unknown or live hardware with Stage T2 diagnostic commands (such as `T` 10-second battery test or `C` cancel test), Stage T3 configuration writes, or Stage T4 power control is strictly prohibited.
- **State Transition & Event Detection Invariant:** Hardware event and alarm detection must strictly operate on a poll-and-diff (rising-edge) basis between consecutive telemetry cycles. Event detection must NEVER dispatch Stage T2/T3/T4 commands; it must rely strictly on parsed Stage T1 query payloads (`Q1`, `QPIGS`, `QPIWS`).
- **Notification Presentation Invariant:** When presenting hardware alarms and warning bitmasks (such as ViewPower `a0`–`a69` or state changes) for user notifications and toasts:
  - The warning/event text MUST serve as the **Title**.
  - A descriptive, user-friendly explanation of the condition and recommended action MUST serve as the **Description**.
  - In-app toasts must use `react-hot-toast` in headless mode (`UpsedToaster.tsx`); OS Action Center notifications must be sent via `@tauri-apps/plugin-notification` when the window is out of focus, minimized, or in tray.
- **Database Storage Path Invariant:** The embedded SQLite database (`upsed.db`) must never be placed inside `src-tauri/` or project source trees to prevent Tauri dev watcher hot-reload infinite loops. It must always reside in the platform-specific app data directory (`AppHandle::path().app_data_dir()`).
- **Voltronic Physical Port Exclusivity Invariant:** The UPS rear USB Type-B port and RS-232 port must NEVER be connected or probed simultaneously. Because both physical interfaces are multiplexed to the same internal microcontroller UART, concurrent connections cause electrical contention and frame corruption. When deploying external bridges (e.g. ESP32), the bridge must connect exclusively to the RS-232 port via a level shifter, and the USB Type-B port must remain physically disconnected.
- **Hardware Bridge Power Invariant:** The UPS RS-232 and USB Type-B ports do not supply operating power to external microcontrollers (USB Type-B is a 0V power sink; RS-232 signal lines cannot supply the ~250–400mA peaks required for Wi-Fi transmissions). External bridges must be powered via an independent 5V supply, in-line battery buffer, or direct DC-DC step-down buck converter (e.g. MP1584EN) attached to the internal battery terminals to maintain continuous 24/7 telemetry when the UPS AC output is turned off.

---

## ⚖️ 2. Clean-Room Legal & Fair-Use Invariants

- **Zero Proprietary Code:** Do not import, decompile, copy, or redistribute any Java bytecode, JSP files, XML configurations, or binary assets from Voltronic Power's ViewPower software.
- **Interoperability Exemption:** UPSED is developed strictly under **17 U.S.C. § 1201(f)** (DMCA reverse engineering for interoperability) and **EU Directive 2009/24/EC Article 6**. The Voltronic serial protocol is an open industrial hardware communication interface.
- **Independent Expression:** All documentation, UI components, data structures, and algorithms must be original, independent implementations.

---

## 🔋 3. OS Battery Bridge Invariant

- **Opt-In Only:** The OS Native Battery Bridge (which emulates a laptop battery on Windows tray, Linux UPower `/dev/uhid`, and macOS `IOPMLib`) **MUST remain disabled by default**.
- It must only be activated if the user explicitly turns it on in the Settings view.

---

## 🧪 4. Testing & Verification Invariant

- Before deploying or committing changes to the protocol, gate, or serial modules, run the mock integration test suite:
  ```bash
  cd src-tauri
  cargo test
  ```
- All 54+ tests across `stage_t1_tests`, `stage_t1_hid_tests`, `stage_t2_tests`, `stage_t3_tests`, `stage_t4_tests`, `security_and_gate_tests`, `concurrency_tests`, and `battery_bridge_tests` must pass with 0 failures and 0 warnings.
- Any new hardware command added to `VoltronicCommand` must have:
  1. A corresponding safety stage assigned in `required_stage()`.
  2. Input range validation in `as_cmd_str()`.
  3. Associated unit/mock tests in `tests/stage_t*.rs`.
  4. TypeScript interface updates in `src/lib/types.ts`.
- **Desktop App Versioning & Changelog Invariant:** Whenever delivering new features, breaking changes, or fixes to the UPSED desktop application:
  1. **Sync Version Manifests:** Maintain exact version parity across `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
  2. **Maintain Root Changelog:** Document changes in root `CHANGELOG.md` following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions (`### Added`, `### Changed`, `### Fixed`, `### Security`).
  3. **Verify Build & Tests:** Confirm with `cargo test` and `npm run build`.
- **Bridge Firmware Versioning, Changelog & Verification Invariant:** Whenever updating or modifying files in `upsed-bridge/` (C/C++ sources in `src/`, headers in `include/`, or `platformio.ini`):
  1. **Maintain Semantic Versioning:** Ensure `BRIDGE_FIRMWARE_VER` in `upsed-bridge/include/config.h` accurately reflects the change (`MAJOR.MINOR.PATCH`).
  2. **Update the Firmware Changelog:** Add a corresponding release entry in `upsed-bridge/CHANGELOG.md`.
  3. **Verify Build Artifact:** Always verify compilation and regenerate the local binary artifact using:
  ```bash
  pio run --project-dir upsed-bridge
  ```
  *(or `npm run bridge:build`). If running in an environment with external toolchain restrictions, bypass sandbox permissions for the PlatformIO build tool.*

---

## 📁 5. Tech Stack Standards

- **Backend:** Rust 2021 edition, Tauri v2, `tokio`, `serialport`, `hidapi` (USB HID), `rusqlite`, `thiserror`, `serde`, `tauri-plugin-notification`, `tauri-plugin-window-state`, `tauri-plugin-log` (stdout + local rotating log file `upsed.log`).
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, Lucide React, Recharts, TanStack Query, `react-hot-toast` (headless).
- **Code Style:** Idiomatic Rust (`cargo clippy --tests -- -D warnings`), strict TypeScript (no `any` where typed interfaces exist).
