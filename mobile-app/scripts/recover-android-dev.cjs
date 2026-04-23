/**
 * Recuperacion robusta para desarrollo Android en Windows:
 * - Limpia procesos colgados (emulator/metro/puertos).
 * - Arranca AVD estable.
 * - Espera ADB "device" con reintentos y reconnect offline.
 * - Levanta Metro y asegura adb reverse.
 * - Abre pasajero y/o conductor (instalando si falta).
 *
 * Uso:
 *   npm run android:recover
 *   npm run android:recover -- passenger
 *   npm run android:recover -- driver
 *   npm run android:recover -- both
 */
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const workspaceRoot = path.join(__dirname, '..');
const modeArg = (process.argv[2] || 'both').trim().toLowerCase();
const targetMode = modeArg === 'passenger' || modeArg === 'driver' || modeArg === 'both' ? modeArg : 'both';
const targetAvd = process.env.ANDROID_RECOVER_AVD || 'Medium_Phone_API_36.0';

function shell(command, args, opts = {}) {
  return spawnSync(command, args, {
    cwd: workspaceRoot,
    env: process.env,
    stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    windowsHide: false,
  });
}

function findAdb() {
  if (process.env.ADB_PATH && fs.existsSync(process.env.ADB_PATH)) return process.env.ADB_PATH;
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (home) {
    const p = path.join(home, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
    if (fs.existsSync(p)) return p;
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const p = path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe');
    if (fs.existsSync(p)) return p;
  }
  return process.platform === 'win32' ? 'adb.exe' : 'adb';
}

function parseDeviceSerial(adbDevicesOutput) {
  const lines = adbDevicesOutput
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith('List of devices'));
  const device = lines
    .map((l) => l.split(/\s+/))
    .find((parts) => parts.length >= 2 && parts[0].startsWith('emulator-') && parts[1] === 'device');
  return device ? device[0] : null;
}

function hasOffline(adbDevicesOutput) {
  return adbDevicesOutput.split(/\r?\n/).some((l) => /\bemulator-\d+\s+offline\b/.test(l));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEmulatorDevice(adbPath, maxAttempts = 30, delayMs = 4000) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const out = shell(adbPath, ['devices'], { capture: true });
    const stdout = out.stdout || '';
    const serial = parseDeviceSerial(stdout);
    if (serial) return serial;
    if (hasOffline(stdout)) {
      shell(adbPath, ['reconnect', 'offline']);
    }
    await wait(delayMs);
  }
  return null;
}

function stopStaleProcesses(adbPath) {
  shell('powershell.exe', [
    '-NoProfile',
    '-Command',
    [
      `if (Test-Path '${adbPath.replace(/\\/g, '\\\\')}') {`,
      `  & '${adbPath.replace(/\\/g, '\\\\')}' devices 2>$null | Select-String '^emulator-' | ForEach-Object {`,
      `    $s = ($_ -split '\\s+')[0]; if ($s) { & '${adbPath.replace(/\\/g, '\\\\')}' -s $s emu kill 2>$null }`,
      `  }`,
      '}',
      "Get-Process -Name 'qemu-system*','emulator' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue",
      'foreach ($p in 8081,8082) {',
      '  Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object {',
      '    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue',
      '  }',
      '}',
    ].join('; '),
  ]);
}

function startEmulatorDetached() {
  if (process.platform === 'win32') {
    shell('powershell.exe', [
      '-NoProfile',
      '-Command',
      [
        "$env:ANDROID_EMULATOR_GPU_MODE='" + (process.env.ANDROID_EMULATOR_GPU_MODE || 'angle_indirect') + "'",
        `Start-Process -FilePath npm -ArgumentList @('run','android:emulator','--','${targetAvd}') -WorkingDirectory '${workspaceRoot.replace(/\\/g, '\\\\')}'`,
      ].join('; '),
    ]);
    return;
  }
  const child = spawn('npm', ['run', 'android:emulator', '--', targetAvd], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      ANDROID_EMULATOR_GPU_MODE: process.env.ANDROID_EMULATOR_GPU_MODE || 'angle_indirect',
    },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function startMetroDetached() {
  if (process.platform === 'win32') {
    shell('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Start-Process -FilePath npm -ArgumentList @('run','start:clear') -WorkingDirectory '${workspaceRoot.replace(/\\/g, '\\\\')}'`,
    ]);
    return;
  }
  const child = spawn('npm', ['run', 'start:clear'], {
    cwd: workspaceRoot,
    env: process.env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function ensureReverse(adbPath, serial) {
  shell(adbPath, ['-s', serial, 'reverse', 'tcp:8081', 'tcp:8081']);
  shell(adbPath, ['-s', serial, 'reverse', 'tcp:8082', 'tcp:8082']);
}

function packageInstalled(adbPath, packageName) {
  const out = shell(adbPath, ['shell', 'pm', 'list', 'packages', packageName], { capture: true });
  return (out.stdout || '').includes(`package:${packageName}`);
}

function openPackage(adbPath, packageName) {
  shell(adbPath, ['shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1']);
}

function installAndOpen(flavor) {
  const cmd = flavor === 'driver' ? 'android:driver:no-bundler' : 'android:passenger:no-bundler';
  const out = shell(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', cmd]);
  return out.status === 0;
}

async function main() {
  const adb = findAdb();
  console.log('[android-recover] Limpiando procesos previos...');
  stopStaleProcesses(adb);

  console.log('[android-recover] Iniciando emulador:', targetAvd);
  startEmulatorDetached();

  console.log('[android-recover] Esperando ADB device...');
  const serial = await waitForEmulatorDevice(adb);
  if (!serial) {
    console.error('[android-recover] Emulador no disponible en ADB tras varios intentos.');
    process.exit(1);
  }
  console.log('[android-recover] Emulador listo:', serial);

  console.log('[android-recover] Iniciando Metro...');
  startMetroDetached();
  await wait(8000);
  ensureReverse(adb, serial);

  const needsPassenger = targetMode === 'both' || targetMode === 'passenger';
  const needsDriver = targetMode === 'both' || targetMode === 'driver';

  if (needsPassenger) {
    if (packageInstalled(adb, 'com.xhare.app')) {
      openPackage(adb, 'com.xhare.app');
    } else {
      installAndOpen('passenger');
    }
  }
  if (needsDriver) {
    if (packageInstalled(adb, 'com.xhare.driver')) {
      openPackage(adb, 'com.xhare.driver');
    } else {
      installAndOpen('driver');
    }
  }

  console.log('[android-recover] Listo. Emulador + Metro + apps solicitadas.');
}

main().catch((err) => {
  console.error('[android-recover] Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
