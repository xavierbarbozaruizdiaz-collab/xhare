/**
 * Quita el damero gris/blanco horneado en PNG exportados sin canal alpha real.
 * Uso: npm run brand:fix-png
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const BRAND_DIR = path.join(__dirname, '..', 'assets', 'brand');
/** Color de fondo de la app: píxeles transparentes con este RGB evitan halo negro en Android. */
const MATTE_RGB = [245, 232, 220];

/** Solo píxeles casi grises (damero / halo de exportación). */
function isCheckerboardBackground(r, g, b) {
  const chroma = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
  if (chroma > 14) return false;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum >= 178) return true;
  if (lum >= 112 && lum <= 132) return true;
  return false;
}

function removeCheckerboardPixels(data) {
  for (let i = 0; i < data.length; i += 4) {
    if (isCheckerboardBackground(data[i], data[i + 1], data[i + 2])) {
      data[i + 3] = 0;
    }
  }
}

/** Restos del damero rodeados de transparencia (p. ej. parabrisas). */
/** Desde el borde, elimina damero/halo conectado (no toca ventanas crema del bus). */
function floodClearBackground(data, width, height) {
  const w = width;
  const h = height;
  const visited = new Uint8Array(w * h);
  const queue = [];

  function tryPush(x, y) {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const idx = y * w + x;
    if (visited[idx]) return;
    const i = idx * 4;
    const a = data[i + 3];
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (a < 16 || isCheckerboardBackground(r, g, b)) {
      visited[idx] = 1;
      queue.push(idx);
    }
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

const WINDOW_CREAM = [253, 224, 208];
const TEXT_GRAY = [76, 105, 113];

function isBusGreen(r, g, b) {
  return g > r + 25 && g > b + 25 && g >= 120 && r < 120;
}

function isTextGray(r, g, b) {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum >= 55 && lum <= 150 && Math.max(Math.abs(r - g), Math.abs(g - b)) < 35;
}

/** Damero atrapado dentro del dibujo (parabrisas, tipografía). */
function fillInteriorSpeckles(data, width, height) {
  const w = width;
  const h = height;
  const neighbors = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
  ];

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (!isCheckerboardBackground(data[i], data[i + 1], data[i + 2])) continue;

      let nearGreen = false;
      let nearText = false;
      for (const [dx, dy] of neighbors) {
        const ni = ((y + dy) * w + (x + dx)) * 4;
        if (data[ni + 3] < 16) continue;
        const r = data[ni];
        const g = data[ni + 1];
        const b = data[ni + 2];
        if (isBusGreen(r, g, b)) nearGreen = true;
        if (isTextGray(r, g, b)) nearText = true;
      }

      if (nearGreen) {
        data[i] = WINDOW_CREAM[0];
        data[i + 1] = WINDOW_CREAM[1];
        data[i + 2] = WINDOW_CREAM[2];
        data[i + 3] = 255;
      } else if (nearText) {
        data[i] = TEXT_GRAY[0];
        data[i + 1] = TEXT_GRAY[1];
        data[i + 2] = TEXT_GRAY[2];
        data[i + 3] = 255;
      }
    }
  }
}

function removeStragglerCheckerboard(data, width, height) {
  const w = width;
  const h = height;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 16) continue;
      if (!isCheckerboardBackground(data[i], data[i + 1], data[i + 2])) continue;
      let transparentNeighbors = 0;
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [-1, -1],
        [1, 1],
        [-1, 1],
        [1, -1],
      ]) {
        const ni = ((y + dy) * w + (x + dx)) * 4;
        if (data[ni + 3] < 32) transparentNeighbors++;
      }
      if (transparentNeighbors >= 3) data[i + 3] = 0;
    }
  }
}

async function applyMatteTransparency(filePath) {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 16) {
      data[i] = MATTE_RGB[0];
      data[i + 1] = MATTE_RGB[1];
      data[i + 2] = MATTE_RGB[2];
      data[i + 3] = 0;
    }
  }
  const tmpPath = `${filePath}.matte.tmp`;
  await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png({ compressionLevel: 9, effort: 10, palette: false })
    .toFile(tmpPath);
  fs.renameSync(tmpPath, filePath);
}

async function fixTransparentAsset(relPath, maxDim) {
  const filePath = path.join(BRAND_DIR, relPath);
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  removeCheckerboardPixels(data);
  floodClearBackground(data, info.width, info.height);
  fillInteriorSpeckles(data, info.width, info.height);
  removeStragglerCheckerboard(data, info.width, info.height);
  removeCheckerboardPixels(data);
  const tmpPath = `${filePath}.tmp`;
  await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9, effort: 10, palette: false })
    .toFile(tmpPath);

  fs.renameSync(tmpPath, filePath);
  if (relPath.includes('logo')) {
    await applyMatteTransparency(filePath);
  }
  const after = await sharp(filePath).metadata();
  const stat = fs.statSync(filePath);
  console.log(`OK ${relPath} → ${after.width}x${after.height} (${Math.round(stat.size / 1024)} KB)`);
}

async function main() {
  const targets = [
    { file: 'passenger-logo.png', maxDim: 1200 },
    { file: 'passenger-icon.png', maxDim: 512 },
    { file: 'driver-logo.png', maxDim: 1200 },
    { file: 'driver-icon.png', maxDim: 512 },
  ];

  for (const t of targets) {
    await fixTransparentAsset(t.file, t.maxDim);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
