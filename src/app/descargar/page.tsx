import type { Metadata } from 'next';
import { createServiceClient } from '@/lib/supabase/server';
import { DEFAULT_DOWNLOAD_VALUES, DOWNLOAD_SETTINGS_KEYS } from '@/lib/download-links';
import { APP_NAME, pageTitle } from '@/lib/brand';
import { DescargarLanding } from './_components/DescargarLanding';

export const dynamic = 'force-dynamic';

function resolveMetadataBase(): URL {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) {
    try {
      return new URL(fromEnv);
    } catch {
      // ignore invalid URL
    }
  }
  if (process.env.VERCEL_URL) {
    return new URL(`https://${process.env.VERCEL_URL}`);
  }
  return new URL('http://localhost:3000');
}

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title: pageTitle('Descargar — Traslados en Central, Paraguay'),
  description: `Descargá el APK oficial de ${APP_NAME} para pasajeros y conductores. Canal seguro para operar en Central, Paraguay.`,
  openGraph: {
    title: pageTitle('Traslados en Central, Paraguay'),
    description: 'Descarga oficial (Android APK) para pasajeros y conductores.',
    type: 'website',
    locale: 'es_PY',
    url: '/descargar',
  },
  twitter: {
    card: 'summary_large_image',
    title: pageTitle('Traslados en Central, Paraguay'),
    description: 'Descarga oficial (Android APK) para pasajeros y conductores.',
  },
  alternates: {
    canonical: '/descargar',
  },
};

export default async function DownloadPage() {
  const service = createServiceClient();
  const keys = Object.values(DOWNLOAD_SETTINGS_KEYS);
  const { data } = await service.from('settings').select('key, value').in('key', keys);

  const values = new Map<string, unknown>();
  for (const row of data ?? []) values.set(String(row.key), row.value);

  const passengerApkUrl = String(
    values.get(DOWNLOAD_SETTINGS_KEYS.passengerApkUrl) ?? DEFAULT_DOWNLOAD_VALUES.passengerApkUrl
  ).trim();
  const driverApkUrl = String(
    values.get(DOWNLOAD_SETTINGS_KEYS.driverApkUrl) ?? DEFAULT_DOWNLOAD_VALUES.driverApkUrl
  ).trim();
  const passengerVersion = String(
    values.get(DOWNLOAD_SETTINGS_KEYS.passengerVersion) ?? DEFAULT_DOWNLOAD_VALUES.passengerVersion
  ).trim();
  const driverVersion = String(
    values.get(DOWNLOAD_SETTINGS_KEYS.driverVersion) ?? DEFAULT_DOWNLOAD_VALUES.driverVersion
  ).trim();
  const installGuideUrl = String(
    values.get(DOWNLOAD_SETTINGS_KEYS.installGuideUrl) ?? DEFAULT_DOWNLOAD_VALUES.installGuideUrl
  ).trim();
  const playStoreUrl = String(
    values.get(DOWNLOAD_SETTINGS_KEYS.playStoreUrl) ?? DEFAULT_DOWNLOAD_VALUES.playStoreUrl
  ).trim();
  const appStoreUrl = String(
    values.get(DOWNLOAD_SETTINGS_KEYS.appStoreUrl) ?? DEFAULT_DOWNLOAD_VALUES.appStoreUrl
  ).trim();
  const heroImageUrl = String(
    values.get(DOWNLOAD_SETTINGS_KEYS.heroImageUrl) ?? DEFAULT_DOWNLOAD_VALUES.heroImageUrl
  ).trim();
  const heroImageUrls = [
    heroImageUrl,
    String(values.get(DOWNLOAD_SETTINGS_KEYS.heroImage2Url) ?? DEFAULT_DOWNLOAD_VALUES.heroImage2Url).trim(),
    String(values.get(DOWNLOAD_SETTINGS_KEYS.heroImage3Url) ?? DEFAULT_DOWNLOAD_VALUES.heroImage3Url).trim(),
    String(values.get(DOWNLOAD_SETTINGS_KEYS.heroImage4Url) ?? DEFAULT_DOWNLOAD_VALUES.heroImage4Url).trim(),
    String(values.get(DOWNLOAD_SETTINGS_KEYS.heroImage5Url) ?? DEFAULT_DOWNLOAD_VALUES.heroImage5Url).trim(),
  ];
  const screenshotUrls = [
    String(values.get(DOWNLOAD_SETTINGS_KEYS.screenshot1Url) ?? DEFAULT_DOWNLOAD_VALUES.screenshot1Url).trim(),
    String(values.get(DOWNLOAD_SETTINGS_KEYS.screenshot2Url) ?? DEFAULT_DOWNLOAD_VALUES.screenshot2Url).trim(),
    String(values.get(DOWNLOAD_SETTINGS_KEYS.screenshot3Url) ?? DEFAULT_DOWNLOAD_VALUES.screenshot3Url).trim(),
    String(values.get(DOWNLOAD_SETTINGS_KEYS.screenshot4Url) ?? DEFAULT_DOWNLOAD_VALUES.screenshot4Url).trim(),
    String(values.get(DOWNLOAD_SETTINGS_KEYS.screenshot5Url) ?? DEFAULT_DOWNLOAD_VALUES.screenshot5Url).trim(),
  ];
  const defaultTheme = String(
    values.get(DOWNLOAD_SETTINGS_KEYS.defaultTheme) ?? DEFAULT_DOWNLOAD_VALUES.defaultTheme
  ).trim();

  const whatsappFromDb = String(
    values.get(DOWNLOAD_SETTINGS_KEYS.whatsappSupportUrl) ?? DEFAULT_DOWNLOAD_VALUES.whatsappSupportUrl
  ).trim();
  const whatsappUrl =
    whatsappFromDb || String(process.env.NEXT_PUBLIC_DOWNLOAD_WHATSAPP_URL ?? '').trim();

  return (
    <DescargarLanding
      passengerApkUrl={passengerApkUrl}
      driverApkUrl={driverApkUrl}
      passengerVersion={passengerVersion}
      driverVersion={driverVersion}
      installGuideUrl={installGuideUrl}
      whatsappUrl={whatsappUrl}
      playStoreUrl={playStoreUrl}
      appStoreUrl={appStoreUrl}
      heroImageUrls={heroImageUrls}
      screenshotUrls={screenshotUrls}
      defaultTheme={defaultTheme}
    />
  );
}
