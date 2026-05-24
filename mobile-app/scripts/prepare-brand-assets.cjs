/**
 * Prepara assets de marca: trim, quita blanco de borde, redimensiona, matte Android en logos.
 * Uso: npm run brand:prepare  (incluye sync desde archivos de diseño)
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

require('./sync-brand-sources.cjs');

const BRAND_DIR = path.join(__dirname, '..', 'assets', 'brand');
const MATTE_RGB = [245, 232, 220];

function isEdgeBackground(r, g, b, a) {
  if (a < 16) return true;
  if (r >= 248 && g >= 248 && b >= 248) return true;
  if (r <= 20 && g <= 20 && b <= 20) return true;
  return false;
}

function floodClearEdgeBackground(data, width, height) {
  const w = width;
  const h = height;
  const visited = new Uint8Array(w * h);
  const queue = [];

  function tryPush(x, y) {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const idx = y * w + x;
    if (visited[idx]) return;
    const i = idx * 4;
    if (!isEdgeBackground(data[i], data[i + 1], data[i + 2], data[i + 3])) return;
    visited[idx] = 1;
    queue.push(idx);
  }

  for (let x = 0; x < w; x++) {
    tryPush(x, 0);
    tryPush(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    tryPush(0, y);
    tryPush(w - 1, y);
  }

  while (queue.length > 0) {
    const idx = queue.pop();
    const i = idx * 4;
    data[i + 3] = 0;
    const x = idx % w;
    const y = (idx - x) / w;
    tryPush(x - 1, y);
    tryPush(x + 1, y);
    tryPush(x, y - 1);
    tryPush(x, y + 1);
  }
}

async function applyMatte(filePath, matteHex) {
  const matte = matteHex ? parseHexColor(matteHex) : { r: MATTE_RGB[0], g: MATTE_RGB[1], b: MATTE_RGB[2] };
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 16) {
      data[i] = matte.r;
      data[i + 1] = matte.g;
      data[i + 2] = matte.b;
      data[i + 3] = 0;
    }
  }
  const tmp = `${filePath}.matte.tmp`;
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9, palette: false })
    .toFile(tmp);
  fs.renameSync(tmp, filePath);
}

async function prepareLogo(relPath, maxDim) {
  const filePath = path.join(BRAND_DIR, relPath);
  if (!fs.existsSync(filePath)) {
    console.warn(`SKIP ${relPath} (no existe)`);
    return;
  }

  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  floodClearEdgeBackground(data, info.width, info.height);

  const tmp = `${filePath}.tmp`;
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim({ threshold: 1 })
    .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: false })
    .toFile(tmp);
  fs.renameSync(tmp, filePath);
  await applyMatte(filePath, '#F5E8DC');

  const after = await sharp(filePath).metadata();
  const stat = fs.statSync(filePath);
  console.log(`OK ${relPath} → ${after.width}x${after.height} (${Math.round(stat.size / 1024)} KB)`);
}

function parseHexColor(hex) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

/**
 * Icono launcher Android: lienzo 1024×1024, dibujo centrado en zona segura del círculo adaptativo.
 * @param {object} opts
 * @param {number} [opts.fillRatio=0.72] Máx. fracción del lienzo (escudo: ~0.54).
 * @param {string} [opts.matteHex] RGB en píxeles transparentes (evita halo blanco en launcher Android).
 */
async function prepareAdaptiveIcon(relPath, opts = {}) {
  const canvas = opts.canvas ?? 1024;
  const fillRatio = opts.fillRatio ?? 0.72;
  const matteHex = opts.matteHex ?? null;
  const filePath = path.join(BRAND_DIR, relPath);
  if (!fs.existsSync(filePath)) {
    console.warn(`SKIP ${relPath} (no existe)`);
    return;
  }

  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  floodClearEdgeBackground(data, info.width, info.height);

  const trimmedBuf = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim({ threshold: 1 })
    .png()
    .toBuffer();

  const maxGraphic = Math.round(canvas * fillRatio);
  const graphic = await sharp(trimmedBuf)
    .resize(maxGraphic, maxGraphic, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();

  const tmp = `${filePath}.tmp`;
  await sharp({
    create: {
      width: canvas,
      height: canvas,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: graphic, gravity: 'center' }])
    .png({ compressionLevel: 9, palette: false })
    .toFile(tmp);
  fs.renameSync(tmp, filePath);

  if (matteHex) await applyMatte(filePath, matteHex);

  const stat = fs.statSync(filePath);
  console.log(
    `OK ${relPath} → ${canvas}x${canvas} fill=${Math.round(fillRatio * 100)}% transp (${Math.round(stat.size / 1024)} KB)`,
  );
}


async function prepareSplash(relPath) {
  const filePath = path.join(BRAND_DIR, relPath);
  if (!fs.existsSync(filePath)) {
    console.warn(`SKIP ${relPath}`);
    return;
  }
  const tmp = `${filePath}.tmp`;
  await sharp(filePath)
    .resize(720, 1280, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: true, colors: 128 })
    .toFile(tmp);
  fs.renameSync(tmp, filePath);
  const stat = fs.statSync(filePath);
  console.log(`OK ${relPath} (fondo ${Math.round(stat.size / 1024)} KB)`);
}

function syncAndroidIcons(flavor) {
  const { spawnSync } = require('child_process');
  const r = spawnSync(
    process.execPath,
    [path.join(__dirname, 'sync-android-launcher-icons.cjs')],
    {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, APP_FLAVOR: flavor },
      stdio: 'inherit',
    },
  );
  if (r.status !== 0) {
    throw new Error(`sync-android-launcher-icons (${flavor}) falló`);
  }
}

async function main() {
  await prepareLogo('passenger-logo.png', 800);
  await prepareLogo('driver-logo.png', 800);
  await prepareAdaptiveIcon('passenger-icon.png', { fillRatio: 0.62, matteHex: '#F5E8DC' });
  await prepareAdaptiveIcon('driver-icon.png', { fillRatio: 0.58, matteHex: '#105020' });
  await prepareSplash('passenger-splash-bg.png');
  await prepareSplash('driver-splash-bg.png');
  const flavor = process.env.APP_FLAVOR === 'driver' ? 'driver' : 'passenger';
  syncAndroidIcons(flavor);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
