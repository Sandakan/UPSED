import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const bridgeDir = path.resolve(__dirname, '..', 'upsed-bridge');
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');

/**
 * Optionally loads UPSED_OTA_SECRET from root .env file (used only for legacy espota CLI).
 */
function loadOptionalOtaSecret() {
  if (!fs.existsSync(envPath)) {
    return '';
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  const secretMatch = envContent.match(/^UPSED_OTA_SECRET\s*=\s*["']?([^"'\r\n]+)["']?/m);
  return secretMatch ? secretMatch[1].trim() : '';
}

/**
 * Resolves the PlatformIO executable:
 * 1. Checks standard ~/.platformio virtualenv paths
 * 2. Falls back to global 'pio' on PATH
 */
function resolvePioBinary() {
  const home = os.homedir();
  const standardLocations = [
    path.join(home, '.platformio', 'penv', 'Scripts', 'pio.exe'),
    path.join(home, '.platformio', 'penv', 'bin', 'pio'),
    path.join(home, '.platformio', 'penv', 'Scripts', 'pio'),
  ];

  for (const loc of standardLocations) {
    if (fs.existsSync(loc)) {
      return loc;
    }
  }

  return 'pio';
}

const otaSecret = loadOptionalOtaSecret();
const pioBin = resolvePioBinary();
const userArgs = process.argv.slice(2);
const args = userArgs.length > 0 ? userArgs : ['run'];

console.log(`[PIO] Executing in upsed-bridge: ${pioBin} ${args.join(' ')}`);

// Inject secret macro definition into PlatformIO build flags if present (for legacy espota CLI)
const existingBuildFlags = process.env.PLATFORMIO_BUILD_FLAGS || '';
let combinedBuildFlags = existingBuildFlags;
if (otaSecret) {
  const sconsEscapedSecret = otaSecret.replace(/\$/g, '$$$$');
  const otaBuildFlag = `-DBRIDGE_OTA_SECRET=\\"${sconsEscapedSecret}\\"`;
  combinedBuildFlags = existingBuildFlags ? `${existingBuildFlags} ${otaBuildFlag}` : otaBuildFlag;
}

const env = {
  ...process.env,
  UPSED_OTA_SECRET: otaSecret,
  PLATFORMIO_BUILD_FLAGS: combinedBuildFlags,
};

const child = spawn(pioBin, args, {
  cwd: bridgeDir,
  stdio: 'inherit',
  env,
});

child.on('error', (err) => {
  console.error(`[PIO] Failed to execute PlatformIO command: ${err.message}`);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});
