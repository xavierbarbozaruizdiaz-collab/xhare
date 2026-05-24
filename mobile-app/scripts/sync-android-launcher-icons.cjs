/**
 * Genera android/app/src/main/res/mipmap-* (webp) e ic_launcher.xml desde app.config.js.
 * Splash nativo: logo centrado (no el PNG de fondo decorativo).
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

process.env.APP_FLAVOR = process.env.APP_FLAVOR || 'passenger';

const { getConfig } = require('@expo/config');
const { setIconAsync } = require('@expo/prebuild-config/build/plugins/icons/withAndroidIcons');

function resolveAsset(projectRoot, p) {
  if (!p) return null;
  const rel = p.replace(/^\.\//, '');
  return path.resolve(projectRoot, rel);
}

function writeLauncherBackgroundXml(projectRoot) {
  const bgPath = path.join(projectRoot, 'android/app/src/main/res/drawable/ic_launcher_background.xml');
  fs.mkdirSync(path.dirname(bgPath), { recursive: true });
  fs.writeFileSync(
    bgPath,
    `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
  <item android:drawable="@color/iconBackground"/>
</layer-list>
`,
  );
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

  writeLauncherBackgroundXml(projectRoot);

  const splashLogoRel = exp.splash?.image?.replace(/^\.\//, '') ?? 'assets/brand/passenger-logo.png';
  const splashSrc = path.join(projectRoot, splashLogoRel);
  const splashDst = path.join(projectRoot, 'android/app/src/main/res/drawable/splashscreen_logo.png');
  if (fs.existsSync(splashSrc)) {
    fs.mkdirSync(path.dirname(splashDst), { recursive: true });
    await sharp(splashSrc)
      .resize(880, 880, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: false })
      .toFile(splashDst);
    console.log('splashscreen_logo ←', splashLogoRel);
  }

  const splashBg = exp.splash?.backgroundColor;
  if (splashBg) {
    const colorsPath = path.join(projectRoot, 'android/app/src/main/res/values/colors.xml');
    if (fs.existsSync(colorsPath)) {
      let xml = fs.readFileSync(colorsPath, 'utf8');
      xml = xml.replace(
        /<color name="splashscreen_background">[^<]*<\/color>/,
        `<color name="splashscreen_background">${splashBg}</color>`,
      );
      if (!xml.includes('name="iconBackground"') && adaptive.backgroundColor) {
        xml = xml.replace(
          '</resources>',
          `  <color name="iconBackground">${adaptive.backgroundColor}</color>\n</resources>`,
        );
      } else if (adaptive.backgroundColor) {
        xml = xml.replace(
          /<color name="iconBackground">[^<]*<\/color>/,
          `<color name="iconBackground">${adaptive.backgroundColor}</color>`,
        );
      }
      fs.writeFileSync(colorsPath, xml);
    }
  }

  console.log('Android launcher mipmaps updated (APP_FLAVOR=%s).', process.env.APP_FLAVOR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
