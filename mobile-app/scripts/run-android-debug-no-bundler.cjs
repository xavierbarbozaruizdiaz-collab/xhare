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

function syncLauncherIcons(flavor) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'sync-android-launcher-icons.cjs')], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, APP_FLAVOR: flavor },
  });
  return r.status === 0;
}

function freeEmulatorSpace(adbPath, keepPackages = []) {
  console.log('[android-no-bundler] Liberando espacio en el emulador (caché; desinstalar otras variantes xhare)…');
  for (const pkg of ['com.xhare.app', 'com.xhare.driver']) {
    if (keepPackages.includes(pkg)) continue;
    try {
      execFileSync(adbPath, ['uninstall', pkg], { stdio: 'ignore' });
    } catch (_) {
      // ignore
    }
  }
  try {
    execFileSync(adbPath, ['shell', 'pm', 'trim-caches', '2000000000'], { stdio: 'ignore' });
  } catch (_) {
    // ignore
  }
  try {
    execFileSync(adbPath, ['shell', 'rm', '-rf', '/data/local/tmp/*'], { stdio: 'ignore' });
  } catch (_) {
    // ignore
  }
}

function tryInstallBuiltApk(adbPath, appId) {
  const apkPath = path.join(__dirname, '..', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  if (!fs.existsSync(apkPath)) {
    console.warn('[android-no-bundler] No hay APK en', apkPath);
    return false;
  }
  freeEmulatorSpace(adbPath, [appId]);
  const remote = '/data/local/tmp/xhare-debug.apk';
  try {
    execFileSync(adbPath, ['push', apkPath, remote], { stdio: 'inherit' });
    execFileSync(adbPath, ['shell', 'pm', 'install', '-r', '-t', remote], { stdio: 'inherit' });
    forceOpenMainActivity(adbPath, appId);
    return true;
  } catch (e) {
    console.error(
      '[android-no-bundler] Instalación manual falló (emulador sin espacio interno).',
      'En AVD Manager: Wipe Data del emulador o aumentá almacenamiento interno, luego reintentá.',
    );
    return false;
  }
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
if (!syncLauncherIcons(flavor)) {
  console.warn('[android-no-bundler] No se pudieron sincronizar iconos launcher; continuando igual.');
}
try {
  require('./sync-autolinking-package.cjs');
} catch (_) {
  // ignore
}
freeEmulatorSpace(adb, [appId]);
const result = runExpoInstall(appId);
if (result.error) {
  console.error('[android-no-bundler] Error ejecutando Expo:', result.error.message);
}
if (result.status === 0) {
  process.exit(0);
}

// Fallback: build OK pero install/open falló (espacio en emulador o activity placeholder).
if (tryInstallBuiltApk(adb, appId)) {
  console.warn(`[android-no-bundler] Expo devolvió ${result.status}; APK instalado y abierto por adb.`);
  process.exit(0);
}
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

