# ⚡ UPSED ESP32-S3 Hardware Bridge

The **UPSED Bridge** is an intelligent, dual-mode hardware gateway based on the **ESP32-S3** microcontroller (ESP32-S3-WROOM-1-N16R8 with 16MB Flash and 8MB Octal PSRAM). It bridges Voltronic Power and Megatec RS-232 uninterruptible power supplies (UPS) to the **UPSED Desktop Application** over high-speed USB Serial CDC and 2.4GHz IEEE 802.11 b/g/n Wi-Fi WebSocket.

---

## 📋 Features

- **Dual-Mode Operation:**
  - **Proxy Mode (Desktop Active):** Directly streams telemetry and hardware commands between UPSED and the UPS at 115,200 baud over USB or via WebSocket (`ws://upsed-bridge.local:81`), supporting up to 8 concurrent WebSocket clients.
  - **Standalone Mode (Desktop Offline):** Automatically takes over polling the UPS every 10 seconds after 15 seconds of desktop silence.
- **Autonomous Master Polling & Turbo Mode:** Polls the UPS every 5 seconds in idle (`BRIDGE_IDLE_POLL_MS`, 6.5s cache TTL) and automatically accelerates to 2-second turbo polling (`BRIDGE_TURBO_POLL_MS`, 2.2s cache TTL) during urgent conditions (`utility_fail`, `battery_low`, `test_in_progress`, or faults).
- **Continuous Flight-Recorder Ring Buffer (PSRAM / SRAM Auto-Sizing):** Continuously records `Q1` telemetry in both Proxy and Standalone modes with monotonic `seq` numbers and non-destructive `since_ts` / `since_seq` queries:
  - **8MB PSRAM (ESP32-S3):** Auto-sizes up to **32,768 records** (~45.5 hours at 5s idle / ~91 hours at 10s standalone).
  - **2MB–4MB PSRAM:** Scales proportionally between 8,192 and 16,384 records.
  - **Non-PSRAM Chips:** Safely falls back to 256–512 slots in internal SRAM.
- **TuyaLink Cloud MQTT Integration:** Publishes 19-DP telemetry snapshots over TLS with exponential backoff, explicit DNS verification, and centralized multi-server NTP clock synchronization.
- **Autonomous LED Illumination Policy:** Supports scheduled Night Mode dimming/off (`bridge.setIllumination`), Desktop Proxy Stealth Mode (dimming/extinguishing the LED while the desktop app is active), and automatic Critical Alert Wakeup during power outages or inverter faults.
- **Real-Time JSON-RPC 2.0 Streaming:** Asynchronously pushes diagnostic logs (`bridge.log`), state transitions (`bridge.stateChanged`), status updates (`bridge.statusChanged`), and command audits (`bridge.cmdExecuted`).
- **Hardware-Enforced Protocol Guarding:**
  - 150ms inter-command UART guard delay prevents RS-232 transceiver buffer collisions.
  - 1400ms read timeout accommodates 2400-baud UPS microcontroller ADC sampling.
  - Transparent 3-attempt retry with 150ms backoff for noisy 2400-baud industrial lines.
- **NVS Persistent Storage:** Saves Wi-Fi credentials, TuyaLink configuration, illumination policy, and runtime settings securely in non-volatile flash partitions.

---

## 🔌 Hardware Pinout & Wiring

| ESP32-S3 Pin | Function | Target / Module | Notes |
| --- | --- | --- | --- |
| **USB-C Port** | USB CDC Serial (UART0) | Host PC / UPSED | 115,200 Baud |
| **GPIO 17** | `UPS_RX_PIN` (UART1 RX) | MAX3232 Transceiver `R1OUT` | Connected to UPS DB9/RJ45 Pin 2 (TX) |
| **GPIO 18** | `UPS_TX_PIN` (UART1 TX) | MAX3232 Transceiver `T1IN` | Connected to UPS DB9/RJ45 Pin 3 (RX) |
| **GND** | Ground Reference | MAX3232 `GND` & UPS `GND` | Common ground required |
| **3V3 / 5V** | Logic Power | MAX3232 `VCC` | 3.3V recommended for level shifter |
| **GPIO 48 / 38** | WS2812 RGB LED | Onboard Status Indicator | Primary GPIO 48, Alt GPIO 38 |

> [!CAUTION]
> **RS-232 Voltage Warning:** Never connect ESP32 GPIO pins directly to the UPS serial port! A UPS serial port operates at true RS-232 levels ($\pm12\text{V}$). Always use a **MAX3232** or **SP3232** 3.3V transceiver to convert RS-232 levels to 3.3V TTL.

---

## 🚦 WS2812 RGB LED Status Indicator Guide

The ESP32-S3 firmware drives an onboard addressable WS2812 RGB LED (primary GPIO 48, secondary GPIO 38) using a non-blocking, priority-ranked state engine running at ~60 Hz. The table below lists operating modes in descending priority order:

| Priority | LED Pattern & Color | Operating State | Trigger Condition & Description |
| :---: | :--- | :--- | :--- |
| **P1A** | 🟣 **Blinking Magenta** (200ms ON / 200ms OFF) | **OTA Authentication / Staged Lease** | `ArduinoOTA` UDP invite received / PBKDF2 authentication in flight on port 3232, or 90-second HTTP OTA lease active on port 8080. |
| **P1B** | 🟣 **Pulsing Magenta** (800ms breathing wave) | **Active Firmware Streaming** | Active firmware binary chunk transmission and flash write in progress over Wi-Fi (`espota` port 3232 or HTTP port 8080). Refreshes on each chunk. |
| **P1C** | 🟢 **Solid Green Flash** (250ms) | **OTA Flashing Complete** | Firmware committed cleanly to flash partition without checksum errors. Bridge rebooting into new firmware. |
| **P2** | 🔴 **Pulsing Alert Red** (700ms pulse) | **AC Power Outage · On Battery** | **CRITICAL:** Utility Fail bit active (`Q1` / `QPIGS`). Mains power lost and UPS inverter supplying load from battery. |
| **P3** | 🔴 **Fast Double-Blink Red** (1.2s cycle) | **Wi-Fi Auth Error (`AUTH_FAIL`)** | Incorrect Wi-Fi credentials or AP association rejected (Reason 202). Check network credentials. |
| **P3** | 🟠 **Slow Blinking Amber** (1s cycle: 500ms ON / 500ms OFF) | **Wi-Fi Disconnected** | Wi-Fi association lost. Device performing automatic reconnection retries every 30 seconds. |
| **P3** | 🟠 **Pulsing Amber** (900ms pulse) | **Wi-Fi Associating / Booting** | Actively associating with configured 2.4GHz Wi-Fi AP and requesting DHCP IP assignment. |
| **P4** | 🔵 **Momentary Blue Flash** (60ms tick) | **Serial Bus Activity** | Dispatched during `MODE_PROXY` whenever a serial query or command is executed against the UPS. |
| **P4** | 🟢 **Momentary Mint/White Flash** (80ms tick) | **Tuya Telemetry Published** | Rendered each time a 19-DP telemetry snapshot report is successfully delivered to TuyaLink MQTT. |
| **P4** | 🟣 **Periodic Violet Pulse** (450ms every 3s) | **Tuya Connecting / Syncing** | Overlaid on base mode while acquiring NTP time, resolving broker DNS, or establishing TLS handshake. |
| **P4** | 🟠 **Periodic Orange Double-Blink** (every 3s) | **Tuya Fault / Auth Error** | Overlaid on base mode when TuyaLink connection drops or credentials rejected (`rc=4`/`rc=5`). Reconnecting with exponential backoff. |
| **P5** | 🟢 **Solid Green** | **Proxy Mode (Normal)** | Fully operational. AC grid healthy, UPS RS-232 communicating, UPSED desktop connected via WebSocket / USB CDC. |
| **P5** | 🟡 **Pulsing Yellow** (1.5s pulse) | **Proxy Mode · UPS Offline / NAK** | Desktop connected, but UPS RS-232 cable disconnected or UPS returning `NAK`. |
| **P6** | 🔷 **Breathing Cyan** (2.4s pulse) | **Standalone Logging Mode** | UPSED desktop offline (>15s silence). Bridge autonomously buffering telemetry snapshots to 8MB PSRAM ring buffer. |
| **P6** | 🟡 **Slow Amber/Yellow Pulse** (1.8s pulse) | **Standalone · UPS Offline / NAK** | Desktop offline AND UPS RS-232 cable disconnected or returning `NAK`. |

---

## 🔑 Environment Configuration (`.env`)

Wireless OTA firmware updates and PlatformIO builds require an authentication secret configured in the root `.env` file:

```bash
# Copy template from example
cp .env.example .env
```

Ensure `UPSED_OTA_SECRET` is set in your `.env`:

```env
UPSED_OTA_SECRET="ChangeThisToAStrongSecretKey123!"
```

> [!IMPORTANT]
> The build script (`scripts/pio.js`) and Tauri desktop backend enforce that `UPSED_OTA_SECRET` is strictly present. If `.env` or the secret is missing, builds and OTA operations halt with an actionable error. Never commit your `.env` file to version control.

---

## 🚀 Quick Management via NPM (Recommended)

From the UPSED repository root directory, you can manage and flash the bridge using these `npm run` scripts:

```bash
# Compile the firmware in release mode
npm run bridge:build

# Flash firmware via USB Serial CDC (auto-detects COM port)
npm run bridge:upload

# Target a specific COM port when multiple devices are connected
npm run bridge:upload -- --upload-port COM3

# Flash firmware wirelessly over Wi-Fi (PlatformIO espota via mDNS or IP)
npm run bridge:ota

# Target a specific IP address for wireless OTA flashing
npm run bridge:ota -- --upload-port 192.168.0.59

# Open serial monitor at 115,200 baud
npm run bridge:monitor

# Clean all build artifacts
npm run bridge:clean
```

*(Note: `npm run pio:*` scripts like `npm run pio:build`, `npm run pio:upload`, and `npm run pio:ota` are also available as identical aliases).*

---

## 📶 In-App Wireless Desktop OTA

You can also update the ESP32-S3 firmware directly from the **UPSED Desktop Application**:

1. Open UPSED and navigate to the **ESP32 Bridge (IoT)** tab.
2. Click on the **Firmware & OTA** sub-tab.
3. Select your desired firmware source:
   - **Official GitHub Release:** Downloads and flashes the latest verified release from `Sandakan/UPSED`.
   - **Local PlatformIO Build:** Uses your locally compiled `firmware.bin` from `npm run bridge:build`.
   - **Custom Binary File:** Select any custom `.bin` image from your disk.
4. Click **Flash Firmware Wirelessly**.
5. The application requests a secure 90-second lease from the bridge, streams the binary over HTTP port 8080 with byte-level progress reporting, and the ESP32 automatically reboots into the new partition.

---

## 🛠️ Direct PlatformIO CLI Commands

If you prefer running commands directly within the `upsed-bridge/` directory:

### 1. Build & Compilation

```bash
# Navigate to the bridge directory
cd upsed-bridge

# Build firmware in release mode
pio run

# Build verbose (outputs full compiler flags and line traces)
pio run -v
```

### 2. Flashing & Uploading

```bash
# Upload to automatically detected serial port
pio run -t upload

# Upload targeting a specific port and speed
pio run -t upload --upload-port COM3 --upload-speed 921600
```

### 3. Serial Monitoring

```bash
# Monitor UART0 output at 115200 baud
pio device monitor -b 115200

# Monitor with custom COM port
pio device monitor -b 115200 --port COM3

# Monitor with timestamp filter
pio device monitor -b 115200 --filter time
```

### 4. Combined Upload & Monitor

```bash
# Build, upload, and immediately open serial monitor in one command
pio run -t upload -t monitor
```

---

## 🗄️ Managing Flash, NVS & Device Partitions

### 1. Listing Connected Serial Devices

To see all connected COM ports and USB serial chips (CH340, CP2102, ESP-USB-JTAG):

```bash
pio device list
```

### 2. Full Flash Erase (Factory Reset)

To wipe all NVS partitions (clearing saved Wi-Fi credentials, IP configurations, and PSRAM backlog):

```bash
# Via PlatformIO
pio run -t erase

# Or directly via esptool.py
esptool.py --port COM3 erase_flash
```

### 3. Entering ROM Bootloader Mode (Recovery)

If the board does not auto-reset or is caught in a boot loop:

1. Press and **hold** the **BOOT** button (GPIO 0).
2. Tap and release the **RST** (or **EN**) button.
3. Release the **BOOT** button.
4. The ESP32-S3 is now in ROM Download Bootloader mode (`waiting for download`).
5. Run `npm run bridge:upload`.
6. Tap the **RST** button to reboot into normal execution.

---

## 📡 JSON-RPC 2.0 API Reference

The bridge listens on USB CDC Serial (`115200 8N1`, newline-delimited JSON) and WebSocket (`ws://0.0.0.0:81`).

### 1. `bridge.ping` / `bridge.getStatus` — System Health & Backlog Bounds

- **Request:**

  ```json
  {"jsonrpc": "2.0", "id": 1, "method": "bridge.ping", "params": {}}
  ```

- **Response:**

  ```json
  {
    "jsonrpc": "2.0",
    "id": 1,
    "result": {
      "bridge": "UPSED_BRIDGE_V1",
      "fw": "1.6.0",
      "mac": "80:65:99:A6:B9:F8",
      "mode": "proxy",
      "wifi_connected": true,
      "ssid": "MyHomeNetwork_2.4G",
      "ip": "192.168.0.59",
      "hostname": "upsed-bridge",
      "ws_port": 81,
      "rssi": -42,
      "backlog_records": 0,
      "backlog_capacity": 32768,
      "backlog_oldest_ts": 1730352000,
      "backlog_newest_ts": 1730355600,
      "backlog_latest_seq": 420,
      "psram_active": true,
      "psram_free": 4899327,
      "uptime_sec": 1420
    }
  }
  ```

### 2. `bridge.setWifi` — NVS Provisioning

- **Request:**

  ```json
  {"jsonrpc": "2.0", "id": 2, "method": "bridge.setWifi", "params": {"ssid": "MyHome_2.4G", "pass": "SecretKey123"}}
  ```

- Saves credentials to NVS flash and initiates association.

### 3. `bridge.scanWifi` — 2.4GHz Airwave Probe

- **Request:**

  ```json
  {"jsonrpc": "2.0", "id": 3, "method": "bridge.scanWifi", "params": {}}
  ```

- Returns detected SSIDs, RSSI dBm values, and open/WPA2 flags.

### 4. `bridge.getBacklog` / `bridge.getTelemetryHistory` & `bridge.clearBacklog` — Flight-Recorder Buffer

- **Request:**

  ```json
  {"jsonrpc": "2.0", "id": 4, "method": "bridge.getTelemetryHistory", "params": {"since_ts": 1730352000, "since_seq": 100, "limit": 50}}
  ```

- Non-destructively queries MessagePack telemetry records using `since_ts` (UNIX epoch seconds) or `since_seq` (monotonic sequence number) without wiping the ring buffer. Use `bridge.clearBacklog` to explicitly reset the buffer.

### 5. `ups.cmd` — UPS Hardware Command (Cached / Live)

- **Request:**

  ```json
  {"jsonrpc": "2.0", "id": 5, "method": "ups.cmd", "params": {"cmd": "Q1", "force_refresh": false}}
  ```

- **Response:**

  ```json
  {
    "jsonrpc": "2.0",
    "id": 5,
    "result": {
      "raw": "(227.8 227.7 230.3 020 50.1 2.25 31.6 00000001",
      "ms": 42,
      "ip": "192.168.0.59"
    }
  }
  ```

### 6. `bridge.startOta` — On-Demand Leased Wireless OTA Mode

- **Request:**

  ```json
  {"jsonrpc": "2.0", "id": 6, "method": "bridge.startOta", "params": {"token": "YourOtaSecret123!"}}
  ```

- **Response:**

  ```json
  {
    "jsonrpc": "2.0",
    "id": 6,
    "result": {
      "status": "OTA_READY",
      "port": 8080,
      "lease_ms": 90000,
      "ip": "192.168.0.59"
    }
  }
  ```

- **Description:** Opens HTTP server on port 8080 and PlatformIO `ArduinoOTA` listener on port 3232 for 90 seconds. Suspends RS-232 telemetry and switches LED to pulsing Magenta.

### 7. `bridge.abortOta` — Cancel Leased OTA Mode

- **Request:**

  ```json
  {"jsonrpc": "2.0", "id": 7, "method": "bridge.abortOta", "params": {}}
  ```

- **Description:** Immediately terminates the HTTP server and ArduinoOTA listeners, releasing the lease and returning to normal mode.

### 8. `bridge.syncTime` & `bridge.clearCache` — Clock & Cache Maintenance

- `bridge.syncTime`: Synchronizes the bridge's local RTC (`epoch` UNIX timestamp) from the desktop host.
- `bridge.clearCache`: Clears the bridge's in-memory UPS command/telemetry response cache.

### 9. TuyaLink Cloud RPCs (`bridge.getTuyaConfig`, `bridge.setTuyaConfig`, `bridge.testTuyaPublish`, `bridge.reconnectTuya`)

- Manage TuyaLink MQTT credentials (`product_id`, `device_id`, `device_secret`, `region`), trigger a test 19-DP publish (`bridge.testTuyaPublish`), or force an immediate reconnection (`bridge.reconnectTuya`).

### 10. Illumination Policy RPCs (`bridge.setIllumination`, `bridge.toggleNightModeNow`)

- Configure autonomous Night Mode schedules, dimming percentages, Proxy Stealth Mode, and Critical Alert Wakeup (`bridge.setIllumination`), or immediately toggle Night Mode (`bridge.toggleNightModeNow`).

### 11. Real-Time Push Notifications (`bridge.log`, `bridge.stateChanged`, `bridge.statusChanged`, `bridge.cmdExecuted`)

Unprompted JSON-RPC notifications pushed to all connected clients:

- `bridge.log`: Firmware diagnostic log stream (`seq`, `ms`, `level`, `msg`).
- `bridge.stateChanged`: Immediate edge-transition alert when UPS state bits change (`utility_fail`, `battery_low`, `test_in_progress`, `ups_failed`).
- `bridge.statusChanged`: Bridge operational/Tuya/mode status updates.
- `bridge.cmdExecuted`: Broadcasts executed `ups.cmd` results across connected clients.

```json
{
  "jsonrpc": "2.0",
  "method": "bridge.log",
  "params": {
    "seq": 14,
    "ms": 32150,
    "level": "INFO",
    "msg": "[MODE] Switched to PROXY mode (desktop contact)"
  }
}
```

---

## 🔍 Troubleshooting

- **Access is Denied (OS error 5):** UPSED or another serial terminal (e.g. PuTTY or Arduino IDE) currently holds COM port locked. Close other terminal programs before uploading.
- **Wi-Fi Association `AUTH_FAIL` (Reason code 202):** The Wi-Fi password entered in UPSED is incorrect. Verify the passphrase and re-save.
- **ESP32-S3 Disconnects from Wi-Fi:** Ensure your Wi-Fi router broadcasts a dedicated **2.4GHz** SSID. The ESP32-S3 hardware does not support 5GHz frequencies.
- **NAK Storm on UPS Commands:** Ensure MAX3232 TX/RX lines are connected to pins 17/18 and the baud rate is set to `2400` in `config.h`.
