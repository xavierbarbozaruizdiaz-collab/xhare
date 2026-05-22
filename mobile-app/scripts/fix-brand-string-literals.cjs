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

for (const file of walk(ROOT)) {
  let s = fs.readFileSync(file, 'utf8');
  const before = s;
  s = s.replace(/'appBrand\.colors\.([a-zA-Z]+)'/g, 'appBrand.colors.$1');
  if (s !== before) {
    fs.writeFileSync(file, s);
    console.log('fixed', path.relative(path.join(__dirname, '..'), file));
  }
}
