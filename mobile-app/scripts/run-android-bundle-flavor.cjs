/**
 * Release AAB local (Android App Bundle): misma base que run-android-release-flavor.cjs
 * pero con `bundleRelease` y salida en `dist-aab/`.
 * Play Store oficial con firma de producción → EAS Build; esto sirve para smoke / artefactos locales.
 *
 * Uso:
 *   node scripts/run-android-bundle-flavor.cjs passenger
 *   node scripts/run-android-bundle-flavor.cjs driver
 *   node scripts/run-android-bundle-flavor.cjs both
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const androidDir = path.join(root, 'android');
const aabRelease = path.join(androidDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
const distDir = path.join(root, 'dist-aab');

require('dotenv').config({ path: path.join(root, '.env') });
require('dotenv').config({ path: path.join(root, '.env.local'), override: true });

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
  const r = spawnSync(process.execPath, [expoCli, 'prebuild', '--platform', 'android', '--clean'], {
    cwd: root,
    stdio: 'inherit',
    env,
  });
  return r.status === 0;
}

function runGradleBundleRelease(flavor) {
  const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const env = { ...process.env, APP_FLAVOR: flavor };
  const r = spawnSync(gradlew, ['bundleRelease'], {
    cwd: androidDir,
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
  });
  return r.status === 0;
}

function copyAab(suffix) {
  if (!fs.existsSync(aabRelease)) {
    console.error('No se encontró el AAB en:', aabRelease);
    return false;
  }
  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
  const dest = path.join(distDir, `xhare-${suffix}-release.aab`);
  fs.copyFileSync(aabRelease, dest);
  console.log('Copiado →', dest);
  return true;
}

function buildOne(flavor, copySuffix) {
  console.log('\n=== Release bundle:', flavor, '===\n');
  if (!runExpoPrebuildClean(flavor)) {
    console.error('expo prebuild --clean falló');
    return false;
  }
  if (!runGradlewClean()) {
    console.warn('gradlew clean falló; continúo con bundleRelease');
  }
  if (!runGradleBundleRelease(flavor)) {
    console.error('gradlew bundleRelease falló');
    return false;
  }
  return copyAab(copySuffix);
}

const mode = (process.argv[2] || 'both').toLowerCase();
needMapsKey();
normalizeReleaseStoreFileEnv();

if (mode === 'both') {
  if (!buildOne('passenger', 'passenger')) process.exit(1);
  if (!buildOne('driver', 'driver')) process.exit(1);
  console.log('\nListo: dist-aab/xhare-passenger-release.aab y xhare-driver-release.aab\n');
} else if (mode === 'passenger') {
  if (!buildOne('passenger', 'passenger')) process.exit(1);
} else if (mode === 'driver') {
  if (!buildOne('driver', 'driver')) process.exit(1);
} else {
  console.error('Uso: node scripts/run-android-bundle-flavor.cjs [passenger|driver|both]');
  process.exit(1);
}
