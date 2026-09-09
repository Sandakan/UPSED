---
name: voltwatch-dev
description: >-
  Essential workflows and development procedures for VoltWatch.
  Use when building the Tauri v2 backend, running the 45-test mock-hardware test suite,
  adding new Voltronic commands, or debugging serial UPS communication.
---

# VoltWatch Development Runbook

This skill provides step-by-step procedures for extending, building, and verifying the **VoltWatch** desktop application.

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
- **Rust:** 1.77+ (MSVC on Windows)
- **Node.js:** v18+ (v20+ recommended)
- **C++ Tools:** Visual Studio C++ Build Tools (Windows) or `build-essential` (Linux)

---

## 🧪 1. Running the Protocol Test Suite

VoltWatch uses an in-memory `MockSerialPort` that emulates real Voltronic hardware responses without requiring a physical device.

Always run and verify the test suite before and after making changes:

```powershell
cd src-tauri
cargo test
```

### Running a Specific Test Stage:
```powershell
# Stage T1 (Read-Only queries)
cargo test --test stage_t1_tests

# Stage T1 (USB HID candidate detection & decode)
cargo test --test stage_t1_hid_tests

# Stage T2 (Non-Destructive actions)
cargo test --test stage_t2_tests

# Stage T3 (Configuration EEPROM writes)
cargo test --test stage_t3_tests

# Stage T4 (Power control & shutdown)
cargo test --test stage_t4_tests

# Security & Command Gate integrity
cargo test --test security_and_gate_tests

# Multi-port concurrency & isolation
cargo test --test concurrency_tests

# OS Battery bridge (opt-in check)
cargo test --test battery_bridge_tests
```

> [!IMPORTANT]
> **Strictly Read-Only Live Hardware Invariant**: Any automated test or troubleshooting probe communicating with real physical hardware MUST be marked `#[ignore]` and MUST strictly and exclusively use Stage T1 Read-Only commands (`QPI`, `Q1`, `QID`, `QVFW`). Never probe connected hardware with Stage T2 diagnostics (`T` 10s test, `C` cancel test) or Stage T3/T4 commands to prevent unintended battery discharge or load drops.

---

## 🚀 2. Launching Desktop Development Mode

To start the Vite dev server and launch the native Tauri desktop window:

```powershell
# In the root VoltWatch directory:
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

---

## 🔍 5. Troubleshooting & Debugging Hardware Connections

### Serial COM Ports:
- **Port Busy / Access Denied:** Ensure no legacy software (e.g. ViewPower, Putty, or another serial terminal) has the COM port open.
- **Baud Rate Mismatch:** Voltronic UPS hardware operates at either **2400 baud** (standard) or **9600 baud** (some newer King/Max models) with 8 data bits, no parity, 1 stop bit (`8N1`).
- **Response Timeout:** If a command times out after 1000ms, check physical cabling. High electrical noise on inverter lines can cause frame drops.

### USB HID Interfaces (`VID 0x0665 / PID 0x5161`):
- **Device Node Format:** VoltWatch identifies HID devices as `USB:0665:5161:<INSTANCE_ID>`.
- **Packet Framing:** USB HID communication uses 8-byte reports with Report ID `0x00` (`[0x00, byte0, ..., byte7]`). Unused trailing bytes in input reports are null-padded (`0x00`) and stripped during frame decoding.
- **Exclusive Access:** If `HidTransport::open_path` fails with OS error 5 (Access Denied), check if a background service (such as ViewPower or Windows UPS service) has claimed exclusive access to the HID handle.

### Telemetry Parsing Variations (`Q1`):
- **Standard Megatec 8-Token Format:**
  `[0: Grid V, 1: Fault V, 2: Out V, 3: Load %, 4: Frequency Hz, 5: Battery V, 6: Temp C, 7: Status Bits]`
  - If token 5 is `< 4.0V` (e.g. `2.26V`), the unit is reporting **Volts Per Cell (V/cell)**. VoltWatch scales this by 12 cells for 24V packs (`2.26 * 12 = 27.12V`).
- **Axpert Inverter 9-Token Format:**
  `[0: Grid V, 1: Grid Hz, 2: Out V, 3: Out Hz, 4: Load %, 5: Watts, 6: Battery V, 7: Temp C, 8: Status Bits]`
- The parser dynamically identifies format variants by checking if token 4 contains a decimal point (`50.0`) or is not an integer load.

### Database & Log Files:
- **Database Path:** `%APPDATA%\com.adsan.voltwatch\voltwatch.db` (never in `src-tauri/` to avoid dev reload loops).
- **Log Files:** `%LOCALAPPDATA%\com.adsan.voltwatch\logs\voltwatch.log` (rotating, powered by `tauri-plugin-log`). Logs also stream to stdout and webview console.

