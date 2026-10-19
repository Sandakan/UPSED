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
 * Loads and validates UPSED_OTA_SECRET from root .env file.
 * Halts build with a clear, actionable error if missing.
 */
function loadAndValidateOtaSecret() {
  if (!fs.existsSync(envPath)) {
    console.error('\n' + '='.repeat(80));
    console.error('[ERROR] Missing .env configuration file!');
    console.error('='.repeat(80));
    console.error('Wireless Over-The-Air (OTA) flashing requires a shared authentication secret.');
    console.error('Please copy .env.example to .env and configure UPSED_OTA_SECRET:\n');
    console.error('  cp .env.example .env\n');
    console.error('='.repeat(80) + '\n');
    process.exit(1);
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  const secretMatch = envContent.match(/^UPSED_OTA_SECRET\s*=\s*["']?([^"'\r\n]+)["']?/m);
  const secret = secretMatch ? secretMatch[1].trim() : '';

  if (!secret) {
    console.error('\n' + '='.repeat(80));
    console.error('[ERROR] UPSED_OTA_SECRET is empty in .env!');
    console.error('='.repeat(80));
    console.error('Please specify a secure secret passphrase for UPSED_OTA_SECRET in your .env file.\n');
    console.error('='.repeat(80) + '\n');
    process.exit(1);
  }

  return secret;
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

const otaSecret = loadAndValidateOtaSecret();
const pioBin = resolvePioBinary();
const userArgs = process.argv.slice(2);
const args = userArgs.length > 0 ? userArgs : ['run'];

console.log(`[PIO] Executing in upsed-bridge: ${pioBin} ${args.join(' ')}`);

// Inject secret macro definition into PlatformIO build flags
const existingBuildFlags = process.env.PLATFORMIO_BUILD_FLAGS || '';
const otaBuildFlag = `-DBRIDGE_OTA_SECRET=\\"${otaSecret}\\"`;
const combinedBuildFlags = existingBuildFlags ? `${existingBuildFlags} ${otaBuildFlag}` : otaBuildFlag;

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
