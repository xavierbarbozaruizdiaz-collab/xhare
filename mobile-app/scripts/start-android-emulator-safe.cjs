/**
 * Arranca el Android Emulator en modo estable para Windows.
 * Evita crashes por snapshots/GPU del host.
 *
 * Uso:
 *   npm run android:emulator
 *   npm run android:emulator -- Medium_Phone_API_36.0
 *   set ANDROID_AVD_NAME=Pixel_9a && npm run android:emulator
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function findEmulator() {
  const name = process.platform === 'win32' ? 'emulator.exe' : 'emulator';
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (home) {
    const p = path.join(home, 'emulator', name);
    if (fs.existsSync(p)) return p;
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const p = path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'emulator', name);
    if (fs.existsSync(p)) return p;
  }
  return name;
}

const avdFromCli = process.argv[2]?.trim();
const avd =
  avdFromCli ||
  process.env.ANDROID_AVD_NAME?.trim() ||
  process.env.ANDROID_AVD?.trim() ||
  'Pixel_9a';

const exe = findEmulator();
if (!fs.existsSync(exe)) {
  console.error(
    '[android-emulator-safe] No se encontró el ejecutable del emulador:',
    exe,
    '\nDefiní ANDROID_HOME / ANDROID_SDK_ROOT o instalá el SDK en %LOCALAPPDATA%\\Android\\Sdk.'
  );
  process.exit(1);
}

const gpuMode = process.env.ANDROID_EMULATOR_GPU_MODE?.trim() || 'angle_indirect';
const args = ['-avd', avd, '-gpu', gpuMode, '-no-snapshot-load', '-no-snapshot-save'];
if (process.env.ANDROID_EMULATOR_WIPE_DATA === '1') {
  args.push('-wipe-data');
}
console.log('[android-emulator-safe]', exe, args.join(' '));

const child = spawn(exe, args, {
  stdio: 'inherit',
  windowsHide: false,
});
child.on('exit', (code) => process.exit(code ?? 0));
