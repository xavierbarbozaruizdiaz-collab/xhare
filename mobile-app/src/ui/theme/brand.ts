import type { AppFlavor } from '../../core/flavor';
import { getAppFlavor } from '../../core/flavor';

export type BrandTheme = {
  flavor: AppFlavor;
  appName: string;
  tagline: string;
  logo: number;
  icon: number;
  colors: {
    primary: string;
    primaryMuted: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    textMuted: string;
    border: string;
    greenLight: string;
    accentLight: string;
    tabActive: string;
    headerBg: string;
    headerTint: string;
    danger: string;
    white: string;
  };
  fonts: {
    regular: string;
    medium: string;
    semibold: string;
  };
};

const PASSENGER_LOGO = require('../../../assets/brand/passenger-logo.png');
const PASSENGER_ICON = require('../../../assets/brand/passenger-icon.png');
const DRIVER_LOGO = require('../../../assets/brand/driver-logo.png');
const DRIVER_ICON = require('../../../assets/brand/driver-icon.png');

const PASSENGER_THEME: BrandTheme = {
  flavor: 'passenger',
  appName: 'ÑandeBus',
  tagline: '¡Tu viaje seguro!',
  logo: PASSENGER_LOGO,
  icon: PASSENGER_ICON,
  colors: {
    primary: '#20A050',
    primaryMuted: '#1a8844',
    accent: '#FF8C00',
    background: '#F8F9FB',
    surface: '#FFFFFF',
    text: '#2F2F2F',
    textMuted: '#6b7280',
    border: '#E1E1E1',
    greenLight: '#B2E8C0',
    accentLight: '#FFF0E1',
    tabActive: '#20A050',
    headerBg: '#20A050',
    headerTint: '#FFFFFF',
    danger: '#b91c1c',
    white: '#FFFFFF',
  },
  fonts: {
    regular: 'Montserrat_400Regular',
    medium: 'Montserrat_500Medium',
    semibold: 'Montserrat_600SemiBold',
  },
};

const DRIVER_THEME: BrandTheme = {
  flavor: 'driver',
  appName: 'ÑandeBus Driver',
  tagline: '¡Profesionalismo y Control!',
  logo: DRIVER_LOGO,
  icon: DRIVER_ICON,
  colors: {
    primary: '#105020',
    primaryMuted: '#0d4019',
    accent: '#FF6000',
    background: '#F0F2F5',
    surface: '#FFFFFF',
    text: '#2F2F2F',
    textMuted: '#6b7280',
    border: '#E0E0E0',
    greenLight: '#c5d4bc',
    accentLight: '#FFE8D6',
    tabActive: '#105020',
    headerBg: '#105020',
    headerTint: '#FFFFFF',
    danger: '#b91c1c',
    white: '#FFFFFF',
  },
  fonts: {
    regular: 'Montserrat_400Regular',
    medium: 'Montserrat_500Medium',
    semibold: 'Montserrat_600SemiBold',
  },
};

export function getBrandTheme(flavor?: AppFlavor): BrandTheme {
  const f = flavor ?? getAppFlavor();
  return f === 'driver' ? DRIVER_THEME : PASSENGER_THEME;
}

/** Tema del binario actual (cada APK carga un solo flavor). */
export const appBrand = getBrandTheme();
