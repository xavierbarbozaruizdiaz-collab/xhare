export const DOWNLOAD_SETTINGS_KEYS = {
  passengerApkUrl: 'download_passenger_apk_url',
  driverApkUrl: 'download_driver_apk_url',
  passengerVersion: 'download_passenger_version',
  driverVersion: 'download_driver_version',
  installGuideUrl: 'download_install_guide_url',
} as const;

export const DEFAULT_DOWNLOAD_VALUES = {
  passengerApkUrl: '',
  driverApkUrl: '',
  passengerVersion: '',
  driverVersion: '',
  installGuideUrl: '',
} as const;
