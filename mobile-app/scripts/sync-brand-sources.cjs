/**
 * Copia los PNG subidos por diseño a los nombres que usa la app (brand.ts / app.config.js).
 */
const fs = require('fs');
const path = require('path');

const BRAND_DIR = path.join(__dirname, '..', 'assets', 'brand');

/** Primer archivo existente gana (orden = preferencia del diseñador). */
function resolveSource(candidates) {
  for (const from of candidates) {
    const src = path.join(BRAND_DIR, from);
    if (fs.existsSync(src)) return from;
  }
  return null;
}

const SOURCES = [
  { from: ['icono pasajero.png', 'icono_pasajero.png', 'icono_pasajero-removebg-preview.png'], to: 'passenger-icon.png' },
  { from: 'logo_pasajero .png', to: 'passenger-logo.png' },
  { from: 'logo_conductor .png', to: 'driver-logo.png' },
  { from: 'icono conductor.png', to: 'driver-icon.png' },
  { from: 'fondo pasajero .png', to: 'passenger-splash-bg.png' },
  { from: 'fondo conductor .png', to: 'driver-splash-bg.png' },
];

function main() {
  for (const { from, to } of SOURCES) {
    const candidates = Array.isArray(from) ? from : [from];
    const picked = resolveSource(candidates);
    const dest = path.join(BRAND_DIR, to);
    if (!picked) {
      console.warn(`SKIP (no existe): ${candidates.join(' | ')}`);
      continue;
    }
    fs.copyFileSync(path.join(BRAND_DIR, picked), dest);
    console.log(`${picked} → ${to}`);
  }
}

main();
