export const DOWNLOAD_SETTINGS_KEYS = {
  passengerApkUrl: 'download_passenger_apk_url',
  driverApkUrl: 'download_driver_apk_url',
  passengerVersion: 'download_passenger_version',
  driverVersion: 'download_driver_version',
  installGuideUrl: 'download_install_guide_url',
  /** Full URL: https://wa.me/5959XXXXXXXX or https://api.whatsapp.com/send?phone=... */
  whatsappSupportUrl: 'download_whatsapp_support_url',
  playStoreUrl: 'download_play_store_url',
  appStoreUrl: 'download_app_store_url',
  heroImageUrl: 'download_hero_image_url',
  screenshot1Url: 'download_screenshot_1_url',
  screenshot2Url: 'download_screenshot_2_url',
  screenshot3Url: 'download_screenshot_3_url',
  screenshot4Url: 'download_screenshot_4_url',
} as const;

export const DEFAULT_DOWNLOAD_VALUES = {
  passengerApkUrl: '',
  driverApkUrl: '',
  passengerVersion: '',
  driverVersion: '',
  installGuideUrl: '',
  whatsappSupportUrl: '',
  playStoreUrl: '',
  appStoreUrl: '',
  heroImageUrl: '',
  screenshot1Url: '',
  screenshot2Url: '',
  screenshot3Url: '',
  screenshot4Url: '',
} as const;
