const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(p);
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
  if (file.includes(`${path.sep}theme${path.sep}brand`)) continue;
  let s = fs.readFileSync(file, 'utf8');
  if (!s.includes('appBrand')) continue;
  if (/from ['"].*theme\/brand/.test(s)) continue;
  const idx = s.indexOf('\n');
  s = s.slice(0, idx + 1) + brandImportPath(file) + s.slice(idx + 1);
  fs.writeFileSync(file, s);
  console.log('import', path.relative(path.join(__dirname, '..'), file));
}
