---
name: voltwatch-dev
description: >-
  Essential workflows and development procedures for UPSED (formerly VoltWatch).
  Use when building the Tauri v2 backend, running the 61-test mock-hardware test suite,
  adding new Voltronic commands, or debugging serial UPS communication.
---

# UPSED Development Runbook

This skill provides step-by-step procedures for extending, building, and verifying the **UPSED** (pronounced *"U-P-S'd"*, `/juː-piː-ɛst/`) desktop application.

---

## 🛠️ Environment Prerequisites

Verify your local environment has the required toolchains:

```powershell
rustc --version
cargo --version
node --version
npm --version
```

Required versions:
- **Rust:** 1.77+ (MSVC on Windows, GCC/Clang on Linux/macOS)
- **Node.js:** v18+ (v20+ recommended)
- **C++ Tools:** Visual Studio C++ Build Tools (Windows), `build-essential` & `libudev-dev` (Linux), or Xcode Command Line Tools (macOS)

---

## 🧪 1. Running the Protocol Test Suite

UPSED uses an in-memory `MockSerialPort` that emulates real Voltronic hardware responses without requiring a physical device.

Always run and verify the test suite before and after making changes:

```powershell
cd src-tauri
cargo test
```

*The complete test suite includes 61 unit/integration tests (plus 2 ignored live-hardware tests) across 9 test suites with 0 failures.*

### Running a Specific Test Stage:
```powershell
# Stage T1 (Read-Only queries: QPI, Q1, QPIGS, QPIWS, QPIRI, QID, QVFW)
cargo test --test stage_t1_tests

# Stage T1 (USB HID candidate detection & null-padded frame decode)
cargo test --test stage_t1_hid_tests

# Stage T2 (Non-Destructive actions: BUZZER, T 10s test, CT cancel test)
cargo test --test stage_t2_tests

# Stage T3 (Configuration EEPROM writes: MCHGC, PBVH, PBVL, PSDV)
cargo test --test stage_t3_tests

# Stage T4 (Power control & shutdown: S.3, CS, OLON, OLOFF)
cargo test --test stage_t4_tests

# Security & Command Gate integrity (stage boundaries, raw injection blocks, event diffing)
cargo test --test security_and_gate_tests

# Multi-port concurrency & device isolation
cargo test --test concurrency_tests

# OS Battery bridge (opt-in validation & icon generation)
cargo test --test battery_bridge_tests

# Monitor & Database lifecycle (settings persistence, watch channels, legacy db migration)
cargo test --test monitor_tests
```

> [!IMPORTANT]
> **Strictly Read-Only Live Hardware Invariant**: Any automated test or troubleshooting probe communicating with real physical hardware MUST be marked `#[ignore]` and MUST strictly and exclusively use Stage T1 Read-Only commands (`QPI`, `Q1`, `QID`, `QVFW`). Never probe connected hardware with Stage T2 diagnostics (`T` 10s test, `C` cancel test) or Stage T3/T4 commands to prevent unintended battery discharge or load drops.

---

## 🚀 2. Launching Desktop Development Mode

To start the Vite dev server and launch the native Tauri desktop window:

```powershell
# In the root project directory:
npm run tauri dev
```

Hot Module Replacement (HMR) will automatically reflect frontend changes in `src/`. Changes in `src-tauri/` will trigger automatic Rust recompilation.

---

## 📦 3. Building Frontend Assets

To test TypeScript compilation and generate production web bundles:

```powershell
npm run build
```

---

## ➕ 4. Procedure: Adding a New Voltronic Hardware Command

When adding support for a new hardware command from the Voltronic / Axpert protocol:

### Step 1: Update the Rust Command Enum
Edit `src-tauri/src/protocol/commands.rs`:
```rust
pub enum VoltronicCommand {
    // ... existing commands ...
    MyNewCommand(u32),
}
```

### Step 2: Assign the Safety Stage
In the `required_stage(&self)` method in `commands.rs`, assign the strict safety tier:
- `UnlockStage::T1ReadOnly`: Non-modifying queries
- `UnlockStage::T2NonDestructive`: Diagnostic / observable tests
- `UnlockStage::T3ConfigWrite`: Persistent flash/EEPROM settings
- `UnlockStage::T4PowerControl`: Output power cuts or shutdowns

### Step 3: Implement Encoding & Pre-Validation
In `as_cmd_str(&self)` in `commands.rs`, validate physical safety ranges BEFORE formatting:
```rust
Self::MyNewCommand(val) => {
    if *val < 10 || *val > 100 {
        return Err(format!("Value {} out of safe range (10-100)", val));
    }
    Ok(format!("MYCMD{:03}", val))
}
```

### Step 4: Add Mock Integration Test
Add a test in `src-tauri/tests/stage_t*.rs` verifying:
1. Correct string formatting (`MYCMD050`).
2. Out-of-range value rejection.
3. Enforcement by `CommandGate` (command is rejected if gate is at a lower stage).

### Step 5: Update Frontend Type Definitions
Edit `src/lib/types.ts`:
```typescript
export type VoltronicCommand =
  // ... existing ...
  | { type: 'MyNewCommand'; payload: number };
```

### Step 6: Dispatch from UI Components
Because `send_command` in Rust dynamically deserializes the strongly-typed `VoltronicCommand` tagged enum, dispatching the new command from React requires zero custom IPC endpoint boilerplate:
```typescript
import { api } from '../lib/tauri';

// Dispatches through Tauri IPC, CommandGate validation, and serial/HID transport:
await api.sendCommand(portName, { type: 'MyNewCommand', payload: 50 });
```

---

## 🔍 5. Troubleshooting & Debugging Hardware Connections

### Serial COM Ports:
- **Port Busy / Access Denied:** Ensure no legacy software (e.g. ViewPower, PuTTY, or another serial terminal) has the COM port open.
- **Baud Rate Mismatch:** Voltronic UPS hardware operates at either **2400 baud** (standard) or **9600 baud** (some newer King/Max models) with 8 data bits, no parity, 1 stop bit (`8N1`).
- **Response Timeout:** If a command times out after 1000ms, check physical cabling. High electrical noise on inverter lines can cause frame drops.

### USB HID Interfaces (`VID 0x0665 / PID 0x5161`):
- **Device Node Format:** UPSED identifies HID devices as `USB:0665:5161:<INSTANCE_ID>`.
- **Packet Framing:** USB HID communication uses 8-byte reports with Report ID `0x00` (`[0x00, byte0, ..., byte7]`). Unused trailing bytes in input reports are null-padded (`0x00`) and stripped during frame decoding.
- **Exclusive Access:** If `HidTransport::open_path` fails with OS error 5 (Access Denied), check if a background service (such as ViewPower or Windows UPS service) has claimed exclusive access to the HID handle.

### Telemetry Parsing Variations (`Q1`):
- **Standard Megatec 8-Token Format:**
  `[0: Grid V, 1: Fault V, 2: Out V, 3: Load %, 4: Frequency Hz, 5: Battery V, 6: Temp C, 7: Status Bits]`
  - If token 5 is `< 4.0V` (e.g. `2.26V`), the unit is reporting **Volts Per Cell (V/cell)**. UPSED scales this by 12 cells for 24V packs (`2.26 * 12 = 27.12V`).
- **Axpert Inverter 9-Token Format:**
  `[0: Grid V, 1: Grid Hz, 2: Out V, 3: Out Hz, 4: Load %, 5: Watts, 6: Battery V, 7: Temp C, 8: Status Bits]`
- The parser dynamically identifies format variants by checking if token 4 contains a decimal point (`50.0`) or is not an integer load.

### Database & Log Files:
- **Database Path:** `%APPDATA%\com.adsandakannipunajith.upsed\upsed.db` (never in `src-tauri/` to prevent Tauri dev watcher hot-reload infinite loops).
- **Automated Legacy Migration:** During startup, if `upsed.db` is missing or empty, `db::migrate_legacy_db_if_needed` automatically locates and migrates legacy databases (`voltwatch.db`, including `-wal` and `-shm` journals) from `%APPDATA%\com.adsan.voltwatch\` or `%APPDATA%\voltwatch\`.
- **Log Files:** `%LOCALAPPDATA%\com.adsandakannipunajith.upsed\logs\upsed.log` (rotating, powered by `tauri-plugin-log`). Logs also stream to stdout and webview console.

### Window State & Geometry Persistence:
- **Mechanism:** Powered by `tauri-plugin-window-state = "2"`.
- **Saved State Path:** `%APPDATA%\com.adsandakannipunajith.upsed\.window-state.json`.
- **Configuration Invariants:**
  - In `tauri.conf.json`, the primary window must have `"label": "main"`.
  - In `capabilities/default.json`, `"window-state:default"` must be granted.

---

## 🔔 6. Hardware Events & Notification System Runbook

UPSED uses a poll-and-diff state transition engine to detect hardware alarms without sending disruptive hardware commands.

### Architecture Overview
1. **Rising-Edge Engine:** In `src-tauri/src/commands.rs::detect_status_events`, previous and current telemetry states (`Q1Status` and warning bitmasks) are compared on each poll cycle.
2. **Persistence & Broadcast:** New rising edges are saved to SQLite (`events` table with `severity` and `acknowledged`) and emitted in real time via `app.emit("ups-event", event)`.
3. **Headless Toast Notifications:** React frontend listens to `"ups-event"` and renders custom glassmorphic toasts with glowing severity borders using `react-hot-toast` in headless mode (`src/components/UpsedToaster.tsx`).
4. **Out-of-Focus OS Notifications:** When `document.hasFocus()` is false, `@tauri-apps/plugin-notification` sends a native Windows Action Center notification with sound.

### Procedure: Adding or Mapping a New Hardware Alarm / Warning Code
1. **Backend Diffing:** Update `detect_status_events()` in `commands.rs` to detect the rising edge transition.
2. **Notification Details:** Map the event type or warning code (e.g. `warning.aXX`) in `src/lib/notifications.ts` under `EVENT_DETAILS`:
    - Set `title` to the exact warning/alarm name.
    - Set `defaultDescription` to a concise, user-facing explanation with troubleshooting guidance.
3. **Unit Test:** Add test cases in `src-tauri/tests/security_and_gate_tests.rs` to verify rising edge detection, recovery falling edge, and zero false positives during steady state.
4. **Verification:**
   ```powershell
   cd src-tauri
   cargo test --test security_and_gate_tests
   cd ..
   npm run build
   ```
