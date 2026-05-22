'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

const STEPS = [
  {
    title: 'Descargá',
    body: 'Elegí Pasajero o Conductor y tocá “Descargar APK oficial”. Usá solo links de esta página para evitar copias falsas.',
  },
  {
    title: 'Permisos',
    body: 'Android puede pedirte “Instalar apps desconocidas”. Permitilo solo para tu navegador/archivo, instalá, y listo.',
  },
  {
    title: 'Disfrutá',
    body: 'Abrí ÑandeBus, iniciá sesión y empezá. Si algo falla, usá el botón flotante de WhatsApp o la guía oficial (si está publicada).',
  },
] as const;

type InstallStepperProps = {
  installGuideUrl?: string;
};

export function InstallStepper({ installGuideUrl }: InstallStepperProps) {
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState(0);

  const transition = useMemo(
    () => (reduceMotion ? { duration: 0 } : { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const }),
    [reduceMotion]
  );

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-md">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">Instalación en Android</h3>
          <p className="text-sm text-white/65">Guía rápida en 3 pasos</p>
        </div>
        <div className="flex items-center gap-2">
          {STEPS.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              className={`h-2.5 w-2.5 rounded-full transition ${
                i === active ? 'bg-[#38b000] shadow-[0_0_16px_rgba(56,176,0,0.55)]' : 'bg-white/20 hover:bg-white/35'
              }`}
              aria-label={`Paso ${i + 1}`}
            />
          ))}
        </div>
      </div>

      <div className="relative min-h-[120px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
            transition={transition}
            className="rounded-xl border border-white/10 bg-black/20 p-4"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#38b000]/15 text-sm font-bold text-[#38b000] ring-1 ring-[#38b000]/35">
                {active + 1}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">{STEPS[active].title}</p>
                <p className="mt-1 text-sm leading-relaxed text-white/70">{STEPS[active].body}</p>
                {active === 2 && installGuideUrl ? (
                  <a
                    href={installGuideUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex text-sm font-semibold text-[#7fe06a] underline decoration-[#38b000]/60 underline-offset-4 hover:text-white"
                  >
                    Ver guía de instalación segura
                  </a>
                ) : null}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActive((v) => Math.max(0, v - 1))}
          disabled={active === 0}
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/90 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={() => setActive((v) => Math.min(STEPS.length - 1, v + 1))}
          disabled={active === STEPS.length - 1}
          className="rounded-xl bg-gradient-to-b from-[#45d10a] to-[#2f9a00] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(56,176,0,0.25)] hover:brightness-110 active:translate-y-px active:shadow-[0_6px_18px_rgba(56,176,0,0.25)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}
