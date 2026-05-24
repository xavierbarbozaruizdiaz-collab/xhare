/**
 * Instala pasajero y conductor en el emulador (packages distintos: com.xhare.app + com.xhare.driver).
 * Requiere haber generado cada APK al menos una vez (android:*:no-bundler).
 */
const { execFileSync, spawnSync } = require('child_process');
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
    return path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe');
  }
  return 'adb';
}

const root = path.join(__dirname, '..');
const adb = findAdb();
const defaultApk = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const driverCache = path.join(root, 'build', 'apk-cache', 'driver-debug.apk');
const passengerCache = path.join(root, 'build', 'apk-cache', 'passenger-debug.apk');

function installApk(apkPath, label) {
  if (!fs.existsSync(apkPath)) {
    console.warn(`[install-both] Sin APK ${label}: ${apkPath}`);
    return false;
  }
  console.log(`[install-both] Instalando ${label}…`);
  execFileSync(adb, ['install', '-r', '-t', apkPath], { stdio: 'inherit' });
  return true;
}

function main() {
  const mode = process.argv[2] || 'use-cache';
  if (mode === 'save-current') {
    fs.mkdirSync(path.dirname(driverCache), { recursive: true });
    if (!fs.existsSync(defaultApk)) {
      console.error('No hay app-debug.apk actual. Compilá conductor primero.');
      process.exit(1);
    }
    const pkg = fs.readFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'utf8');
    const dest = pkg.includes("applicationId 'com.xhare.driver'") ? driverCache : passengerCache;
    fs.copyFileSync(defaultApk, dest);
    console.log(`Guardado APK actual en ${dest}`);
    return;
  }

  let ok = 0;
  if (installApk(passengerCache, 'pasajero (com.xhare.app)')) ok++;
  if (installApk(driverCache, 'conductor (com.xhare.driver)')) ok++;
  if (ok === 0 && fs.existsSync(defaultApk)) {
    installApk(defaultApk, 'APK actual en android/');
    ok = 1;
  }
  if (ok === 0) {
    console.error(
      'No hay APKs en build/apk-cache/. Ejecutá:\n' +
        '  1) npm run android:driver:no-bundler && node scripts/install-both-debug.cjs save-current\n' +
        '  2) npm run android:passenger:no-bundler && node scripts/install-both-debug.cjs save-current\n' +
        '  3) node scripts/install-both-debug.cjs',
    );
    process.exit(1);
  }
  console.log('[install-both] Listo. Deberías ver ÑandeBus y ÑandeBus Driver en el launcher.');
}

main();
