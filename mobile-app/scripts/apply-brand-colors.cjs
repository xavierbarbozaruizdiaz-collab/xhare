/**
 * Reemplaza verdes legacy (#166534, #1a5c38) por appBrand.colors.primary en StyleSheets.
 * Uso único tras migración ÑandeBus; cada APK resuelve primary según APP_FLAVOR al bundle.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src');
const SKIP = new Set(['ui/theme/brand.ts', 'ui/theme/legacyGreenMap.ts']);

const REPLACEMENTS = [
  [/#166534/g, 'appBrand.colors.primary'],
  [/#1a5c38/g, 'appBrand.colors.primary'],
  [/#15803d/g, 'appBrand.colors.primaryMuted'],
  [/#14532d/g, 'appBrand.colors.primary'],
  [/#065f46/g, 'appBrand.colors.primaryMuted'],
  [/#f0fdf4/g, 'appBrand.colors.greenLight'],
  [/#ecfdf5/g, 'appBrand.colors.greenLight'],
  [/#dcfce7/g, 'appBrand.colors.greenLight'],
  [/#bbf7d0/g, 'appBrand.colors.greenLight'],
];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name) && !SKIP.has(rel)) out.push(p);
  }
  return out;
}

function brandImportPath(file) {
  const relDir = path.relative(ROOT, path.dirname(file));
  const depth = relDir ? relDir.split(path.sep).length : 0;
  const prefix = depth === 0 ? './' : '../'.repeat(depth);
  return `import { appBrand } from '${prefix}ui/theme/brand';\n`;
}

for (const file of walk(ROOT)) {
  let s = fs.readFileSync(file, 'utf8');
  if (!/#166534|#1a5c38|PASSENGER_PRIMARY/.test(s)) continue;
  for (const [re, rep] of REPLACEMENTS) {
    s = s.replace(re, rep);
  }
  s = s.replace(/PASSENGER_PRIMARY/g, 'appBrand.colors.primary');
  s = s.replace(/PASSENGER_PRIMARY_MID/g, 'appBrand.colors.primaryMuted');
  if (!s.includes('appBrand')) {
    const imp = brandImportPath(file);
    const idx = s.indexOf('\n');
    s = s.slice(0, idx + 1) + imp + s.slice(idx + 1);
  }
  s = s.replace(/fontFamily: 'DMSans_400Regular'/g, "fontFamily: appBrand.fonts.regular");
  s = s.replace(/fontFamily: 'DMSans_500Medium'/g, "fontFamily: appBrand.fonts.medium");
  s = s.replace(/fontFamily: 'DMSans_600SemiBold'/g, "fontFamily: appBrand.fonts.semibold");
  s = s.replace(/fontFamily: 'DMSans_700Bold'/g, "fontFamily: appBrand.fonts.semibold");
  fs.writeFileSync(file, s);
  console.log('updated', path.relative(ROOT, file));
}
