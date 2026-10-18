import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const bridgeDir = path.resolve(__dirname, '..', 'upsed-bridge');

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

const pioBin = resolvePioBinary();
const userArgs = process.argv.slice(2);
const args = userArgs.length > 0 ? userArgs : ['run'];

console.log(`[PIO] Executing in upsed-bridge: ${pioBin} ${args.join(' ')}`);

const child = spawn(pioBin, args, {
  cwd: bridgeDir,
  stdio: 'inherit',
});

child.on('error', (err) => {
  console.error(`[PIO] Failed to execute PlatformIO command: ${err.message}`);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});
