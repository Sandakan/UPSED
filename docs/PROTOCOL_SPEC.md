# Voltronic UPS ASCII Serial Protocol Specification

This document provides a comprehensive technical reference for the ASCII line-oriented protocol used by **Voltronic Power** UPS and inverter systems (including Axpert, Mecer, MPP Solar, Effekta, and RCT).

---

## 📡 1. Physical & Data Link Layer

| Parameter | Specification |
|---|---|
| **Interface** | RS-232 / USB (Virtual COM Port via CP210x, FTDI, or CH340) |
| **Baud Rate** | 2400 bps (Standard legacy) or 9600 bps (Newer Axpert King/Max models) |
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
- **Example:** `(PI17\r` indicates Protocol Version 17.
- **Protocol Variants Discovered in ViewPower RE:**
  - `P00`: Basic offline/line-interactive UPS (single load, Q1 status).
  - `P02`: On-line double-conversion UPS with dual outlet control.
  - `P17` / `P31`: Advanced off-grid solar inverters (Axpert family, QPIGS support).
  - `TAURUS`: 3-phase high-capacity industrial units with Modbus mapping.

### Query Device Serial Number (`QID`)
- **Sent:** `QID\r`
- **Response:** `(<13-digit Serial Number>\r`
- **Example:** `(9293311030000\r`

### Query Firmware Version (`QVFW`)
- **Sent:** `QVFW\r`
- **Response:** `(VERFW:<Version>\r`
- **Example:** `(VERFW:00072.10\r`

---

## 📊 4. Telemetry Queries (Stage T1 Read-Only)

### Quick Status Query (`Q1`)
- **Sent:** `Q1\r`
- **Response Format:**
  ```text
  (MMM.M NNN.N PPP.P QQQ RR.R SS.S TT.T b7b6b5b4b3b2b1b0\r
  ```
- **Fields Breakdown:**
  1. `MMM.M`: Input Grid Voltage (V AC)
  2. `NNN.N`: Input Grid Frequency (Hz)
  3. `PPP.P`: Output Voltage (V AC)
  4. `QQQ`: Output Frequency (Hz)
  5. `RR.R`: Output Load Percentage (%)
  6. `SS.S`: Output Watts or Battery Voltage (V DC)
  7. `TT.T`: Battery Voltage (V DC) or Internal Temperature (°C)
  8. `b7-b0`: 8-bit Binary Status Flags:
     - Bit 7: Utility Grid Fail (`1` = On Battery, `0` = Grid Normal)
     - Bit 6: Battery Low (`1` = Warning / Low Capacity)
     - Bit 5: Bypass Active (`1` = Inverter Bypassed directly to Mains)
     - Bit 4: UPS Failed (`1` = Hardware Fault Active)
     - Bit 3: UPS Type (`1` = On-line, `0` = Standby/Offline)
     - Bit 2: Battery Test Running (`1` = Self-test in progress)
     - Bit 1: Shutdown Active (`1` = Shutdown timer running)
     - Bit 0: Buzzer Active (`1` = Audible alarm enabled)

### General Status Query (`QPIGS` - Extended Telemetry)
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
| `BUZZER\r` | Toggle Beeper | Toggles the internal audible alarm beeper on or off. | `(OK\r` |
| `T\r` | 10s Self Test | Initiates a temporary 10-second battery health discharge test. Automatically returns to AC line. | `(OK\r` |
| `CT\r` | Cancel Test | Immediately cancels any active battery discharge test. | `(OK\r` |

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

