/**
 * Release APK local: carga mobile-app/.env y .env.local (p. ej. GOOGLE_MAPS_ANDROID_API_KEY,
 * opcionalmente ANDROID_RELEASE_* si tenés keystore local) y ejecuta Gradle con APP_FLAVOR (gradlew no lee .env).
 * Sin keystore local, Gradle firma release con debug (smoke); APK firmado para tienda → EAS Build.
 * Solo `assembleRelease`:
 * evita que `expo run:android` cuelgue en Metro / instalación tras un build release ya exitoso.
 * Para AAB locales en `dist-aab/`: `npm run build:android:bundle:release`.
 *
 * Uso:
 *   node scripts/run-android-release-flavor.cjs passenger
 *   node scripts/run-android-release-flavor.cjs driver
 *   node scripts/run-android-release-flavor.cjs both
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const androidDir = path.join(root, 'android');
const apkRelease = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const distDir = path.join(root, 'dist-apks');

require('dotenv').config({ path: path.join(root, '.env') });
require('dotenv').config({ path: path.join(root, '.env.local'), override: true });

/** Si hay ANDROID_RELEASE_* en el entorno, normalizar ruta del keystore relativa a mobile-app/. */
function normalizeReleaseStoreFileEnv() {
  const file = (process.env.ANDROID_RELEASE_STORE_FILE || '').trim();
  if (!file) return;
  const abs = path.isAbsolute(file) ? file : path.join(root, file);
  process.env.ANDROID_RELEASE_STORE_FILE = abs;
}

function needMapsKey() {
  const k = (process.env.GOOGLE_MAPS_ANDROID_API_KEY || '').trim();
  if (!k) {
    console.error(
      'Falta GOOGLE_MAPS_ANDROID_API_KEY. Definila en mobile-app/.env o en el entorno antes de compilar.'
    );
    process.exit(1);
  }
}

/** Entre passenger y driver en Windows, Gradle deja `classes.dex` bloqueado y `prebuild --clean` falla (EBUSY). */
function releaseGradleLocks() {
  if (fs.existsSync(androidDir)) {
    const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    spawnSync(gradlew, ['--stop'], {
      cwd: androidDir,
      stdio: 'ignore',
      env: process.env,
      shell: process.platform === 'win32',
    });
  }
  if (process.platform === 'win32') {
    spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 5'], { stdio: 'ignore' });
  } else {
    spawnSync('sleep', ['5'], { stdio: 'ignore' });
  }
}

function removeAndroidProject() {
  releaseGradleLocks();
  if (!fs.existsSync(androidDir)) return true;
  try {
    fs.rmSync(androidDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 800 });
    return true;
  } catch (e) {
    console.error('No se pudo borrar android/ antes del siguiente flavor:', e.message);
    console.error('Cerrá Android Studio o el emulador y ejecutá el flavor que falte por separado.');
    return false;
  }
}

function runGradlewClean() {
  const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const r = spawnSync(gradlew, ['clean'], {
    cwd: androidDir,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  return r.status === 0;
}

function runExpoPrebuildClean(flavor) {
  const expoCli = require.resolve('expo/bin/cli');
  const env = { ...process.env, APP_FLAVOR: flavor, EXPO_PUBLIC_APP_FLAVOR: flavor };
  const r = spawnSync(
    process.execPath,
    [expoCli, 'prebuild', '--platform', 'android', '--clean'],
    {
      cwd: root,
      stdio: 'inherit',
      env,
    }
  );
  return r.status === 0;
}

function runGradleAssembleRelease(flavor) {
  const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const env = { ...process.env, APP_FLAVOR: flavor };
  const r = spawnSync(gradlew, ['assembleRelease'], {
    cwd: androidDir,
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
  });
  return r.status === 0;
}

function copyApk(suffix) {
  if (!fs.existsSync(apkRelease)) {
    console.error('No se encontró el APK en:', apkRelease);
    return false;
  }
  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
  const dest = path.join(distDir, `xhare-${suffix}-release.apk`);
  fs.copyFileSync(apkRelease, dest);
  console.log('Copiado →', dest);
  return true;
}

function buildOne(flavor, copySuffix) {
  console.log('\n=== Release build:', flavor, '===\n');
  if (!runExpoPrebuildClean(flavor)) {
    console.error('expo prebuild --clean falló');
    return false;
  }
  if (!runGradlewClean()) {
    console.warn('gradlew clean falló; continúo con assembleRelease');
  }
  if (!runGradleAssembleRelease(flavor)) {
    console.error('gradlew assembleRelease falló');
    return false;
  }
  return copyApk(copySuffix);
}

const mode = (process.argv[2] || 'both').toLowerCase();
needMapsKey();
normalizeReleaseStoreFileEnv();

if (mode === 'both') {
  if (!buildOne('passenger', 'passenger')) process.exit(1);
  if (!removeAndroidProject()) process.exit(1);
  if (!buildOne('driver', 'driver')) process.exit(1);
  console.log('\nListo: dist-apks/xhare-passenger-release.apk y xhare-driver-release.apk\n');
} else if (mode === 'passenger') {
  if (!buildOne('passenger', 'passenger')) process.exit(1);
} else if (mode === 'driver') {
  if (!buildOne('driver', 'driver')) process.exit(1);
} else {
  console.error('Uso: node scripts/run-android-release-flavor.cjs [passenger|driver|both]');
  process.exit(1);
}
