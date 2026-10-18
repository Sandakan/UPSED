# ⚡ UPSED ESP32-S3 Hardware Bridge

The **UPSED Bridge** is an intelligent, dual-mode hardware gateway based on the **ESP32-S3** microcontroller (ESP32-S3-WROOM-1-N16R8 with 16MB Flash and 8MB Octal PSRAM). It bridges Voltronic Power and Megatec RS-232 uninterruptible power supplies (UPS) to the **UPSED Desktop Application** over high-speed USB Serial CDC and 2.4GHz IEEE 802.11 b/g/n Wi-Fi WebSocket.

---

## 📋 Features

- **Dual-Mode Operation:**
  - **Proxy Mode (Desktop Active):** Directly streams telemetry and hardware commands between UPSED and the UPS at 115,200 baud over USB or via WebSocket (`ws://upsed-bridge.local:81`).
  - **Standalone Mode (Desktop Offline):** Automatically takes over polling the UPS every 10 seconds after 15 seconds of desktop silence.
- **8MB PSRAM MessagePack Ring Buffer:** Buffers up to 8,192 offline telemetry snapshots (~22.7 hours at 10s cadence) while your PC is off or asleep, automatically syncing them into UPSED's SQLite history upon desktop reconnection.
- **Real-Time JSON-RPC 2.0 Streaming:** Asynchronously pushes diagnostic logs and hardware events (`bridge.log`) to the UPSED Live Debug Console.
- **Hardware-Enforced Protocol Guarding:**
  - 120ms inter-command UART guard delay prevents RS-232 transceiver buffer collisions.
  - Transparent 3-attempt retry with 150ms backoff for noisy 2400-baud industrial lines.
- **NVS Persistent Storage:** Saves Wi-Fi credentials securely in non-volatile flash partitions.

---

## 🔌 Hardware Pinout & Wiring

| ESP32-S3 Pin | Function | Target / Module | Notes |
|---|---|---|---|
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

| LED Color & Pattern | Operating State | Description |
|---|---|---|
| 🔵 **Blue (Pulsing)** | Boot / Associating | ESP32 initializing or attempting Wi-Fi association |
| 🟢 **Green (Solid)** | Proxy Mode | UPSED Desktop connected; real-time USB/WS proxy active |
| 🟠 **Amber / Orange (Solid)** | Standalone Mode | PC offline (>15s); autonomous 10s polling into PSRAM active |
| 🟣 **Magenta / Purple** | Wi-Fi Provisioning | 2.4GHz airwave scan or NVS write in progress |
| 🔴 **Red (Blinking)** | Error / Timeout | UPS not responding to RS-232 queries or Wi-Fi failed |

---

## 🚀 Quick Management via NPM (Recommended)

From the UPSED repository root directory, you can manage the bridge using these `npm run` scripts:

```bash
# Compile the firmware in release mode
npm run bridge:build

# Flash firmware to the connected ESP32-S3 (auto-detects COM port)
npm run bridge:upload

# Target a specific COM port when multiple devices are connected
npm run bridge:upload -- --upload-port COM3

# Open serial monitor at 115,200 baud
npm run bridge:monitor

# Clean all build artifacts
npm run bridge:clean
```

*(Note: `npm run pio:*` scripts like `npm run pio:build` and `npm run pio:upload` are also available as identical aliases).*

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

### 1. `bridge.ping` — System Health
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
      "fw": "1.0.0",
      "mac": "80:65:99:A6:B9:F8",
      "mode": "proxy",
      "wifi_connected": true,
      "ssid": "MyHomeNetwork_2.4G",
      "ip": "192.168.0.59",
      "hostname": "upsed-bridge",
      "ws_port": 81,
      "rssi": -42,
      "backlog_records": 0,
      "backlog_capacity": 8192,
      "psram_active": true,
      "psram_free": 7599327,
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

### 4. `bridge.getBacklog` & `bridge.clearBacklog` — Offline Buffer
- **Request:**
  ```json
  {"jsonrpc": "2.0", "id": 4, "method": "bridge.getBacklog", "params": {"limit": 50}}
  ```
- Drains batches of offline MessagePack telemetry records stored while PC was offline.

### 5. `ups.cmd` — Raw Hardware Passthrough
- **Request:**
  ```json
  {"jsonrpc": "2.0", "id": 5, "method": "ups.cmd", "params": {"cmd": "Q1"}}
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

### 6. `bridge.log` — Real-Time Push Notification
Unprompted notification pushed to all connected clients:
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
