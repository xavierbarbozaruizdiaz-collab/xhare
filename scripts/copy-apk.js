/**
 * Después de android:apk, copia app-debug.apk a dist/ con nombre que incluye fecha y versión.
 * Uso: npm run android:apk && node scripts/copy-apk.js
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const distDir = path.join(root, 'dist');

if (!fs.existsSync(src)) {
  console.error('No se encontró app-debug.apk. Ejecutá primero: npm run android:apk');
  process.exit(1);
}

let version = '0.1.0';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  version = (pkg.version || version).replace(/\./g, '-');
} catch (_) {}

const now = new Date();
const dateStr = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
  String(now.getHours()).padStart(2, '0'),
  String(now.getMinutes()).padStart(2, '0'),
].join('-');
const destName = `xhare-debug-v${version}-${dateStr}.apk`;
const dest = path.join(distDir, destName);

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

fs.copyFileSync(src, dest);
console.log('APK copiado a:', path.relative(root, dest));
