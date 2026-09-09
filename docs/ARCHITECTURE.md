# VoltWatch — Architectural Internals & Design Guide

This document describes the architectural layers, data flows, thread models, and security boundaries within **VoltWatch**.

---

## 🏛️ 1. High-Level Architectural Layers

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Presentation Layer (Web)                        │
│             React 19 + TypeScript + Vite + Tailwind CSS v4             │
│                                                                        │
│   DashboardPage    ControlPage    ConfigPage    HistoryPage   Settings │
│         ▲               ▲              ▲             ▲            ▲    │
│         └───────────────┴──────────────┼─────────────┴────────────┘    │
│                                        ▼                               │
│                         Type-Safe API (api.* in tauri.ts)              │
├────────────────────────────────────────┼───────────────────────────────┤
│                                        ▼                               │
│                        Tauri IPC Core Boundary (JSON)                  │
├────────────────────────────────────────┬───────────────────────────────┤
│                                        ▼                               │
│                       Application Layer (src-tauri/src/)               │
│                                                                        │
│     ┌────────────────────────────────────────────────────────────┐    │
│     │                      commands.rs                            │    │
│     │    IPC Handlers: scan, connect, get_status, send_command   │    │
│     └──────────────────────────────┬─────────────────────────────┘    │
│                                    │                                   │
│            ┌───────────────────────┼──────────────────────┐            │
│            ▼                       ▼                      ▼            │
│   ┌─────────────────┐    ┌──────────────────┐   ┌──────────────────┐  │
│   │  CommandGate    │    │ MultiPortManager │   │  SQLite Database │  │
│   │ (Safety Stages) │    │  (Device Map)    │   │ (Telemetry/Logs) │  │
│   └────────┬────────┘    └────────┬─────────┘   └──────────────────┘  │
│            │                      │                                    │
│            └───────────────┬──────┘                                    │
│                            ▼                                           │
│                 ┌─────────────────────┐                                │
│                 │  VoltronicProtocol  │                                │
│                 │   (Codec, Parsers)  │                                │
│                 └──────────┬──────────┘                                │
│                            ▼                                           │
│                 ┌─────────────────────┐                                │
│                 │   SerialTransport   │                                │
│                 │   (Physical/Mock)   │                                │
│                 └──────────┬──────────┘                                │
├────────────────────────────┼───────────────────────────────────────────┤
│                            ▼                                           │
│            OS Driver / Hardware Physical USB Serial                    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🔒 2. Safety Command Gate Flow

The `CommandGate` (in `src-tauri/src/gate/command_gate.rs`) acts as an immutable firewall between the UI and physical hardware ports:

```
UI: sendCommand(port, cmd)
              │
              ▼
Tauri IPC: commands::send_command
              │
              ▼
CommandGate::check_command(&cmd)
   │
   ├── Is cmd.required_stage() <= current_stage?
   │      ├── NO  ──► Return Err(GateError::StageLocked) (ZERO bytes sent)
   │      └── YES ──► Continue
   │
   ▼
cmd.as_cmd_str()
   │
   ├── Are all parameters within safe physical limits?
   │      ├── NO  ──► Return Err(ProtocolError::InvalidParameter)
   │      └── YES ──► Continue
   │
   ▼
MultiPortManager::execute_gated_command
   │
   ▼
SerialTransport::send_command(&cmd_str) ──► UPS Hardware
```

---

## 🗄️ 3. Database Schema (SQLite)

Located at `%APPDATA%\com.adsan.voltwatch\voltwatch.db` (initialized via `rusqlite` in `src-tauri/src/db/mod.rs` using `AppHandle::path().app_data_dir()`):

> [!NOTE]
> **Dev Watcher Invariant:** The database file is intentionally relocated outside the `src-tauri/` project folder. Storing the active database within `src-tauri/` causes Tauri's dev watcher to detect file modification events on every telemetry polling cycle and trigger infinite recompilation loops.

```sql
CREATE TABLE IF NOT EXISTS telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    port_name TEXT NOT NULL,
    grid_voltage REAL,
    output_voltage REAL,
    load_pct INTEGER,
    battery_voltage REAL,
    temperature_c INTEGER
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    port_name TEXT NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

---

## 🔌 4. Multi-Port Management & Concurrency

- **Device Map:** `MultiPortManager` holds `Arc<Mutex<HashMap<String, ConnectedUps>>>`.
- **Dual Transport Layer:** Transparently supports both `SerialTransport` (standard RS-232 / virtual COM ports via `serialport`) and `HidTransport` (native USB HID devices via `hidapi`).
- **Thread Safety:** Polling a device on `COM1` or `USB:0665:5161:...` takes a lock only for the duration of the 64-byte frame I/O, allowing concurrent or staggered polling across multiple ports without blocking the UI thread or other ports.
- **Port Scanner:** The scanner isolates device probes. When discovering devices, it opens each port, issues `QPI\r`, and expects `(PI`. Probes are strictly Stage T1 Read-Only; if a non-UPS device or non-responsive serial interface is probed, it times out in 1000ms and moves to the next port without panic or hang.

---

## 🔋 5. OS Battery Bridge Subsystem

- Implemented in `src-tauri/src/battery_bridge/mod.rs`.
- Controlled via `is_enabled` flag (strictly initialized to `false` by default).
- When toggled on by the user:
  - **Windows:** Updates the system notification tray icon (`set_icon`, `set_tooltip`).
  - **Linux:** Emits HID usage pages 0x84/0x85 over `/dev/uhid`, allowing UPower to register the desktop UPS as a system battery without root requirements (via standard `input` group udev rules).
  - **macOS:** Calls `IOPSCreatePowerSource` and `IOPSSetPowerSourceDetails` using CoreFoundation / IOKit FFI.

---

## 📝 6. Diagnostic Logging Subsystem

- Implemented via `tauri-plugin-log = "2"` integrated with standard Rust `log = "0.4"` / `tracing`.
- Targets simultaneously:
  1. **Standard Output (`stdout`):** Colored terminal stream during development.
  2. **Webview Console:** IPC log events surfaced to browser DevTools.
  3. **Local Rotating Log File:** Stored at `%LOCALAPPDATA%\com.adsan.voltwatch\logs\voltwatch.log` (1 MB max size, 2 rotated backups).

