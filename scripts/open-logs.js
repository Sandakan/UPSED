import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Returns the platform-specific log directory used by UPSED / Tauri.
 */
function getLogDir() {
  const platform = os.platform();
  const bundleId = 'com.adsandakannipunajith.upsed';

  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, bundleId, 'logs');
  } else if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Logs', bundleId);
  } else {
    const stateHome =
      process.env.XDG_STATE_HOME ||
      process.env.XDG_DATA_HOME ||
      path.join(os.homedir(), '.local', 'state');
    return path.join(stateHome, bundleId, 'logs');
  }
}

const logDir = getLogDir();

// Ensure the folder exists so the OS file manager opens smoothly
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

console.log(`[UPSED] Opening logs directory: ${logDir}`);

const platform = os.platform();
let cmd;
let args;

if (platform === 'win32') {
  cmd = 'explorer.exe';
  args = [logDir];
} else if (platform === 'darwin') {
  cmd = 'open';
  args = [logDir];
} else {
  cmd = 'xdg-open';
  args = [logDir];
}

const child = spawn(cmd, args, { stdio: 'inherit', detached: true });
child.unref();
