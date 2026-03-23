/**
 * Genera android/app/src/main/res/mipmap-* (webp) e ic_launcher.xml desde app.config.js.
 * Debe ejecutarse con APP_FLAVOR=passenger para dejar en el repo el baseline full-color;
 * el flavor driver intercambia foreground en Gradle al compilar.
 */
const fs = require('fs');
const path = require('path');

process.env.APP_FLAVOR = process.env.APP_FLAVOR || 'passenger';

const { getConfig } = require('@expo/config');
const { setIconAsync } = require('@expo/prebuild-config/build/plugins/icons/withAndroidIcons');

function resolveAsset(projectRoot, p) {
  if (!p) return null;
  const rel = p.replace(/^\.\//, '');
  return path.resolve(projectRoot, rel);
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const { exp } = getConfig(projectRoot, {
    skipSDKVersionRequirement: true,
    isPublicConfig: false,
  });

  const adaptive = exp.android?.adaptiveIcon;
  if (!adaptive?.foregroundImage) {
    console.error('Resolved Expo config has no android.adaptiveIcon.foregroundImage.');
    process.exit(1);
  }

  await setIconAsync(projectRoot, {
    icon: resolveAsset(projectRoot, adaptive.foregroundImage),
    backgroundColor: adaptive.backgroundColor ?? null,
    backgroundImage: resolveAsset(projectRoot, adaptive.backgroundImage),
    monochromeImage: resolveAsset(projectRoot, adaptive.monochromeImage),
    isAdaptive: true,
  });

  const splashSrc = path.join(projectRoot, 'assets', 'splash-icon.png');
  const splashDst = path.join(
    projectRoot,
    'android/app/src/main/res/drawable/splashscreen_logo.png',
  );
  if (fs.existsSync(splashSrc)) {
    fs.mkdirSync(path.dirname(splashDst), { recursive: true });
    fs.copyFileSync(splashSrc, splashDst);
  }

  console.log(
    'Android launcher mipmaps updated (APP_FLAVOR=%s).',
    process.env.APP_FLAVOR,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
