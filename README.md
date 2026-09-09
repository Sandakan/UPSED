# 🛡️ VoltWatch — Cross-Platform Voltronic UPS Manager

VoltWatch is a modern, high-performance, native desktop application for monitoring and configuring **Voltronic Power** uninterruptible power supplies (UPS) and rebranded hardware (e.g., Axpert, Mecer, MPP Solar, Effekta, RCT).

Built with **Tauri v2**, **Rust**, **React 19**, and **Tailwind CSS v4**, VoltWatch is an independent, clean-room reimplementation designed to replace the legacy Java/Struts2/Tomcat ViewPower stack. It talks directly to your UPS over USB/Serial with zero embedded web servers, zero RMI ports, and a strict **Safety Command Gate** to protect hardware firmware.

---

## ✨ Features

- ⚡ **Direct Hardware Communication:** Connects straight to serial/USB ports (`System.IO.Ports` / `serialport` crate) without Tomcat, Struts2, RMI, or background UDP ports.
- 🛡️ **Safety-First Command Gate:** Incremental 4-stage safety unlock (T1 Read-Only → T2 Non-Destructive → T3 Config Writes → T4 Power Control) preventing accidental firmware corruption or unintended power drop.
- 🔌 **Multi-UPS Support & Auto-Discovery:** Automatically scans COM ports and USB serial interfaces safely using non-destructive, read-only queries (`QPI`). Manages multiple connected UPS devices concurrently.
- 📊 **Real-Time Telemetry & Charts:** Monitors grid input voltage/frequency, output load & watts, battery bank voltage & capacity gauge, and internal inverter temperatures with responsive charts.
- 💾 **Local Embedded SQLite Database:** Automatically logs telemetry (default: every 30 seconds, configurable) and system events locally with instant CSV export.
- 🔋 **OS Native Battery Bridge (Opt-In, Disabled by Default):**
  - **Windows:** Custom system tray battery fill indicator & tooltips.
  - **Linux:** Virtual HID via `/dev/uhid` recognized by UPower for native GNOME/KDE desktop battery widgets.
  - **macOS:** Native menu bar power source integration via `IOPMLib`.
- ⚖️ **Clean-Room Legal Compliance:** Developed in full accordance with **DMCA §1201(f)** and **EU Directive 2009/24/EC Article 6** interoperability exemptions.

---

## 🏛️ Architecture: ViewPower vs. VoltWatch

```
LEGACY (ViewPower):
Browser ──► Tomcat (HTTP) ──► Struts2 ──► Java RMI (51099) ──► UDP Daemon (51222) ──► Serial ──► UPS
[Exposed to S2-045, Fastjson CVEs, unauthenticated RMI, IP spoofing via X-Forwarded-For]

VOLTWATCH:
React 19 UI ──► Tauri IPC (Type-Safe) ──► CommandGate ──► Native SerialPort (Direct) ──► UPS
[Zero web exposure, in-process execution, typed command enums, no arbitrary command injection]
```

---

## 🛡️ Safety Command Gate: Incremental Unlock

To safeguard connected equipment and prevent persistent EEPROM corruption, VoltWatch categorizes commands into 4 strict stages:

| Stage | Risk Level | Allowed Commands | Unlock Condition |
|---|---|---|---|
| **Stage T1 (Read-Only)** | None | `QPI` (Protocol ID), `Q1` (Quick Status), `QPIGS` (General Status), `QPIWS` (Warnings), `QPIRI` (Ratings), `QID` (Serial No.), `QVFW` (Firmware Ver.) | Default at startup |
| **Stage T2 (Non-Destructive)** | Low | `BUZZER` (Toggle alarm beeper), `T` (10s test), `CT` (Cancel test) | Unlocks after automated T1 tests pass |
| **Stage T3 (Config Writes)** | Medium | `MCHGC` (Charge current), `PBVH`/`PBVL` (Bypass window), `PSDV` (Battery cutoff voltage) | Unlocks with parameter range check |
| **Stage T4 (Power Control)** | High | `S.3` (Delayed shutdown), `CS` (Cancel shutdown), `OLON`/`OLOFF` (Outlet group control) | Requires explicit user confirmation dialogs |

---

## 🚀 Getting Started

### Prerequisites

Ensure the following are installed:
- **Node.js:** v18+ (v20+ recommended) and `npm`
- **Rust:** 1.77+ (`rustup` with MSVC on Windows, GCC/Clang on Linux/macOS)
- **C++ Build Tools:**
  - *Windows:* Visual Studio C++ Build Tools
  - *Linux:* `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`, `libssl-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`
  - *macOS:* Xcode Command Line Tools

### Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/neurodivergent-dev/VoltWatch.git
   cd VoltWatch
   ```

2. **Install frontend dependencies:**
   ```bash
   npm install
   ```

3. **Run the 45-test verification suite (Cargo):**
   ```bash
   cd src-tauri
   cargo test
   cd ..
   ```
   *All 45 tests across protocol parsers, command gates, and multi-port handlers must pass before launching.*

4. **Start in Development Mode:**
   ```bash
   npm run tauri dev
   ```

5. **Build for Production:**
   ```bash
   npm run tauri build
   ```

---

## 📖 Usage Guide

### 1. Connecting to a UPS
1. Connect your Voltronic or compatible UPS to your computer via USB (virtual COM port) or RS-232 serial cable.
2. Launch VoltWatch.
3. Click the **Scan (Search)** button in the top left of the sidebar under **Connected Devices**.
4. VoltWatch safely probes all serial ports using read-only `QPI\r` queries.
5. Detected UPS devices will appear in the sidebar with their detected protocol variant (e.g. `P17`, `P02`, `P00`). Click any port to monitor it.

### 2. Live Monitoring (Dashboard)
- **Grid AC Input:** Live input voltage and line frequency with utility failure alarm detection.
- **Output Load:** Percentage load, real wattage calculation, and dynamic color-coded load bars.
- **Battery Bank:** Real-time DC bus voltage, estimated percentage gauge, and low-voltage alarms.
- **Inverter Thermals:** Internal heatsink operating temperatures.
- **Live Waveform Charts:** Recharts time-series graph tracking voltage and load fluctuations.

### 3. Diagnostics & Hardware Control
- Switch to the **Hardware Control** tab.
- **Toggle Buzzer:** Mute or unmute the internal UPS beeper (`BUZZER`).
- **10-Second Self Test:** Run a brief battery discharge diagnostic (`T`).
- **Emergency Shutdown:** Located under Stage T4 with dual-confirmation countdown dialogs to prevent accidental outages.

### 4. Adjusting Configurations (Stage T3)
- Navigate to the **Configuration** tab.
- Safely update charging parameters such as maximum solar/utility charging current (`MCHGC`) or bypass voltage tolerances (`PBVH`/`PBVL`).
- Values outside safe physical ranges (e.g. charge currents exceeding device ratings or battery cutoffs below cell safety floors) are rejected before being transmitted.

### 5. Historical Telemetry & CSV Export
- Go to the **History & Events** tab.
- Inspect timestamped records of voltage, load, and battery metrics stored in SQLite.
- Review system events (connections, disconnects, utility failures).
- Click **Export CSV** to download tabular data for external analysis or graphing in Excel/Grafana.

### 6. Application Settings
- **Telemetry Polling Interval:** Switch between 5s, 10s, 30s (default), or 60s polling intervals.
- **OS Native Battery Bridge:** Toggle off/on to emulate a laptop battery for your desktop operating system.

---

## 🧪 Testing Strategy

VoltWatch includes an extensive mock-hardware test suite in `src-tauri/tests/`:
- `stage_t1_tests.rs`: Validates Q1, QPIGS, QPIWS, QID, QVFW, QPIRI parsing, timeout handling, and read-only gating.
- `stage_t2_tests.rs`: Tests buzzer toggle and 10s battery test commands and gate enforcement.
- `stage_t3_tests.rs`: Tests parameter validation (charge current, voltage windows, battery floors).
- `stage_t4_tests.rs`: Tests shutdown and outlet delay validation.
- `security_and_gate_tests.rs`: Verifies that no arbitrary raw string commands can be passed and stages cannot be bypassed.
- `concurrency_tests.rs`: Verifies multi-port isolation and independent polling.
- `battery_bridge_tests.rs`: Confirms that the OS battery bridge remains strictly disabled by default.

Run all tests:
```bash
cd src-tauri
cargo test -- --nocapture
```

---

## ⚖️ Legal & Fair Use Notice

This software is an independent clean-room engineering effort created for **interoperability purposes** under:
- **United States Code:** 17 U.S.C. § 1201(f) (Reverse Engineering / Interoperability exemption of the DMCA).
- **European Union:** Directive 2009/24/EC, Article 6 (Decompilation for Interoperability).

VoltWatch contains **no copyrighted binaries, proprietary Java bytecode, or graphic assets** from Voltronic Power Technology Corp. or its software ViewPower. Voltronic ASCII serial communication is a publicly documented industrial standard supported by open-source systems such as Network UPS Tools (NUT).

---

## 📄 License

Licensed under the MIT License. See [LICENSE](./LICENSE) for details.
