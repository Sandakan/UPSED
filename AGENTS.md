# VoltWatch — Agent Guidelines & Invariants

This document establishes the universal rules, safety constraints, and architectural invariants that any AI agent or developer must adhere to when working within the **VoltWatch** repository.

---

## 🛡️ 1. Hardware Safety & Command Gate Invariants

- **NEVER bypass the CommandGate:** Every command dispatched to a serial transport or hardware port MUST flow through `CommandGate::check_command`.
- **Incremental Safety Progression:** Commands must strictly obey the four-tier hierarchy:
  - `T1ReadOnly`: Non-modifying queries (`QPI`, `Q1`, `QPIGS`, `QPIWS`, `QPIRI`, `QID`, `QVFW`).
  - `T2NonDestructive`: Observable diagnostics that do not alter flash/EEPROM or drop load (`BUZZER`, `T`, `CT`).
  - `T3ConfigWrite`: Persistent parameters (`MCHGC`, `PBVH`, `PBVL`, `PSDV`).
  - `T4PowerControl`: Power drop and shutdown operations (`S.3`, `CS`, `OLON`, `OLOFF`).
- **NO Raw Command Injection:** Never implement or expose raw string command endpoints (such as ViewPower's vulnerable `controlNew` method). All hardware interactions must be strongly typed variants of the `VoltronicCommand` enum.
- **Pre-Transmission Validation:** All parameters (charging current, bypass voltages, battery cutoff thresholds) must be validated against physical safety limits and device-rated specs in Rust before any bytes are transmitted to the serial port.
- **Port Discovery Invariant:** Serial port auto-discovery must strictly and exclusively send `QPI\r` (Query Protocol ID). Probing unknown ports with write, config, or control commands is strictly prohibited.

---

## ⚖️ 2. Clean-Room Legal & Fair-Use Invariants

- **Zero Proprietary Code:** Do not import, decompile, copy, or redistribute any Java bytecode, JSP files, XML configurations, or binary assets from Voltronic Power's ViewPower software.
- **Interoperability Exemption:** VoltWatch is developed strictly under **17 U.S.C. § 1201(f)** (DMCA reverse engineering for interoperability) and **EU Directive 2009/24/EC Article 6**. The Voltronic serial protocol is an open industrial hardware communication interface.
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
- All 45 tests across `stage_t1_tests`, `stage_t2_tests`, `stage_t3_tests`, `stage_t4_tests`, `security_and_gate_tests`, `concurrency_tests`, and `battery_bridge_tests` must pass with 0 failures and 0 warnings.
- Any new hardware command added to `VoltronicCommand` must have:
  1. A corresponding safety stage assigned in `required_stage()`.
  2. Input range validation in `as_cmd_str()`.
  3. Associated unit/mock tests in `tests/stage_t*.rs`.
  4. TypeScript interface updates in `src/lib/types.ts`.

---

## 📁 5. Tech Stack Standards

- **Backend:** Rust 2021 edition, Tauri v2, `tokio`, `serialport`, `rusqlite`, `thiserror`, `serde`.
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, Lucide React, Recharts, TanStack Query.
- **Code Style:** Idiomatic Rust (`cargo clippy`), strict TypeScript (no `any` where typed interfaces exist).

