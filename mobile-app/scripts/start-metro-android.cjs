/**
 * Metro para Android Emulator + Windows:
 *
 * - El emulador consulta Metro en 10.0.2.2:8081 (IPv4 al host). Si Expo usa --localhost, Metro
 *   a veces queda solo en [::1]:8081 (IPv6) y esa conexión FALLA → "Unable to load script".
 * - Por eso usamos --host lan: Metro escucha en 0.0.0.0 y 10.0.2.2 llega bien.
 *
 * adb reverse sigue ayudando si la app o DevTools usan localhost:8081 (p. ej. USB físico).
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/** Evita que Expo pida “¿usar 8082?” en modo no interactivo si quedó un Metro viejo en 8081. */
function freeWindowsPort8081() {
  if (process.platform !== 'win32') return;
  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }",
      ],
      { stdio: 'ignore' }
    );
  } catch (_) {
    /* ignore */
  }
}

function findAdb() {
  if (process.env.ADB_PATH && fs.existsSync(process.env.ADB_PATH)) {
    return process.env.ADB_PATH;
  }
  const home = process.env.ANDROID_HOME;
  if (home) {
    const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
    const p = path.join(home, 'platform-tools', exe);
    if (fs.existsSync(p)) return p;
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const p = path.join(
      process.env.LOCALAPPDATA,
      'Android',
      'Sdk',
      'platform-tools',
      'adb.exe'
    );
    if (fs.existsSync(p)) return p;
  }
  return process.platform === 'win32' ? 'adb.exe' : 'adb';
}

function pickDeviceSerial(adbPath) {
  if (process.env.ANDROID_SERIAL?.trim()) return process.env.ANDROID_SERIAL.trim();
  let out;
  try {
    out = execFileSync(adbPath, ['devices'], { encoding: 'utf8' });
  } catch {
    return null;
  }
  const lines = out.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('List of'));
  const devices = lines
    .map((l) => l.split(/\s+/))
    .filter((p) => p.length >= 2 && p[1] === 'device')
    .map((p) => p[0]);
  if (devices.length === 0) return null;
  if (devices.length === 1) return devices[0];
  const emu = devices.find((d) => d.startsWith('emulator-'));
  if (emu) {
    console.log(
      '[metro-android] Varios dispositivos; usando emulador',
      emu,
      '(definí ANDROID_SERIAL si querés otro).'
    );
    return emu;
  }
  console.log('[metro-android] Varios dispositivos; usando', devices[0]);
  return devices[0];
}

freeWindowsPort8081();

const adb = findAdb();
const serial = pickDeviceSerial(adb);
try {
  const args = serial
    ? ['-s', serial, 'reverse', 'tcp:8081', 'tcp:8081']
    : ['reverse', 'tcp:8081', 'tcp:8081'];
  execFileSync(adb, args, { stdio: 'inherit' });
  console.log(
    '[metro-android] adb reverse tcp:8081 → ok',
    serial ? `(dispositivo ${serial})` : ''
  );
} catch {
  console.warn(
    '[metro-android] adb reverse falló (¿sin emulador/USB?). Seguí igual; revisá dispositivos con adb devices.'
  );
}

const expoCli = require.resolve('expo/bin/cli');
const userArgs = process.argv.slice(2);
const child = spawn(process.execPath, [expoCli, 'start', '--host', 'lan', ...userArgs], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    // Refuerzo en Windows: que Node prefiera IPv4 al bindear, evitando solo [::1] en algunos setups.
    NODE_OPTIONS: [process.env.NODE_OPTIONS, '--dns-result-order=ipv4first'].filter(Boolean).join(' '),
  },
});
child.on('exit', (code) => process.exit(code ?? 0));
