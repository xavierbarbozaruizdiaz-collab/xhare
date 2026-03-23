// @ts-check
/**
 * En Windows, Metro a veces crashea si vigila `android/.cxx` (CMake borra subcarpetas
 * durante el build → ENOENT en el FallbackWatcher). Excluimos salidas nativas del crawl.
 */
const { getDefaultConfig } = require('expo/metro-config');

module.exports = (() => {
  const config = getDefaultConfig(__dirname);
  const base = config.resolver.blockList;
  const androidNativeOut = [
    /android[\\/]\.cxx([\\/].*)?$/,
    /android[\\/]app[\\/]build([\\/].*)?$/,
    /android[\\/]build([\\/].*)?$/,
    /android[\\/]\.gradle([\\/].*)?$/,
  ];
  config.resolver.blockList = [
    ...androidNativeOut,
    ...(Array.isArray(base) ? base : base ? [base] : []),
  ];
  return config;
})();
