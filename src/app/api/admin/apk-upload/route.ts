import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminUserFromRequest, logBlockError, logBlockOk } from '@/lib/admin-auth';
import { DOWNLOAD_SETTINGS_KEYS } from '@/lib/download-links';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const BLOCK = 'admin-apk-upload';
const MAX_APK_BYTES = 100 * 1024 * 1024;
const APK_PATH = /^apks\/(passenger|driver)-\d+\.apk$/;

async function persistApkUrl(track: 'passenger' | 'driver', url: string) {
  const key =
    track === 'passenger' ? DOWNLOAD_SETTINGS_KEYS.passengerApkUrl : DOWNLOAD_SETTINGS_KEYS.driverApkUrl;
  const nowIso = new Date().toISOString();
  const service = createServiceClient();
  const { error } = await service.from('settings').upsert({ key, value: url, updated_at: nowIso }, { onConflict: 'key' });
  if (error) {
    const updated = await service.from('settings').update({ value: url, updated_at: nowIso }).eq('key', key);
    if (updated.error) throw updated.error;
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const admin = await getAdminUserFromRequest(request);
        if (!admin) throw new Error('Solo un administrador puede subir el APK.');
        if (!APK_PATH.test(pathname)) throw new Error('Ruta de APK inválida.');
        let track: 'passenger' | 'driver' | null = null;
        try {
          const parsed = clientPayload ? (JSON.parse(clientPayload) as { track?: string }) : {};
          if (parsed.track === 'passenger' || parsed.track === 'driver') track = parsed.track;
        } catch {
          track = null;
        }
        const fromPath = pathname.includes('passenger') ? 'passenger' : pathname.includes('driver') ? 'driver' : null;
        const resolved = track ?? fromPath;
        if (!resolved) throw new Error('Indicá si el APK es de pasajero o conductor.');

        return {
          allowedContentTypes: ['application/vnd.android.package-archive', 'application/octet-stream'],
          addRandomSuffix: true,
          maximumSizeInBytes: MAX_APK_BYTES,
          tokenPayload: JSON.stringify({ track: resolved, adminId: admin.id }),
        };
      },
        onUploadCompleted: async ({ blob, tokenPayload }) => {
          try {
            const parsed = tokenPayload ? (JSON.parse(tokenPayload) as { track?: string }) : {};
            if (parsed.track === 'passenger' || parsed.track === 'driver') {
              await persistApkUrl(parsed.track, blob.downloadUrl || blob.url);
            }
            logBlockOk(BLOCK);
          } catch (error) {
            logBlockError(BLOCK, error instanceof Error ? error.message : 'persist failed', error);
          }
        },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    logBlockError(BLOCK, error instanceof Error ? error.message : 'upload failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo subir el APK.' },
      { status: 400 }
    );
  }
}
