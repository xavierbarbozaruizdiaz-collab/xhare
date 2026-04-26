'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import {
  DEFAULT_PRIVACY_CONTENT,
  DEFAULT_PRIVACY_VERSION,
  DEFAULT_TERMS_CONTENT,
  DEFAULT_TERMS_VERSION,
  interpolateLegalTemplate,
  LEGAL_SETTINGS_KEYS,
} from '@/lib/legal-documents';
import { DEFAULT_DOWNLOAD_VALUES, DOWNLOAD_SETTINGS_KEYS } from '@/lib/download-links';

const KEY = 'driver_pending_instructions';
const SHORTCUTS_KEY = 'passenger_home_shortcuts_visible';
const FAVORITES_TITLE_KEY = 'passenger_home_favorites_title';
const FAVORITES_SUBTITLE_KEY = 'passenger_home_favorites_subtitle';

function parseShortcutsVisible(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  return true;
}

export default function AdminSettingsPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const [shortcutsVisible, setShortcutsVisible] = useState(true);
  const [shortcutsLoading, setShortcutsLoading] = useState(true);
  const [shortcutsSaving, setShortcutsSaving] = useState(false);
  const [shortcutsDone, setShortcutsDone] = useState(false);
  const [favoritesTitle, setFavoritesTitle] = useState('');
  const [favoritesSubtitle, setFavoritesSubtitle] = useState('');
  const [favoritesCopyLoading, setFavoritesCopyLoading] = useState(true);
  const [favoritesCopySaving, setFavoritesCopySaving] = useState(false);
  const [favoritesCopyDone, setFavoritesCopyDone] = useState(false);
  const [legalLoading, setLegalLoading] = useState(true);
  const [legalSaving, setLegalSaving] = useState(false);
  const [legalDone, setLegalDone] = useState(false);
  const [termsVersion, setTermsVersion] = useState(DEFAULT_TERMS_VERSION);
  const [privacyVersion, setPrivacyVersion] = useState(DEFAULT_PRIVACY_VERSION);
  const [termsContent, setTermsContent] = useState(
    interpolateLegalTemplate(DEFAULT_TERMS_CONTENT, DEFAULT_TERMS_VERSION)
  );
  const [privacyContent, setPrivacyContent] = useState(
    interpolateLegalTemplate(DEFAULT_PRIVACY_CONTENT, DEFAULT_PRIVACY_VERSION)
  );
  const [downloadLoading, setDownloadLoading] = useState(true);
  const [downloadSaving, setDownloadSaving] = useState(false);
  const [downloadDone, setDownloadDone] = useState(false);
  const [passengerApkUrl, setPassengerApkUrl] = useState<string>(DEFAULT_DOWNLOAD_VALUES.passengerApkUrl);
  const [driverApkUrl, setDriverApkUrl] = useState<string>(DEFAULT_DOWNLOAD_VALUES.driverApkUrl);
  const [passengerVersion, setPassengerVersion] = useState<string>(DEFAULT_DOWNLOAD_VALUES.passengerVersion);
  const [driverVersion, setDriverVersion] = useState<string>(DEFAULT_DOWNLOAD_VALUES.driverVersion);
  const [installGuideUrl, setInstallGuideUrl] = useState<string>(DEFAULT_DOWNLOAD_VALUES.installGuideUrl);
  const [whatsappSupportUrl, setWhatsappSupportUrl] = useState<string>(DEFAULT_DOWNLOAD_VALUES.whatsappSupportUrl);
  const [playStoreUrl, setPlayStoreUrl] = useState<string>(DEFAULT_DOWNLOAD_VALUES.playStoreUrl);
  const [appStoreUrl, setAppStoreUrl] = useState<string>(DEFAULT_DOWNLOAD_VALUES.appStoreUrl);
  const [heroImageUrl, setHeroImageUrl] = useState<string>(DEFAULT_DOWNLOAD_VALUES.heroImageUrl);
  const [heroImage2Url, setHeroImage2Url] = useState<string>(DEFAULT_DOWNLOAD_VALUES.heroImage2Url);
  const [heroImage3Url, setHeroImage3Url] = useState<string>(DEFAULT_DOWNLOAD_VALUES.heroImage3Url);
  const [heroImage4Url, setHeroImage4Url] = useState<string>(DEFAULT_DOWNLOAD_VALUES.heroImage4Url);
  const [heroImage5Url, setHeroImage5Url] = useState<string>(DEFAULT_DOWNLOAD_VALUES.heroImage5Url);
  const [screenshot1Url, setScreenshot1Url] = useState<string>(DEFAULT_DOWNLOAD_VALUES.screenshot1Url);
  const [screenshot2Url, setScreenshot2Url] = useState<string>(DEFAULT_DOWNLOAD_VALUES.screenshot2Url);
  const [screenshot3Url, setScreenshot3Url] = useState<string>(DEFAULT_DOWNLOAD_VALUES.screenshot3Url);
  const [screenshot4Url, setScreenshot4Url] = useState<string>(DEFAULT_DOWNLOAD_VALUES.screenshot4Url);
  const [screenshot5Url, setScreenshot5Url] = useState<string>(DEFAULT_DOWNLOAD_VALUES.screenshot5Url);
  const [defaultTheme, setDefaultTheme] = useState<string>(DEFAULT_DOWNLOAD_VALUES.defaultTheme);
  const [mediaBucket, setMediaBucket] = useState<string>(DEFAULT_DOWNLOAD_VALUES.mediaBucket);
  const [uploadingField, setUploadingField] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('settings').select('value').eq('key', KEY).maybeSingle();
      const v = (data?.value as { email?: string; message?: string }) ?? {};
      setEmail(typeof v.email === 'string' ? v.email : '');
      setMessage(typeof v.message === 'string' ? v.message : '');
    })().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    (async () => {
      const [
        passengerApkRes,
        driverApkRes,
        passengerVerRes,
        driverVerRes,
        guideRes,
        whatsappRes,
        playRes,
        appRes,
        heroImageRes,
        heroImage2Res,
        heroImage3Res,
        heroImage4Res,
        heroImage5Res,
        screenshot1Res,
        screenshot2Res,
        screenshot3Res,
        screenshot4Res,
        screenshot5Res,
        defaultThemeRes,
        mediaBucketRes,
      ] = await Promise.all([
        supabase.from('settings').select('value').eq('key', DOWNLOAD_SETTINGS_KEYS.passengerApkUrl).maybeSingle(),
        supabase.from('settings').select('value').eq('key', DOWNLOAD_SETTINGS_KEYS.driverApkUrl).maybeSingle(),
        supabase.from('settings').select('value').eq('key', DOWNLOAD_SETTINGS_KEYS.passengerVersion).maybeSingle(),
        supabase.from('settings').select('value').eq('key', DOWNLOAD_SETTINGS_KEYS.driverVersion).maybeSingle(),
        supabase.from('settings').select('value').eq('key', DOWNLOAD_SETTINGS_KEYS.installGuideUrl).maybeSingle(),
        supabase.from('settings').select('value').eq('key', DOWNLOAD_SETTINGS_KEYS.whatsappSupportUrl).maybeSingle(),
        supabase.from('settings').select('value').eq('key', DOWNLOAD_SETTINGS_KEYS.playStoreUrl).maybeSingle(),
        supabase.from('settings').select('value').eq('key', DOWNLOAD_SETTINGS_KEYS.appStoreUrl).maybeSingle(),
        supabase.from('settings').select('value').eq('key', DOWNLOAD_SETTINGS_KEYS.heroImageUrl).maybeSingle(),
        supabase.from('settings').select('value').eq('key', DOWNLOAD_SETTINGS_KEYS.heroImage2Url).maybeSingle(),
        supabase.from('settings').select('value').eq('key', DOWNLOAD_SETTINGS_KEYS.heroImage3Url).maybeSingle(),
        supabase.from('settings').select('value').eq('key', DOWNLOAD_SETTINGS_KEYS.heroImage4Url).maybeSingle(),
        supabase.from('settings').select('value').eq('key', DOWNLOAD_SETTINGS_KEYS.heroImage5Url).maybeSingle(),
        supabase.from('settings').select('value').eq('key', DOWNLOAD_SETTINGS_KEYS.screenshot1Url).maybeSingle(),
        supabase.from('settings').select('value').eq('key', DOWNLOAD_SETTINGS_KEYS.screenshot2Url).maybeSingle(),
        supabase.from('settings').select('value').eq('key', DOWNLOAD_SETTINGS_KEYS.screenshot3Url).maybeSingle(),
        supabase.from('settings').select('value').eq('key', DOWNLOAD_SETTINGS_KEYS.screenshot4Url).maybeSingle(),
        supabase.from('settings').select('value').eq('key', DOWNLOAD_SETTINGS_KEYS.screenshot5Url).maybeSingle(),
        supabase.from('settings').select('value').eq('key', DOWNLOAD_SETTINGS_KEYS.defaultTheme).maybeSingle(),
        supabase.from('settings').select('value').eq('key', DOWNLOAD_SETTINGS_KEYS.mediaBucket).maybeSingle(),
      ]);

      setPassengerApkUrl(typeof passengerApkRes.data?.value === 'string' ? passengerApkRes.data.value : '');
      setDriverApkUrl(typeof driverApkRes.data?.value === 'string' ? driverApkRes.data.value : '');
      setPassengerVersion(typeof passengerVerRes.data?.value === 'string' ? passengerVerRes.data.value : '');
      setDriverVersion(typeof driverVerRes.data?.value === 'string' ? driverVerRes.data.value : '');
      setInstallGuideUrl(typeof guideRes.data?.value === 'string' ? guideRes.data.value : '');
      setWhatsappSupportUrl(typeof whatsappRes.data?.value === 'string' ? whatsappRes.data.value : '');
      setPlayStoreUrl(typeof playRes.data?.value === 'string' ? playRes.data.value : '');
      setAppStoreUrl(typeof appRes.data?.value === 'string' ? appRes.data.value : '');
      setHeroImageUrl(typeof heroImageRes.data?.value === 'string' ? heroImageRes.data.value : '');
      setHeroImage2Url(typeof heroImage2Res.data?.value === 'string' ? heroImage2Res.data.value : '');
      setHeroImage3Url(typeof heroImage3Res.data?.value === 'string' ? heroImage3Res.data.value : '');
      setHeroImage4Url(typeof heroImage4Res.data?.value === 'string' ? heroImage4Res.data.value : '');
      setHeroImage5Url(typeof heroImage5Res.data?.value === 'string' ? heroImage5Res.data.value : '');
      setScreenshot1Url(typeof screenshot1Res.data?.value === 'string' ? screenshot1Res.data.value : '');
      setScreenshot2Url(typeof screenshot2Res.data?.value === 'string' ? screenshot2Res.data.value : '');
      setScreenshot3Url(typeof screenshot3Res.data?.value === 'string' ? screenshot3Res.data.value : '');
      setScreenshot4Url(typeof screenshot4Res.data?.value === 'string' ? screenshot4Res.data.value : '');
      setScreenshot5Url(typeof screenshot5Res.data?.value === 'string' ? screenshot5Res.data.value : '');
      setDefaultTheme(typeof defaultThemeRes.data?.value === 'string' ? defaultThemeRes.data.value : 'system');
      setMediaBucket(typeof mediaBucketRes.data?.value === 'string' ? mediaBucketRes.data.value : 'app-releases');
    })().finally(() => setDownloadLoading(false));
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('settings').select('value').eq('key', SHORTCUTS_KEY).maybeSingle();
      setShortcutsVisible(parseShortcutsVisible(data?.value));
    })().finally(() => setShortcutsLoading(false));
  }, []);

  useEffect(() => {
    (async () => {
      const [titleRes, subtitleRes] = await Promise.all([
        supabase.from('settings').select('value').eq('key', FAVORITES_TITLE_KEY).maybeSingle(),
        supabase.from('settings').select('value').eq('key', FAVORITES_SUBTITLE_KEY).maybeSingle(),
      ]);
      const titleRaw = titleRes.data?.value;
      const subtitleRaw = subtitleRes.data?.value;
      setFavoritesTitle(typeof titleRaw === 'string' ? titleRaw : '');
      setFavoritesSubtitle(typeof subtitleRaw === 'string' ? subtitleRaw : '');
    })().finally(() => setFavoritesCopyLoading(false));
  }, []);

  useEffect(() => {
    (async () => {
      const {
        termsContent,
        termsVersion,
        privacyContent,
        privacyVersion,
      } = LEGAL_SETTINGS_KEYS;
      const [termsContentRes, termsVersionRes, privacyContentRes, privacyVersionRes] =
        await Promise.all([
          supabase.from('settings').select('value').eq('key', termsContent).maybeSingle(),
          supabase.from('settings').select('value').eq('key', termsVersion).maybeSingle(),
          supabase.from('settings').select('value').eq('key', privacyContent).maybeSingle(),
          supabase.from('settings').select('value').eq('key', privacyVersion).maybeSingle(),
        ]);

      const termsVersionRaw = termsVersionRes.data?.value;
      const privacyVersionRaw = privacyVersionRes.data?.value;
      const nextTermsVersion =
        typeof termsVersionRaw === 'string' && termsVersionRaw.trim()
          ? termsVersionRaw.trim()
          : DEFAULT_TERMS_VERSION;
      const nextPrivacyVersion =
        typeof privacyVersionRaw === 'string' && privacyVersionRaw.trim()
          ? privacyVersionRaw.trim()
          : DEFAULT_PRIVACY_VERSION;
      setTermsVersion(nextTermsVersion);
      setPrivacyVersion(nextPrivacyVersion);

      const termsContentRaw = termsContentRes.data?.value;
      const privacyContentRaw = privacyContentRes.data?.value;
      setTermsContent(
        typeof termsContentRaw === 'string' && termsContentRaw.trim()
          ? termsContentRaw
          : interpolateLegalTemplate(DEFAULT_TERMS_CONTENT, nextTermsVersion)
      );
      setPrivacyContent(
        typeof privacyContentRaw === 'string' && privacyContentRaw.trim()
          ? privacyContentRaw
          : interpolateLegalTemplate(DEFAULT_PRIVACY_CONTENT, nextPrivacyVersion)
      );
    })().finally(() => setLegalLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setDone(false);
    const value = { email: email.trim(), message: message.trim() };
    const { error } = await supabase
      .from('settings')
      .upsert({ key: KEY, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    setSaving(false);
    if (error) {
      const updateRes = await supabase.from('settings').update({ value, updated_at: new Date().toISOString() }).eq('key', KEY);
      if (updateRes.error) alert(updateRes.error.message);
      else setDone(true);
    } else {
      setDone(true);
    }
  }

  async function handleShortcutsToggle(next: boolean) {
    const prev = shortcutsVisible;
    setShortcutsVisible(next);
    setShortcutsSaving(true);
    setShortcutsDone(false);
    const row = { key: SHORTCUTS_KEY, value: next, updated_at: new Date().toISOString() };
    let { error } = await supabase.from('settings').upsert(row, { onConflict: 'key' });
    if (error) {
      const updateRes = await supabase.from('settings').update({ value: next, updated_at: row.updated_at }).eq('key', SHORTCUTS_KEY);
      error = updateRes.error;
    }
    setShortcutsSaving(false);
    if (error) {
      setShortcutsVisible(prev);
      alert(error.message);
    } else {
      setShortcutsDone(true);
      window.setTimeout(() => setShortcutsDone(false), 2500);
    }
  }

  async function handleFavoritesCopySave(e: React.FormEvent) {
    e.preventDefault();
    setFavoritesCopySaving(true);
    setFavoritesCopyDone(false);
    const nowIso = new Date().toISOString();
    const rows = [
      { key: FAVORITES_TITLE_KEY, value: favoritesTitle.trim(), updated_at: nowIso },
      { key: FAVORITES_SUBTITLE_KEY, value: favoritesSubtitle.trim(), updated_at: nowIso },
    ];

    let { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' });
    if (error) {
      const [titleUpdate, subtitleUpdate] = await Promise.all([
        supabase.from('settings').update({ value: favoritesTitle.trim(), updated_at: nowIso }).eq('key', FAVORITES_TITLE_KEY),
        supabase.from('settings').update({ value: favoritesSubtitle.trim(), updated_at: nowIso }).eq('key', FAVORITES_SUBTITLE_KEY),
      ]);
      error = titleUpdate.error ?? subtitleUpdate.error ?? null;
    }

    setFavoritesCopySaving(false);
    if (error) {
      alert(error.message);
      return;
    }
    setFavoritesCopyDone(true);
    window.setTimeout(() => setFavoritesCopyDone(false), 2500);
  }

  async function handleLegalSave(e: React.FormEvent) {
    e.preventDefault();
    setLegalSaving(true);
    setLegalDone(false);
    const nowIso = new Date().toISOString();
    const rows = [
      {
        key: LEGAL_SETTINGS_KEYS.termsVersion,
        value: termsVersion.trim() || DEFAULT_TERMS_VERSION,
        updated_at: nowIso,
      },
      {
        key: LEGAL_SETTINGS_KEYS.privacyVersion,
        value: privacyVersion.trim() || DEFAULT_PRIVACY_VERSION,
        updated_at: nowIso,
      },
      { key: LEGAL_SETTINGS_KEYS.termsContent, value: termsContent.trim(), updated_at: nowIso },
      {
        key: LEGAL_SETTINGS_KEYS.privacyContent,
        value: privacyContent.trim(),
        updated_at: nowIso,
      },
    ];

    let { error } = await supabase
      .from('settings')
      .upsert(rows, { onConflict: 'key' });

    if (error) {
      const updates = await Promise.all(
        rows.map((row) =>
          supabase
            .from('settings')
            .update({ value: row.value, updated_at: nowIso })
            .eq('key', row.key)
        )
      );
      error = updates.map((r) => r.error).find(Boolean) ?? null;
    }

    setLegalSaving(false);
    if (error) {
      alert(error.message);
      return;
    }
    setLegalDone(true);
    window.setTimeout(() => setLegalDone(false), 2500);
  }

  async function handleDownloadSave(e: React.FormEvent) {
    e.preventDefault();
    setDownloadSaving(true);
    setDownloadDone(false);
    const nowIso = new Date().toISOString();
    const rows = [
      { key: DOWNLOAD_SETTINGS_KEYS.passengerApkUrl, value: passengerApkUrl.trim(), updated_at: nowIso },
      { key: DOWNLOAD_SETTINGS_KEYS.driverApkUrl, value: driverApkUrl.trim(), updated_at: nowIso },
      { key: DOWNLOAD_SETTINGS_KEYS.passengerVersion, value: passengerVersion.trim(), updated_at: nowIso },
      { key: DOWNLOAD_SETTINGS_KEYS.driverVersion, value: driverVersion.trim(), updated_at: nowIso },
      { key: DOWNLOAD_SETTINGS_KEYS.installGuideUrl, value: installGuideUrl.trim(), updated_at: nowIso },
      { key: DOWNLOAD_SETTINGS_KEYS.whatsappSupportUrl, value: whatsappSupportUrl.trim(), updated_at: nowIso },
      { key: DOWNLOAD_SETTINGS_KEYS.playStoreUrl, value: playStoreUrl.trim(), updated_at: nowIso },
      { key: DOWNLOAD_SETTINGS_KEYS.appStoreUrl, value: appStoreUrl.trim(), updated_at: nowIso },
      { key: DOWNLOAD_SETTINGS_KEYS.heroImageUrl, value: heroImageUrl.trim(), updated_at: nowIso },
      { key: DOWNLOAD_SETTINGS_KEYS.heroImage2Url, value: heroImage2Url.trim(), updated_at: nowIso },
      { key: DOWNLOAD_SETTINGS_KEYS.heroImage3Url, value: heroImage3Url.trim(), updated_at: nowIso },
      { key: DOWNLOAD_SETTINGS_KEYS.heroImage4Url, value: heroImage4Url.trim(), updated_at: nowIso },
      { key: DOWNLOAD_SETTINGS_KEYS.heroImage5Url, value: heroImage5Url.trim(), updated_at: nowIso },
      { key: DOWNLOAD_SETTINGS_KEYS.screenshot1Url, value: screenshot1Url.trim(), updated_at: nowIso },
      { key: DOWNLOAD_SETTINGS_KEYS.screenshot2Url, value: screenshot2Url.trim(), updated_at: nowIso },
      { key: DOWNLOAD_SETTINGS_KEYS.screenshot3Url, value: screenshot3Url.trim(), updated_at: nowIso },
      { key: DOWNLOAD_SETTINGS_KEYS.screenshot4Url, value: screenshot4Url.trim(), updated_at: nowIso },
      { key: DOWNLOAD_SETTINGS_KEYS.screenshot5Url, value: screenshot5Url.trim(), updated_at: nowIso },
      { key: DOWNLOAD_SETTINGS_KEYS.defaultTheme, value: defaultTheme.trim() || 'system', updated_at: nowIso },
      { key: DOWNLOAD_SETTINGS_KEYS.mediaBucket, value: mediaBucket.trim() || 'app-releases', updated_at: nowIso },
    ];

    let { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' });
    if (error) {
      const updates = await Promise.all(
        rows.map((row) =>
          supabase.from('settings').update({ value: row.value, updated_at: nowIso }).eq('key', row.key)
        )
      );
      error = updates.map((r) => r.error).find(Boolean) ?? null;
    }

    setDownloadSaving(false);
    if (error) {
      alert(error.message);
      return;
    }
    setDownloadDone(true);
    window.setTimeout(() => setDownloadDone(false), 2500);
  }

  async function handleImageUpload(
    e: React.ChangeEvent<HTMLInputElement>,
    field:
      | 'hero'
      | 'hero2'
      | 'hero3'
      | 'hero4'
      | 'hero5'
      | 's1'
      | 's2'
      | 's3'
      | 's4'
      | 's5'
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    const bucket = mediaBucket.trim() || 'app-releases';
    const ext = (file.name.split('.').pop() || 'webp').toLowerCase();
    const safeExt = ext.replace(/[^a-z0-9]/g, '') || 'webp';
    const stamp = Date.now();
    const path = `download-landing/${field}-${stamp}.${safeExt}`;

    setUploadingField(field);
    const uploadRes = await supabase.storage.from(bucket).upload(path, file, {
      cacheControl: '31536000',
      upsert: true,
      contentType: file.type || undefined,
    });
    setUploadingField(null);
    e.target.value = '';

    if (uploadRes.error) {
      alert(`No se pudo subir imagen a bucket "${bucket}": ${uploadRes.error.message}`);
      return;
    }

    const publicUrl = supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    if (field === 'hero') setHeroImageUrl(publicUrl);
    if (field === 'hero2') setHeroImage2Url(publicUrl);
    if (field === 'hero3') setHeroImage3Url(publicUrl);
    if (field === 'hero4') setHeroImage4Url(publicUrl);
    if (field === 'hero5') setHeroImage5Url(publicUrl);
    if (field === 's1') setScreenshot1Url(publicUrl);
    if (field === 's2') setScreenshot2Url(publicUrl);
    if (field === 's3') setScreenshot3Url(publicUrl);
    if (field === 's4') setScreenshot4Url(publicUrl);
    if (field === 's5') setScreenshot5Url(publicUrl);
  }

  async function handleHeroBatchUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, 5);
    if (files.length === 0) return;

    const bucket = mediaBucket.trim() || 'app-releases';
    setUploadingField('hero-batch');

    const nextUrls = ['', '', '', '', ''];
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const ext = (file.name.split('.').pop() || 'webp').toLowerCase();
      const safeExt = ext.replace(/[^a-z0-9]/g, '') || 'webp';
      const stamp = Date.now() + i;
      const path = `download-landing/hero-${i + 1}-${stamp}.${safeExt}`;

      const uploadRes = await supabase.storage.from(bucket).upload(path, file, {
        cacheControl: '31536000',
        upsert: true,
        contentType: file.type || undefined,
      });

      if (uploadRes.error) {
        setUploadingField(null);
        e.target.value = '';
        alert(`No se pudo subir hero ${i + 1}: ${uploadRes.error.message}`);
        return;
      }

      nextUrls[i] = supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    }

    setUploadingField(null);
    e.target.value = '';
    if (nextUrls[0]) setHeroImageUrl(nextUrls[0]);
    if (nextUrls[1]) setHeroImage2Url(nextUrls[1]);
    if (nextUrls[2]) setHeroImage3Url(nextUrls[2]);
    if (nextUrls[3]) setHeroImage4Url(nextUrls[3]);
    if (nextUrls[4]) setHeroImage5Url(nextUrls[4]);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Configuración</h1>
      <p className="text-gray-600 mb-6">
        Texto e email que ven los conductores con solicitud pendiente de aprobación (después de cargar el vehículo).
      </p>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 max-w-xl">
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Correo para recibir documentos</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ej. documentos@xhare.com"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          />
          <p className="text-xs text-gray-500 mt-1">Los conductores verán este correo para enviar el resto de documentos.</p>
        </div>
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">Mensaje para conductores pendientes</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="Enviá el resto de los documentos por correo..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
        {done && <span className="ml-3 text-sm text-green-600">Guardado.</span>}
      </form>

      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-xl mt-10">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">App pasajero — Inicio</h2>
        <p className="text-sm text-gray-600 mb-5">
          Ocultá o mostrá el bloque de abajo en la pantalla Inicio (buscador, accesos a Buscar viajes / reservas /
          mensajes / solicitudes, enlaces a Viajes disponibles y En curso cerca, y la sección Alertas importantes). Los
          favoritos (casa / gym / trabajo) siempre se muestran.
        </p>
        {shortcutsLoading ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              role="switch"
              aria-checked={shortcutsVisible}
              disabled={shortcutsSaving}
              onClick={() => void handleShortcutsToggle(!shortcutsVisible)}
              className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 ${
                shortcutsVisible ? 'bg-green-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition ${
                  shortcutsVisible ? 'translate-x-6' : 'translate-x-0.5'
                }`}
                style={{ marginTop: '1px' }}
              />
            </button>
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-medium text-gray-900">
                {shortcutsVisible ? 'Buscador y accesos visibles' : 'Buscador y accesos ocultos'}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Los cambios aplican al abrir o volver a Inicio en la app (sesión iniciada).
              </p>
            </div>
            {shortcutsSaving && <span className="text-sm text-gray-500">Guardando…</span>}
            {shortcutsDone && !shortcutsSaving && <span className="text-sm text-green-600">Guardado en Supabase.</span>}
          </div>
        )}
      </div>

      <form onSubmit={handleFavoritesCopySave} className="bg-white rounded-xl border border-gray-200 p-6 max-w-xl mt-10">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">App pasajero — Textos de favoritos</h2>
        <p className="text-sm text-gray-600 mb-5">
          Editá los textos que aparecen arriba del bloque de favoritos en la pantalla Inicio.
        </p>
        {favoritesCopyLoading ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" />
          </div>
        ) : (
          <>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Título</label>
              <input
                type="text"
                value={favoritesTitle}
                onChange={(e) => setFavoritesTitle(e.target.value)}
                placeholder="Hola. Configura tus favoritos para viajes rapidos."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
              <textarea
                value={favoritesSubtitle}
                onChange={(e) => setFavoritesSubtitle(e.target.value)}
                rows={3}
                placeholder="Lista apilada con switch..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <button
              type="submit"
              disabled={favoritesCopySaving}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {favoritesCopySaving ? 'Guardando...' : 'Guardar textos'}
            </button>
            {favoritesCopyDone && <span className="ml-3 text-sm text-green-600">Guardado en Supabase.</span>}
          </>
        )}
      </form>

      <form
        onSubmit={handleLegalSave}
        className="bg-white rounded-xl border border-gray-200 p-6 max-w-3xl mt-10"
      >
        <h2 className="text-lg font-semibold text-gray-900 mb-1">
          Legal (TyC y Privacidad)
        </h2>
        <p className="text-sm text-gray-600 mb-5">
          Editá el texto oficial para landing y app. Se publica en{' '}
          <code>/legal/terms</code> y <code>/legal/privacy</code>.
        </p>
        {legalLoading ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Versión TyC
                </label>
                <input
                  type="text"
                  value={termsVersion}
                  onChange={(e) => setTermsVersion(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  placeholder="v1.0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Versión Privacidad
                </label>
                <input
                  type="text"
                  value={privacyVersion}
                  onChange={(e) => setPrivacyVersion(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  placeholder="v1.0"
                />
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Términos y Condiciones
              </label>
              <textarea
                value={termsContent}
                onChange={(e) => setTermsContent(e.target.value)}
                rows={16}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-xs"
              />
            </div>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Política de Privacidad
              </label>
              <textarea
                value={privacyContent}
                onChange={(e) => setPrivacyContent(e.target.value)}
                rows={16}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-xs"
              />
            </div>
            <button
              type="submit"
              disabled={legalSaving}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {legalSaving ? 'Guardando...' : 'Guardar legal'}
            </button>
            {legalDone && (
              <span className="ml-3 text-sm text-green-600">Guardado en Supabase.</span>
            )}
          </>
        )}
      </form>

      <form
        onSubmit={handleDownloadSave}
        className="bg-white rounded-xl border border-gray-200 p-6 max-w-3xl mt-10"
      >
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Descarga APK (landing / ads)</h2>
        <p className="text-sm text-gray-600 mb-5">
          Configurá links públicos para <code>/descargar</code> (flyers, Meta Ads, landing).
        </p>
        {downloadLoading ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Versión pasajero</label>
                <input
                  type="text"
                  value={passengerVersion}
                  onChange={(e) => setPassengerVersion(e.target.value)}
                  placeholder="v1.0.0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Versión conductor</label>
                <input
                  type="text"
                  value={driverVersion}
                  onChange={(e) => setDriverVersion(e.target.value)}
                  placeholder="v1.0.0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">URL APK pasajero</label>
              <input
                type="url"
                value={passengerApkUrl}
                onChange={(e) => setPassengerApkUrl(e.target.value)}
                placeholder="https://..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">URL APK conductor</label>
              <input
                type="url"
                value={driverApkUrl}
                onChange={(e) => setDriverApkUrl(e.target.value)}
                placeholder="https://..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">URL guía de instalación (opcional)</label>
              <input
                type="url"
                value={installGuideUrl}
                onChange={(e) => setInstallGuideUrl(e.target.value)}
                placeholder="https://..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp soporte (FAB en /descargar)</label>
              <input
                type="url"
                value={whatsappSupportUrl}
                onChange={(e) => setWhatsappSupportUrl(e.target.value)}
                placeholder="https://wa.me/5959XXXXXXXX"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
              <p className="text-xs text-gray-500 mt-1">
                Si queda vacío, se intenta usar la variable de entorno{' '}
                <code className="font-mono">NEXT_PUBLIC_DOWNLOAD_WHATSAPP_URL</code> en el deploy.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Google Play (opcional)</label>
                <input
                  type="url"
                  value={playStoreUrl}
                  onChange={(e) => setPlayStoreUrl(e.target.value)}
                  placeholder="https://play.google.com/..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">App Store (opcional)</label>
                <input
                  type="url"
                  value={appStoreUrl}
                  onChange={(e) => setAppStoreUrl(e.target.value)}
                  placeholder="https://apps.apple.com/..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
            </div>
            <div className="mb-4 rounded-lg border border-gray-200 p-4 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Tema de la landing (/descargar)</h3>
              <p className="text-xs text-gray-600 mb-3">
                Este selector queda separado del bloque de imágenes para que el cambio sea más claro.
              </p>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tema por defecto</label>
              <select
                value={defaultTheme}
                onChange={(e) => setDefaultTheme(e.target.value)}
                className="w-full md:w-72 px-3 py-2 border border-gray-300 rounded-lg bg-white"
              >
                <option value="system">Sistema (auto)</option>
                <option value="dark">Oscuro</option>
                <option value="light">Claro</option>
                <option value="highContrast">Alto contraste</option>
              </select>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Bucket media (Supabase Storage)</label>
              <input
                type="text"
                value={mediaBucket}
                onChange={(e) => setMediaBucket(e.target.value)}
                placeholder="app-releases"
                className="w-full md:w-72 px-3 py-2 border border-gray-300 rounded-lg"
              />
              <p className="text-xs text-gray-500 mt-1">
                Debe ser bucket público para que se vea en landing.
              </p>
            </div>
            <div className="mb-4 rounded-lg border border-gray-200 p-3 bg-gray-50">
              <p className="text-sm font-medium text-gray-800 mb-1">Hero carrusel (1 a 5 imágenes)</p>
              <p className="text-xs text-gray-600 mb-2">
                Seleccioná varias imágenes juntas y se asignan automáticamente a Hero 1..5 en orden.
              </p>
              <input
                type="file"
                multiple
                accept="image/webp,image/avif,image/png,image/jpeg"
                onChange={(e) => void handleHeroBatchUpload(e)}
                className="text-sm"
              />
              {uploadingField === 'hero-batch' ? (
                <p className="text-xs text-gray-500 mt-1">Subiendo carrusel hero...</p>
              ) : null}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hero 1 URL</label>
                <input
                  type="url"
                  value={heroImageUrl}
                  onChange={(e) => setHeroImageUrl(e.target.value)}
                  placeholder="https://.../hero1.webp"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hero 2 URL</label>
                <input
                  type="url"
                  value={heroImage2Url}
                  onChange={(e) => setHeroImage2Url(e.target.value)}
                  placeholder="https://.../hero2.webp"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hero 3 URL</label>
                <input
                  type="url"
                  value={heroImage3Url}
                  onChange={(e) => setHeroImage3Url(e.target.value)}
                  placeholder="https://.../hero3.webp"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hero 4 URL</label>
                <input
                  type="url"
                  value={heroImage4Url}
                  onChange={(e) => setHeroImage4Url(e.target.value)}
                  placeholder="https://.../hero4.webp"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hero 5 URL</label>
                <input
                  type="url"
                  value={heroImage5Url}
                  onChange={(e) => setHeroImage5Url(e.target.value)}
                  placeholder="https://.../hero5.webp"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Screenshot 1 URL</label>
                <input
                  type="url"
                  value={screenshot1Url}
                  onChange={(e) => setScreenshot1Url(e.target.value)}
                  placeholder="https://.../s1.webp"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
                <div className="mt-2">
                  <input
                    type="file"
                    accept="image/webp,image/avif,image/png,image/jpeg"
                    onChange={(e) => void handleImageUpload(e, 's1')}
                    className="text-sm"
                  />
                  {uploadingField === 's1' ? <p className="text-xs text-gray-500 mt-1">Subiendo screenshot 1...</p> : null}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Screenshot 2 URL</label>
                <input
                  type="url"
                  value={screenshot2Url}
                  onChange={(e) => setScreenshot2Url(e.target.value)}
                  placeholder="https://.../s2.webp"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
                <div className="mt-2">
                  <input
                    type="file"
                    accept="image/webp,image/avif,image/png,image/jpeg"
                    onChange={(e) => void handleImageUpload(e, 's2')}
                    className="text-sm"
                  />
                  {uploadingField === 's2' ? <p className="text-xs text-gray-500 mt-1">Subiendo screenshot 2...</p> : null}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Screenshot 3 URL</label>
                <input
                  type="url"
                  value={screenshot3Url}
                  onChange={(e) => setScreenshot3Url(e.target.value)}
                  placeholder="https://.../s3.webp"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
                <div className="mt-2">
                  <input
                    type="file"
                    accept="image/webp,image/avif,image/png,image/jpeg"
                    onChange={(e) => void handleImageUpload(e, 's3')}
                    className="text-sm"
                  />
                  {uploadingField === 's3' ? <p className="text-xs text-gray-500 mt-1">Subiendo screenshot 3...</p> : null}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Screenshot 4 URL</label>
                <input
                  type="url"
                  value={screenshot4Url}
                  onChange={(e) => setScreenshot4Url(e.target.value)}
                  placeholder="https://.../s4.webp"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
                <div className="mt-2">
                  <input
                    type="file"
                    accept="image/webp,image/avif,image/png,image/jpeg"
                    onChange={(e) => void handleImageUpload(e, 's4')}
                    className="text-sm"
                  />
                  {uploadingField === 's4' ? <p className="text-xs text-gray-500 mt-1">Subiendo screenshot 4...</p> : null}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Screenshot 5 URL</label>
                <input
                  type="url"
                  value={screenshot5Url}
                  onChange={(e) => setScreenshot5Url(e.target.value)}
                  placeholder="https://.../s5.webp"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
                <div className="mt-2">
                  <input
                    type="file"
                    accept="image/webp,image/avif,image/png,image/jpeg"
                    onChange={(e) => void handleImageUpload(e, 's5')}
                    className="text-sm"
                  />
                  {uploadingField === 's5' ? <p className="text-xs text-gray-500 mt-1">Subiendo screenshot 5...</p> : null}
                </div>
              </div>
            </div>
            <button
              type="submit"
              disabled={downloadSaving}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {downloadSaving ? 'Guardando...' : 'Guardar descargas'}
            </button>
            {downloadDone && (
              <span className="ml-3 text-sm text-green-600">Guardado en Supabase.</span>
            )}
          </>
        )}
      </form>
    </div>
  );
}
