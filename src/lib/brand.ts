/** Identidad visible ÑandeBus (web). Slugs técnicos xhare/* no se cambian aquí. */
export const APP_NAME = 'ÑandeBus';
export const APP_NAME_DRIVER = 'ÑandeBus Driver';
export const APP_NAME_ADMIN = 'ÑandeBus Admin';
export const APP_TAGLINE = '¡Tu viaje seguro!';
export const APP_TAGLINE_DRIVER = '¡Profesionalismo y Control!';

export const BRAND_PRIMARY = '#20A050';
export const BRAND_PRIMARY_CLASS = 'text-[#20A050]';

export const siteMetadata = {
  title: `${APP_NAME} - Transporte de Pasajeros`,
  description: 'Sistema de transporte compartido con minibuses en Paraguay',
} as const;

export function pageTitle(suffix: string): string {
  return `${suffix} — ${APP_NAME}`;
}

/** User-Agent para APIs externas (Nominatim, etc.) */
export const GEOCODE_USER_AGENT =
  'NandeBusTransporte/1.0 (https://github.com/xhare-transporte)';
