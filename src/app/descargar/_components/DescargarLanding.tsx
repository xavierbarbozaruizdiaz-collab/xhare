'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { InstallStepper } from './InstallStepper';

export type DescargarLandingProps = {
  passengerApkUrl: string;
  driverApkUrl: string;
  passengerVersion: string;
  driverVersion: string;
  installGuideUrl: string;
  whatsappUrl: string;
  playStoreUrl: string;
  appStoreUrl: string;
  heroImageUrls: string[];
  screenshotUrls: string[];
  defaultTheme: string;
};

type ThemePref = 'system' | 'light' | 'dark' | 'highContrast';

function useSystemDark() {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => setIsDark(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return isDark;
}

function StoreBadgeGoogle() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="opacity-90">
      <path fill="currentColor" d="M3.6 7.3 12 3.2l8.4 4.1v9.4L12 21.8 3.6 16.7Z" />
    </svg>
  );
}

function StoreBadgeApple() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="opacity-90">
      <path
        fill="currentColor"
        d="M16.1 1.7c-.2 1.6-1 3-2.1 3.9-1.1.9-2.5 1.4-3.9 1.1-.2-1.5.5-3 1.5-4 .9-1 2.3-1.7 3.7-1.9.6 1.4.7 2.8.8.9Zm2.2 14.6c-.9 2.1-1.9 4.2-3.4 4.2-1.2 0-1.6-.7-3-.7-1.4 0-1.8.7-3 .8-1.5.1-2.6-2.5-3.5-4.6-1.9-4.5-1.1-12.5 2.7-12.5 1.3 0 2.2.8 3 .8s1.9-.9 3.6-.9c1.5 0 2.6.8 3.3 1.6-2.9 1.6-2.4 7.6.3 9.3Z"
      />
    </svg>
  );
}

function AndroidBadge() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="opacity-90">
      <path
        fill="currentColor"
        d="M17.6 9.8 16 15.5h-1.2l1.7-5.7h-9l1.7 5.7H8L6.4 9.8h11.2ZM7.7 7.5c-.7 0-1.2-.6-1.2-1.2 0-.7.5-1.2 1.2-1.2.7 0 1.2.5 1.2 1.2 0 .6-.5 1.2-1.2 1.2Zm8.6 0c-.7 0-1.2-.6-1.2-1.2 0-.7.5-1.2 1.2-1.2.7 0 1.2.5 1.2 1.2 0 .6-.5 1.2-1.2 1.2ZM4.5 15.9c0 .9.7 1.6 1.6 1.6h1.3v2.2c0 .9.7 1.6 1.6 1.6.9 0 1.6-.7 1.6-1.6v-2.2h2v2.2c0 .9.7 1.6 1.6 1.6.9 0 1.6-.7 1.6-1.6v-2.2h1.3c.9 0 1.6-.7 1.6-1.6V8.9H4.5v7Z"
      />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16.04 3.5C9.55 3.5 4.27 8.78 4.27 15.27c0 2.35.68 4.55 1.86 6.41L4.5 28.5l6.98-1.58a11.7 11.7 0 0 0 4.56.91c6.49 0 11.77-5.28 11.77-11.77S22.53 3.5 16.04 3.5Zm6.35 16.24c-.27.76-1.55 1.45-2.16 1.54-.55.08-1.26.12-2.04-.12-.47-.14-1.08-.35-1.87-.69-3.3-1.42-5.43-4.74-5.6-4.96-.17-.22-1.34-1.78-1.34-3.4 0-1.62.85-2.42 1.15-2.75.3-.33.66-.42.88-.42.22 0 .44.01.64.02.2.01.47-.08.74.56.27.66.92 2.28 1 2.44.08.16.14.35.03.56-.11.22-.17.35-.33.54-.16.19-.34.42-.48.56-.16.17-.33.35-.14.68.19.33.84 1.38 1.8 2.23 1.24 1.1 2.28 1.44 2.6 1.6.33.16.52.14.71-.08.19-.22.81-.94 1.03-1.26.22-.33.44-.27.74-.16.3.11 1.9.9 2.23 1.06.33.16.55.24.63.37.08.14.08.8-.19 1.56Z"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16 1H4a2 2 0 0 0-2 2v12h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"
      />
    </svg>
  );
}

type TrackCardProps = {
  title: string;
  subtitle: string;
  apkUrl: string;
  version: string;
  tone: 'passenger' | 'driver';
  isDark: boolean;
  highContrast: boolean;
  reduceMotion: boolean;
};

function TrackCard({ title, subtitle, apkUrl, version, tone, isDark, highContrast, reduceMotion }: TrackCardProps) {
  const [toast, setToast] = useState<string | null>(null);

  const border = highContrast ? 'border-2 border-white' : 'border border-white/10 hover:border-[#38b000]/45';
  const bg = isDark ? 'bg-white/5' : 'bg-white/70';
  const shadow = isDark ? 'shadow-[0_18px_60px_rgba(0,0,0,0.45)]' : 'shadow-[0_18px_60px_rgba(15,23,42,0.12)]';

  const tiltClass = reduceMotion ? '' : 'hover:-translate-y-0.5 hover:rotate-[0.35deg]';

  async function copyApk() {
    if (!apkUrl) return;
    try {
      await navigator.clipboard.writeText(apkUrl);
      setToast('Link copiado');
      window.setTimeout(() => setToast(null), 1800);
    } catch {
      setToast('No se pudo copiar');
      window.setTimeout(() => setToast(null), 2200);
    }
  }

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 14 }}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={`relative overflow-hidden rounded-2xl ${bg} ${border} ${shadow} backdrop-blur-md ${tiltClass} transition will-change-transform`}
    >
      <div
        className={`pointer-events-none absolute inset-0 opacity-0 transition duration-300 hover:opacity-100 ${
          tone === 'passenger'
            ? 'bg-[radial-gradient(700px_circle_at_20%_0%,rgba(56,176,0,0.22),transparent_55%)]'
            : 'bg-[radial-gradient(700px_circle_at_80%_0%,rgba(56,176,0,0.18),transparent_55%)]'
        }`}
      />
      <div className="relative p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className={`text-lg font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{title}</h2>
              <span className="rounded-full bg-[#38b000]/15 px-2 py-0.5 text-xs font-semibold text-[#7fe06a] ring-1 ring-[#38b000]/35">
                Early access
              </span>
            </div>
            <p className={`mt-2 text-sm leading-relaxed ${isDark ? 'text-white/70' : 'text-slate-600'}`}>{subtitle}</p>
            {version ? (
              <p className={`mt-2 text-xs ${isDark ? 'text-white/45' : 'text-slate-500'}`}>Versión: {version}</p>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {apkUrl ? (
            <>
              <a
                href={apkUrl}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#45d10a] to-[#2f9a00] px-5 py-3 text-sm font-bold text-white shadow-[0_10px_30px_rgba(56,176,0,0.28)] ring-1 ring-white/10 hover:brightness-110 active:translate-y-px active:shadow-[0_6px_18px_rgba(42,157,0,0.55)]"
                target="_blank"
                rel="noopener noreferrer"
              >
                <AndroidBadge />
                Descargar APK oficial (Android)
              </a>
              <button
                type="button"
                onClick={() => void copyApk()}
                className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                  isDark
                    ? 'border-white/15 bg-white/5 text-white hover:bg-white/10'
                    : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                }`}
              >
                <CopyIcon />
                Copiar link
              </button>
            </>
          ) : (
            <p className={`text-sm ${isDark ? 'text-amber-200/90' : 'text-amber-800'}`}>
              Descarga no disponible por el momento. Volvé pronto o contactá por WhatsApp.
            </p>
          )}
        </div>

        {toast ? (
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/80 px-4 py-2 text-xs font-semibold text-white ring-1 ring-white/10">
            {toast}
          </div>
        ) : null}
      </div>
    </motion.section>
  );
}

const PREVIEW_ITEMS = [
  { k: '1', label: 'Inicio / accesos', hint: 'Reemplazá con captura real (.webp)' },
  { k: '2', label: 'Buscar viaje', hint: 'public/descargar/screenshots/02.webp' },
  { k: '3', label: 'Detalle / mapa', hint: 'public/descargar/screenshots/03.webp' },
  { k: '4', label: 'Reserva', hint: 'public/descargar/screenshots/04.webp' },
  { k: '5', label: 'Confirmación', hint: 'public/descargar/screenshots/05.webp' },
] as const;

export function DescargarLanding(props: DescargarLandingProps) {
  const reduceMotion = useReducedMotion();
  const systemDark = useSystemDark();
  const adminDefaultTheme: ThemePref =
    props.defaultTheme === 'light' ||
    props.defaultTheme === 'dark' ||
    props.defaultTheme === 'highContrast' ||
    props.defaultTheme === 'system'
      ? props.defaultTheme
      : 'system';
  const [themePref, setThemePref] = useState<ThemePref>(adminDefaultTheme);

  useEffect(() => {
    // Keep admin-selected default as source of truth on page load/refresh.
    setThemePref(adminDefaultTheme);
  }, [adminDefaultTheme]);

  const { isDark, highContrast } = useMemo(() => {
    if (themePref === 'highContrast') return { isDark: true, highContrast: true };
    if (themePref === 'dark') return { isDark: true, highContrast: false };
    if (themePref === 'light') return { isDark: false, highContrast: false };
    return { isDark: systemDark, highContrast: false };
  }, [themePref, systemDark]);

  const shell = highContrast
    ? isDark
      ? 'bg-black text-white'
      : 'bg-white text-black'
    : isDark
      ? 'bg-[#050608] text-white'
      : 'bg-slate-50 text-slate-900';

  const muted = isDark ? 'text-white/70' : 'text-slate-600';
  const topBar = isDark ? 'border-white/10 bg-black/30' : 'border-slate-200 bg-white/70';

  const setTheme = useCallback((next: ThemePref) => setThemePref(next), []);
  const [heroIndex, setHeroIndex] = useState(0);
  const previewScrollerRef = useRef<HTMLDivElement | null>(null);
  const normalizedHeroImages = props.heroImageUrls.filter((url) => !!url.trim());
  const effectiveHeroImages =
    normalizedHeroImages.length > 0 ? normalizedHeroImages : ['/descargar/hero-route.svg'];
  const normalizedScreenshots = PREVIEW_ITEMS.map((item, idx) => ({
    ...item,
    src: props.screenshotUrls[idx] ?? '',
  }));

  useEffect(() => {
    setHeroIndex(0);
  }, [effectiveHeroImages.length]);

  useEffect(() => {
    if (reduceMotion || effectiveHeroImages.length <= 1) return;
    const timer = window.setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % effectiveHeroImages.length);
    }, 3200);
    return () => window.clearInterval(timer);
  }, [reduceMotion, effectiveHeroImages.length]);

  useEffect(() => {
    if (reduceMotion) return;
    const scroller = previewScrollerRef.current;
    if (!scroller) return;

    const stepPx = 156;
    const timer = window.setInterval(() => {
      const maxScroll = scroller.scrollWidth - scroller.clientWidth;
      if (maxScroll <= 0) return;
      if (scroller.scrollLeft + stepPx >= maxScroll - 2) {
        scroller.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        scroller.scrollBy({ left: stepPx, behavior: 'smooth' });
      }
    }, 2800);

    return () => window.clearInterval(timer);
  }, [reduceMotion, normalizedScreenshots.length]);

  return (
    <div className={`min-h-screen ${shell}`}>
      <div className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:px-8">
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 backdrop-blur-md ${topBar}`}>
          <Link href="/" className="text-sm font-bold tracking-tight text-[#38b000]">
            Xhare
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`hidden text-xs sm:inline ${muted}`}>Tema</span>
            {(['system', 'dark', 'light', 'highContrast'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setTheme(k)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition ${
                  themePref === k
                    ? 'bg-[#38b000]/20 text-white ring-[#38b000]/45'
                    : isDark
                      ? 'bg-white/5 text-white/75 ring-white/10 hover:bg-white/10'
                      : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                {k === 'system' ? 'Auto' : k === 'dark' ? 'Oscuro' : k === 'light' ? 'Claro' : 'Alto contraste'}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-10 grid items-center gap-10 lg:grid-cols-2">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#7fe06a]">Central, Paraguay</p>
            <h1 className={`mt-3 text-3xl font-black leading-tight sm:text-4xl ${isDark ? 'text-white' : 'text-slate-900'}`}>
              Xhare: tu tiempo y tu seguridad valen.
            </h1>
            <p className={`mt-4 text-base leading-relaxed sm:text-lg ${muted}`}>
              Pensada para el traslado diario en Central. Elegí cómo moverte hoy: como pasajero o como conductor.
            </p>
            <p className={`mt-4 text-sm leading-relaxed ${isDark ? 'text-white/55' : 'text-slate-500'}`}>
              Descargá solo desde esta página oficial. En early access usamos APK para Android; las tiendas se habilitan
              cuando corresponda.
            </p>
          </motion.div>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.6, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
            className={`relative overflow-hidden rounded-3xl border ring-1 ${
              isDark ? 'border-white/10 bg-white/5 ring-white/10' : 'border-slate-200 bg-white ring-slate-200/60'
            } p-3 shadow-[0_30px_90px_rgba(0,0,0,0.35)]`}
          >
            <div className="relative overflow-hidden rounded-2xl">
              <Image
                src={effectiveHeroImages[heroIndex]}
                alt="Ilustración: ruta en Central con minibús (placeholder visual)"
                width={960}
                height={640}
                priority
                className="h-auto w-full"
              />
            </div>
            {effectiveHeroImages.length > 1 ? (
              <div className="mt-3 flex items-center justify-center gap-2">
                {effectiveHeroImages.map((_, idx) => (
                  <button
                    key={`hero-dot-${idx}`}
                    type="button"
                    onClick={() => setHeroIndex(idx)}
                    aria-label={`Hero ${idx + 1}`}
                    className={`h-2.5 w-2.5 rounded-full transition ${
                      idx === heroIndex ? 'bg-[#38b000]' : isDark ? 'bg-white/30 hover:bg-white/50' : 'bg-slate-300 hover:bg-slate-400'
                    }`}
                  />
                ))}
              </div>
            ) : null}
          </motion.div>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          <TrackCard
            title="Pasajeros"
            subtitle="Llegá con más claridad: reservá asiento y seguí tu viaje desde el teléfono."
            apkUrl={props.passengerApkUrl}
            version={props.passengerVersion}
            tone="passenger"
            isDark={isDark}
            highContrast={highContrast}
            reduceMotion={!!reduceMotion}
          />
          <TrackCard
            title="Conductores"
            subtitle="Maximizá tu operación con tu minibús: publicá rutas y organizá pasajeros con menos fricción."
            apkUrl={props.driverApkUrl}
            version={props.driverVersion}
            tone="driver"
            isDark={isDark}
            highContrast={highContrast}
            reduceMotion={!!reduceMotion}
          />
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <StoreRow
            label="Google Play"
            icon={<StoreBadgeGoogle />}
            href={props.playStoreUrl}
            isDark={isDark}
          />
          <StoreRow label="App Store" icon={<StoreBadgeApple />} href={props.appStoreUrl} isDark={isDark} />
        </div>

        <div className="mt-10">
          <InstallStepper installGuideUrl={props.installGuideUrl} />
        </div>

        <div className="mt-10">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h3 className={`text-lg font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>App pasajero — preview</h3>
              <p className={`mt-1 text-sm ${muted}`}>
                Placeholders horizontales. Cuando tengas capturas, guardalas en{' '}
                <code className="font-mono text-xs">public/descargar/screenshots/</code> y reemplazá los bloques por{' '}
                <code className="font-mono text-xs">next/image</code>.
              </p>
            </div>
          </div>

          <div
            ref={previewScrollerRef}
            className="mt-4 -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:thin]"
          >
            {normalizedScreenshots.map((it) => (
              <div
                key={it.k}
                className={`relative h-[220px] w-[120px] shrink-0 overflow-hidden rounded-2xl border ring-1 sm:h-[260px] sm:w-[140px] ${
                  isDark ? 'border-white/10 bg-white/5 ring-white/10' : 'border-slate-200 bg-white ring-slate-200/60'
                }`}
              >
                {it.src ? (
                  <Image
                    src={it.src}
                    alt={`Preview app pasajero ${it.k}`}
                    width={420}
                    height={900}
                    sizes="140px"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <>
                    <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(56,176,0,0.18),transparent_45%,rgba(255,255,255,0.06))]" />
                    <div className="absolute inset-x-0 top-0 h-8 bg-black/35 backdrop-blur-sm" />
                    <div className="absolute left-3 top-2 h-2 w-2 rounded-full bg-white/70" />
                    <div className="absolute bottom-3 left-3 right-3">
                      <p className={`text-xs font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{it.label}</p>
                      <p className={`mt-1 text-[11px] leading-snug ${isDark ? 'text-white/45' : 'text-slate-500'}`}>{it.hint}</p>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className={`mt-10 rounded-2xl border p-5 text-sm ${isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white'}`}>
          <p className={muted}>
            ¿Problemas para instalar? Si no tenés WhatsApp configurado, podés ir a{' '}
            <Link href="/login" className="font-semibold text-[#7fe06a] underline decoration-[#38b000]/50 underline-offset-4">
              soporte vía web
            </Link>
            .
          </p>
        </div>
      </div>

      {props.whatsappUrl ? (
        <a
          href={props.whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="fixed bottom-5 right-5 z-50 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_18px_50px_rgba(37,211,102,0.35)] ring-2 ring-white/15 hover:brightness-110 active:translate-y-px"
          aria-label="Contactar por WhatsApp"
        >
          <WhatsAppIcon />
        </a>
      ) : null}
    </div>
  );
}

function StoreRow({
  label,
  icon,
  href,
  isDark,
}: {
  label: string;
  icon: ReactNode;
  href: string;
  isDark: boolean;
}) {
  const enabled = !!href.trim();
  const common =
    'inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ring-1 transition sm:flex-none';
  if (!enabled) {
    return (
      <button
        type="button"
        disabled
        title="Próximamente"
        className={`${common} cursor-not-allowed opacity-60 ${
          isDark ? 'bg-white/5 text-white/60 ring-white/10' : 'bg-white text-slate-500 ring-slate-200'
        }`}
      >
        {icon}
        {label} — próximamente
      </button>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${common} ${
        isDark
          ? 'bg-white/5 text-white ring-white/10 hover:bg-white/10'
          : 'bg-white text-slate-800 ring-slate-200 hover:bg-slate-50'
      }`}
    >
      {icon}
      Abrir en {label}
    </a>
  );
}
