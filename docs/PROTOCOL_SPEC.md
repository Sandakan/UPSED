# Voltronic UPS ASCII Serial Protocol Specification

This document provides a comprehensive technical reference for the ASCII line-oriented protocol used by **Voltronic Power** UPS and inverter systems (including Axpert, Mecer, MPP Solar, Effekta, and RCT).

---

## 📡 1. Physical & Data Link Layer

| Parameter | Specification |
|---|---|
| **Interface** | RS-232 / USB Virtual COM Port (CP210x, FTDI, CH340) OR Native USB HID (`VID 0x0665 / PID 0x5161`) |
| **USB HID Framing** | 8-byte interrupt/feature reports with Report ID `0x00` (`[0x00, byte0, ..., byte7]`), trailing bytes null-padded (`0x00`) |
| **Baud Rate (Serial)** | 2400 bps (Standard legacy) or 9600 bps (Newer Axpert King/Max models) |
| **Data Bits** | 8 |
| **Parity** | None |
| **Stop Bits** | 1 |
| **Flow Control** | None |
| **Command Framing** | ASCII string terminated with carriage return `\r` (0x0D) |
| **Response Framing** | ASCII string starting with `(` (0x28), terminated with `\r` (0x0D) |
| **Buffer Constraint** | Maximum 64 bytes per response packet |
| **Typical Timeout** | 1000 milliseconds |

---

## 📨 2. Standard Acknowledgments

| Response | Meaning |
|---|---|
| `(OK\r` | Command successfully parsed and executed by UPS firmware. |
| `(NAK\r` | Command rejected (unsupported, bad format, or rejected by current operating mode). |

---

## 🔍 3. Protocol Identification & Capabilities

### Query Protocol ID (`QPI`)
- **Sent:** `QPI\r`
- **Response:** `(PI<ID>\r`
- **Example:** `(PI01\r` indicates Protocol Version 01; `(PI17\r` indicates Protocol Version 17.
- **Protocol Variants:**
  - `P00`: Basic offline/line-interactive UPS (Megatec standard, Q1 status).
  - `P01`: On-line double-conversion UPS (Prolink PRO901-ES / Voltronic Online, Q1 and QGS telemetry).
  - `P02`: On-line double-conversion UPS with dual outlet control.
  - `P17` / `P30` / `P31`: Advanced off-grid solar inverters (Axpert family, QPIGS support).
  - `TAURUS`: 3-phase high-capacity industrial units with Modbus mapping.

### Query Device Serial Number (`QID`)
- **Sent:** `QID\r`
- **Response:** `(<13-digit Serial Number>\r`
- **Example:** `(9293311030000\r`

### Query Firmware Version (`QVFW`)
- **Sent:** `QVFW\r`
- **Response:** `(VERFW:<Version>\r`
- **Example:** `(VERFW:04681.02\r`

---

## 📊 4. Telemetry Queries (Stage T1 Read-Only)

### Quick Status Query (`Q1`)
- **Sent:** `Q1\r`
- **Standard Megatec 8-Token Format:**
  ```text
  (MMM.M NNN.N PPP.P QQQ RR.R S.SS TT.T b7b6b5b4b3b2b1b0\r
  ```
- **Example:** `(231.4 231.5 229.7 021 50.0 2.26 29.3 00000001\r`
- **Fields Breakdown:**
  1. `MMM.M`: Input Grid Voltage (V AC)
  2. `NNN.N`: Input Fault Voltage (V AC)
  3. `PPP.P`: Output Voltage (V AC)
  4. `QQQ`: Output Load Percentage (`000`–`150`%)
  5. `RR.R`: Output Frequency (Hz, e.g. `50.0`)
  6. `S.SS` / `SS.S`: Battery Voltage (V DC) or Volts Per Cell (V/cell). If `< 4.0V` (e.g. `2.26`), it is scaled by 12 cells for a nominal 24V pack (`2.26 * 12 = 27.12V`).
  7. `TT.T`: Internal Inverter / Heatsink Temperature (°C)
  8. `b7-b0`: 8-bit Binary Status Flags:
     - Bit 7: Utility Grid Fail (`1` = On Battery, `0` = Grid Normal)
     - Bit 6: Battery Low (`1` = Warning / Low Capacity)
     - Bit 5: Bypass Active (`1` = Inverter Bypassed directly to Mains)
     - Bit 4: UPS Failed (`1` = Hardware Fault Active)
     - Bit 3: UPS Type (`1` = On-line, `0` = Standby/Offline)
     - Bit 2: Battery Test Running (`1` = Self-test in progress)
     - Bit 1: Shutdown Active (`1` = Shutdown timer running)
     - Bit 0: Buzzer Active (`1` = Audible alarm enabled)

- **Axpert Inverter 9-Token Format:**
  ```text
  (grid_v grid_f out_v out_f out_load out_watts bat_v temp status_bits\r
  ```
  Example: `(238.0 50.0 238.0 50.0 023 0230 025.4 45 00110000\r`

### General Status Query for Online UPS (`QGS`)
- **Sent:** `QGS\r`
- **Response Format:**
  ```text
  (grid_v grid_hz out_v out_hz out_current load_% pos_bus neg_bus bat_v chg_current temp status_bits\r
  ```
- **Example:** `(231.6 50.0 229.7 50.0 000.9 020 370.7 373.3 027.2 ---.- 029.3 100000000001\r`

### General Status Query for Solar Inverters (`QPIGS`)
- **Sent:** `QPIGS\r`
- **Response Format (Space-delimited values):**
  ```text
  (Grid_V Grid_Hz Out_V Out_Hz Out_VA Out_W Load_% Bus_V Bat_V Bat_Chg_A Bat_Cap_% Heatsink_Temp\r
  ```
- **Example:**
  ```text
  (238.0 50.0 238.0 50.0 0230 0230 023 380 25.4 010 085 0045\r
  ```

### Warning Status Query (`QPIWS`)
- **Sent:** `QPIWS\r`
- **Response Format:** A string of up to 40 binary character flags `(0000000000000000...\r`
- **Key Bit Positions:**
  - Bit 0: Inverter fault
  - Bit 1: Bus over voltage
  - Bit 2: Bus under voltage
  - Bit 4: AC line fail
  - Bit 8: Over temperature
  - Bit 11: Battery low warning
  - Bit 13: Overload warning

### Rating Information (`QPIRI`)
- **Sent:** `QPIRI\r`
- **Response Format:**
  ```text
  (Rated_Grid_V Rated_Grid_A Rated_Out_V Rated_Out_Hz Rated_Out_A Rated_Out_VA Rated_Out_W Rated_Bat_V Max_Chg_A\r
  ```

---

## ⚙️ 5. Diagnostic Commands (Stage T2 Non-Destructive)

| Command | Action | Description | Expected Response |
|---|---|---|---|
| `Q\r` | Toggle Beeper | Toggles the internal audible alarm beeper on or off (standard Megatec/Voltronic protocol). | `(OK\r` or silent ack |
| `T\r` | 10s Self Test | Initiates a temporary 10-second battery health discharge test. Automatically returns to AC line. | `(OK\r` |
| `T<n>\r` | Timed Self Test | Initiates a battery discharge test for n minutes (1–99 mins, e.g. `T05\r`). | `(OK\r` |
| `CT\r` | Cancel Test | Immediately cancels any active battery discharge test. | `(OK\r` or silent ack |

---

## 🔧 6. Configuration Write Commands (Stage T3 Config Write)

| Command | Syntax | Range | Description | Expected Response |
|---|---|---|---|---|
| **Max Charge Current** | `MCHGC<AAAA>\r` | 10A - 80A (4-digit padded, e.g. `MCHGC0020`) | Sets total utility + solar charging current limit. | `(OK\r` / `(NAK\r` |
| **Bypass High Limit** | `PBVH<VVV>\r` | 240V - 270V (3-digit, e.g. `PBVH260`) | Upper voltage tolerance before disengaging bypass. | `(OK\r` / `(NAK\r` |
| **Bypass Low Limit** | `PBVL<VVV>\r` | 170V - 220V (3-digit, e.g. `PBVL190`) | Lower voltage tolerance for bypass engagement. | `(OK\r` / `(NAK\r` |
| **Battery Cutoff** | `PSDV<VV.V>\r` | 20.0V - 54.0V (e.g. `PSDV21.0`) | Low battery shutdown threshold. Must never drop below cell safety floors. | `(OK\r` / `(NAK\r` |

---

## ⚠️ 7. Power Control Commands (Stage T4 Power Control)

| Command | Syntax | Description | Expected Response |
|---|---|---|---|
| **Delayed Shutdown** | `S.<M>\r` or `S<M.M>\r` | Initiates delayed shutdown. Minimum allowed floor: 0.1 minutes (~6 seconds). E.g. `S.3\r` (~18s). | `(OK\r` |
| **Cancel Shutdown** | `CS\r` | Immediately aborts any pending shutdown countdown timer. | `(OK\r` |
| **Outlet Group On** | `OLON<G>,<D>\r` | Powers on outlet group `G` (1-3) after delay `D` (minutes). | `(OK\r` |
| **Outlet Group Off** | `OLOFF<G>,<D>\r` | Powers off outlet group `G` (1-3) after delay `D` (minutes). | `(OK\r` |

