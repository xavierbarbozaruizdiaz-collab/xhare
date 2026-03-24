/**
 * Robust Android debug runner without Metro bundler launch:
 * - Builds/installs with Expo.
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

function runExpoInstall(appId) {
  const expoCli = require.resolve('expo/bin/cli');
  const args = [expoCli, 'run:android', '--variant', 'debug', '--no-bundler', '--app-id', appId];
  return spawnSync(process.execPath, args, { stdio: 'inherit', cwd: path.join(__dirname, '..'), env: process.env });
}

function forceOpenMainActivity(adbPath, appId) {
  try {
    execFileSync(adbPath, ['start-server'], { stdio: 'ignore' });
  } catch (_) {
    // ignore
  }
  execFileSync(adbPath, ['shell', 'am', 'start', '-n', `${appId}/.MainActivity`], { stdio: 'inherit' });
}

const flavor = getFlavor();
const appId = flavor === 'driver' ? 'com.xhare.driver' : 'com.xhare.app';
const adb = findAdb();

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

