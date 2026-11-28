# Automatic Updates & Release Signing Setup

> Back to [README](../README.md)

UPSED uses **two independent release streams** in `Sandakan/UPSED`:
1. **Desktop App (`v*` tags via `.github/workflows/release.yml`):** Signed Tauri v2 updates (`latest.json` + `.sig` signatures) marked as the repository's `Latest` release.
2. **ESP32-S3 Bridge Firmware (`bridge-v*` tags via `.github/workflows/release-bridge.yml`):** Independent firmware releases (`upsed-bridge-firmware.bin` + `bridge-manifest.json`) published with `--latest=false` so they never shadow `releases/latest/download/latest.json`.

---

## How In-App Updates Work

### Desktop Application (`tauri-plugin-updater` + `tauri-plugin-process`)
1. **Startup & Manual Checks:** `useAppUpdater` ([src/lib/updater.ts](../src/lib/updater.ts)) checks `https://github.com/Sandakan/UPSED/releases/latest/download/latest.json` 3 seconds after launch and on-demand via **About → Check for Updates**.
2. **Cryptographic Verification:** `tauri-plugin-updater` verifies the downloaded update's `.sig` signature against the public key (`plugins.updater.pubkey`) embedded in [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json).
3. **Guided Install & Relaunch:** When an update is available, `AppUpdateBanner` displays a non-intrusive bar with download progress and an **Update & Restart** button that installs the update and relaunches the app.

### ESP32-S3 Bridge Firmware (`bridge-v*` + Physical `BOOT` Approval)
1. **Version Discovery:** `check_bridge_firmware_update` queries `git/matching-refs/tags/bridge-v` (falling back to `releases/latest` for legacy combined releases) and reads `bridge-manifest.json` (`version`, `board`, `size`, `sha256`).
2. **SHA-256 Verification:** `flash_bridge_firmware` verifies the downloaded `.bin` against `bridge.sha256` before initiating the OTA lease.
3. **Passwordless Ephemeral OTA Lease:** Over Wi-Fi, the ESP32 enters `MODE_OTA_PENDING` (30s blinking magenta window) until the user presses the physical `BOOT` button (`GPIO 0`), which generates a 128-bit one-time ephemeral token (`esp_random()`) and opens HTTP port `8080` for 90s. Over USB Serial, the lease is approved immediately. No `.env` or static `UPSED_OTA_SECRET` is required.

---

## Signing Key & CI Setup

### 1. Generate a Tauri Signing Keypair

```bash
npm run tauri signer generate -- -w ~/.tauri/upsed.key
```

This creates a private key (`~/.tauri/upsed.key`) and a public key (`~/.tauri/upsed.key.pub`).

### 2. Configure the Public Key (`src-tauri/tauri.conf.json`)

- Copy the single-line contents of `~/.tauri/upsed.key.pub` into `plugins.updater.pubkey` in [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json) *(safe to commit)*.
- Keep `bundle.createUpdaterArtifacts` set to `true` and `plugins.updater.endpoints` pointing to:
  `https://github.com/Sandakan/UPSED/releases/latest/download/latest.json`

### 3. Configure GitHub Actions Secrets

Add the following secrets under **Settings → Secrets and variables → Actions**:

- **`TAURI_SIGNING_PRIVATE_KEY`**: Full contents of `~/.tauri/upsed.key`.
- **`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`**: Key password (if you set one during key generation).

### 4. Triggering Releases

- **Desktop Release (`v*` via `.github/workflows/release.yml`):**
  ```bash
  git tag -a v0.2.0 -m "Release v0.2.0"
  git push origin master --follow-tags
  ```
  Creates a **draft** release with Windows/Linux/macOS installers, `.sig` files, and `latest.json`.
- **Bridge Firmware Release (`bridge-v*` via `.github/workflows/release-bridge.yml`):**
  ```bash
  git tag -a bridge-v1.7.0 -m "Bridge Firmware v1.7.0"
  git push origin master --follow-tags
  ```
  Compiles `upsed-bridge-firmware.bin`, generates `bridge-manifest.json`, and creates a **draft** release with `--latest=false`.
- **Manual Dispatch (`workflow_dispatch`):** Both workflows support manual dispatch with `draft` and `prerelease` inputs.
