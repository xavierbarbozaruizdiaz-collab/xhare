import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/server';
import { DEFAULT_DOWNLOAD_VALUES, DOWNLOAD_SETTINGS_KEYS } from '@/lib/download-links';

export const dynamic = 'force-dynamic';

export default async function DownloadPage() {
  const service = createServiceClient();
  const keys = Object.values(DOWNLOAD_SETTINGS_KEYS);
  const { data } = await service.from('settings').select('key, value').in('key', keys);

  const values = new Map<string, unknown>();
  for (const row of data ?? []) values.set(String(row.key), row.value);

  const passengerApkUrl = String(values.get(DOWNLOAD_SETTINGS_KEYS.passengerApkUrl) ?? DEFAULT_DOWNLOAD_VALUES.passengerApkUrl).trim();
  const driverApkUrl = String(values.get(DOWNLOAD_SETTINGS_KEYS.driverApkUrl) ?? DEFAULT_DOWNLOAD_VALUES.driverApkUrl).trim();
  const passengerVersion = String(values.get(DOWNLOAD_SETTINGS_KEYS.passengerVersion) ?? DEFAULT_DOWNLOAD_VALUES.passengerVersion).trim();
  const driverVersion = String(values.get(DOWNLOAD_SETTINGS_KEYS.driverVersion) ?? DEFAULT_DOWNLOAD_VALUES.driverVersion).trim();
  const installGuideUrl = String(values.get(DOWNLOAD_SETTINGS_KEYS.installGuideUrl) ?? DEFAULT_DOWNLOAD_VALUES.installGuideUrl).trim();

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Descargar Xhare</h1>
        <p className="text-gray-600 mb-6">
          Elegí la app que corresponde. Descargá solo desde esta página oficial.
        </p>

        <div className="grid grid-cols-1 gap-4">
          <section className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Pasajeros</h2>
            <p className="text-sm text-gray-600 mb-4">
              App para buscar viajes y reservar asiento.
              {passengerVersion ? ` Versión actual: ${passengerVersion}.` : ''}
            </p>
            {passengerApkUrl ? (
              <a
                href={passengerApkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                Descargar APK pasajero
              </a>
            ) : (
              <p className="text-sm text-amber-700">Descarga no disponible por el momento.</p>
            )}
          </section>

          <section className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Conductores</h2>
            <p className="text-sm text-gray-600 mb-4">
              App para publicar viajes y gestionar pasajeros.
              {driverVersion ? ` Versión actual: ${driverVersion}.` : ''}
            </p>
            {driverApkUrl ? (
              <a
                href={driverApkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                Descargar APK conductor
              </a>
            ) : (
              <p className="text-sm text-amber-700">Descarga no disponible por el momento.</p>
            )}
          </section>
        </div>

        <div className="mt-6 text-sm text-gray-600 bg-white border border-gray-200 rounded-xl p-4">
          <p className="mb-2">
            Instalación en Android: abrí el APK descargado y habilitá instalación desde origen desconocido cuando el sistema lo solicite.
          </p>
          {installGuideUrl ? (
            <a
              href={installGuideUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-700 underline"
            >
              Ver guía de instalación segura
            </a>
          ) : null}
          <p className="mt-2">
            ¿Problemas para instalar? <Link href="/login" className="text-green-700 underline">Contactá soporte desde la app web</Link>.
          </p>
        </div>
      </div>
    </main>
  );
}
