/**
 * EAS Build producción: APK pasajero + APK conductor (sin AAB).
 * Requiere sesión EAS (`eas login`) o variable EXPO_TOKEN.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const profiles = ['production_passenger', 'production_driver'];

for (const profile of profiles) {
  const r = spawnSync(
    'npx',
    ['eas-cli@18.9.1', 'build', '--platform', 'android', `--profile=${profile}`, '--non-interactive'],
    { cwd: root, stdio: 'inherit', shell: true }
  );
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}
