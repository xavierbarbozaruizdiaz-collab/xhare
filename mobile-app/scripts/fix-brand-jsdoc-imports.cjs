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

const re = /^\/\*\*\r?\nimport \{ appBrand \} from '([^']+)';\r?\n([\s\S]*?)\*\/\r?\n/m;

for (const file of walk(ROOT)) {
  let s = fs.readFileSync(file, 'utf8');
  if (!re.test(s)) continue;
  s = s.replace(re, (m, from, body) => {
    return `/**\n${body}*/\nimport { appBrand } from '${from}';\n`;
  });
  fs.writeFileSync(file, s);
  console.log('jsdoc', path.relative(path.join(__dirname, '..'), file));
}
