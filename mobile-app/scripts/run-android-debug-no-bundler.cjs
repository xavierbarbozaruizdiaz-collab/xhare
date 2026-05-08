/**
 * Robust Android debug runner without Metro bundler launch:
 * - Regenera `android/` por flavor (`expo prebuild --clean`) para alinear package/appId.
 * - Builds/installs with Expo (`--no-build-cache`).
 * - If Expo fails only when opening activity (known placeholder issue), force-opens .MainActivity.
 */
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function findAdb() {
  if (process.env.ADB_PATH && fs.existsSync(process.env.ADB_PATH)) return process.env.ADB_PATH;
  const home = process.env.ANDROID_HOME;
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

function getFlavor() {
  const raw = (process.env.APP_FLAVOR || process.env.EXPO_PUBLIC_APP_FLAVOR || 'passenger').trim();
  return raw === 'driver' ? 'driver' : 'passenger';
}

function runExpoPrebuildClean() {
  const expoCli = require.resolve('expo/bin/cli');
  console.log('[android-no-bundler] expo prebuild --platform android --clean (sincroniza package por flavor)…');
  const r = spawnSync(process.execPath, [expoCli, 'prebuild', '--platform', 'android', '--clean'], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    env: process.env,
  });
  return r.status === 0;
}

function runExpoInstall(appId) {
  const expoCli = require.resolve('expo/bin/cli');
  // Sin esto, al alternar pasajero/conductor Gradle puede reusar caché y el APK de conductor
  // queda desalineado con el último `app.config` / nativo generado para ese package.
  const args = [
    expoCli,
    'run:android',
    '--variant',
    'debug',
    '--no-bundler',
    '--no-build-cache',
    '--app-id',
    appId,
  ];
  return spawnSync(process.execPath, args, { stdio: 'inherit', cwd: path.join(__dirname, '..'), env: process.env });
}

function forceOpenMainActivity(adbPath, appId) {
  try {
    execFileSync(adbPath, ['start-server'], { stdio: 'ignore' });
  } catch (_) {
    // ignore
  }
  let resolvedComponent = '';
  try {
    const out = execFileSync(adbPath, ['shell', 'cmd', 'package', 'resolve-activity', '--brief', appId], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const lines = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const component = lines.find((line) => line.includes('/'));
    if (component) resolvedComponent = component;
  } catch (_) {
    // ignore and use fallback below
  }
  const componentToOpen = resolvedComponent || `${appId}/.MainActivity`;
  execFileSync(adbPath, ['shell', 'am', 'start', '-n', componentToOpen], { stdio: 'inherit' });
}

const flavor = getFlavor();
const appId = flavor === 'driver' ? 'com.xhare.driver' : 'com.xhare.app';
const adb = findAdb();

if (!runExpoPrebuildClean()) {
  console.error('[android-no-bundler] Falló expo prebuild --clean; abortando para evitar binario inconsistente.');
  process.exit(1);
}
const result = runExpoInstall(appId);
if (result.error) {
  console.error('[android-no-bundler] Error ejecutando Expo:', result.error.message);
}
if (result.status === 0) {
  process.exit(0);
}

// Fallback: Expo can fail after successful install due activity placeholder parsing.
try {
  forceOpenMainActivity(adb, appId);
  console.warn(
    `[android-no-bundler] Expo returned ${result.status}, but app was force-opened via adb (${appId}/.MainActivity).`
  );
  process.exit(0);
} catch (e) {
  console.error('[android-no-bundler] No se pudo abrir la app manualmente:', e instanceof Error ? e.message : e);
  process.exit(result.status ?? 1);
}

