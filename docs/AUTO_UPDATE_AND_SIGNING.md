# Automatic Updates & Release Signing Setup

> Back to [README](../README.md)

UPSED uses Tauri v2's signed updater (`tauri-plugin-updater` + `tauri-plugin-process`) backed by GitHub Releases (`latest.json` + `.sig` signatures) and a release `manifest.json` for desktop setup checksums and ESP32 bridge firmware metadata.

---

## How In-App Updates Work

1. **Startup & Manual Checks:** `useAppUpdater` ([src/lib/updater.ts](../src/lib/updater.ts)) checks `https://github.com/Sandakan/UPSED/releases/latest/download/latest.json` 3 seconds after launch and on-demand via **About → Check for Updates**.
2. **Cryptographic Verification:** `tauri-plugin-updater` verifies the downloaded update's `.sig` signature against the public key (`plugins.updater.pubkey`) embedded in [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json).
3. **Guided Install & Relaunch:** When an update is available, `AppUpdateBanner` displays a non-intrusive bar with download progress and an **Update & Restart** button that installs the update and relaunches the app.
4. **Release `manifest.json` Integrity:** Alongside `latest.json`, CI generates `manifest.json` with SHA-256 checksums for all desktop setup installers and ESP32-S3 bridge firmware (`version`, `size`, `sha256`), enabling verified bridge firmware version checks and OTA SHA-256 verification before flashing.

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
- **`UPSED_OTA_SECRET`**: Shared secret used for ESP32-S3 bridge OTA builds.

### 4. Triggering Releases (`.github/workflows/release.yml`)

- **Tag Push (`v*`):** Pushing a version tag (e.g. `git tag -a v0.1.8 -m "Release v0.1.8" && git push origin master --follow-tags`) runs tests, builds Windows/Linux/macOS installers with `.sig` updater artifacts + `latest.json`, compiles `upsed-bridge-firmware.bin`, and generates `manifest.json` with SHA-256 checksums.
- **Manual Dispatch (`workflow_dispatch`):** Allows choosing `draft` and `prerelease` flags directly from the GitHub Actions UI.
