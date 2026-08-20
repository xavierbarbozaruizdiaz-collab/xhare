'use client';

import { useEffect, useState } from 'react';

const ACCEPT = 'image/webp,image/avif,image/png,image/jpeg';

type LandingMediaSlotProps = {
  label: string;
  url: string;
  onUrlChange: (url: string) => void;
  onFileSelected: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
  uploading: boolean;
  variant: 'hero' | 'screenshot';
};

export function LandingMediaSlot({
  label,
  url,
  onUrlChange,
  onFileSelected,
  onClear,
  uploading,
  variant,
}: LandingMediaSlotProps) {
  const [broken, setBroken] = useState(false);
  const trimmed = url.trim();
  const showImage = Boolean(trimmed) && !broken;

  useEffect(() => {
    setBroken(false);
  }, [url]);

  const frameClass =
    variant === 'screenshot'
      ? 'h-40 w-[88px] shrink-0'
      : 'h-24 w-40 shrink-0';

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="mb-2 text-sm font-medium text-gray-800">{label}</p>
      <div className="flex items-start gap-3">
        <div
          className={`${frameClass} overflow-hidden rounded-md border border-gray-200 bg-gray-100`}
        >
          {showImage ? (
            <img
              src={trimmed}
              alt={label}
              className="h-full w-full object-contain bg-gray-50"
              onError={() => setBroken(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-1 text-center text-[11px] leading-tight text-gray-400">
              {broken ? 'No se pudo cargar' : 'Sin imagen'}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap gap-2">
            <label
              className={`inline-flex cursor-pointer items-center rounded-lg px-3 py-1.5 text-sm text-white ${
                uploading ? 'bg-green-400' : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {uploading ? 'Subiendo...' : trimmed ? 'Reemplazar' : 'Subir'}
              <input
                type="file"
                accept={ACCEPT}
                className="sr-only"
                disabled={uploading}
                onChange={onFileSelected}
              />
            </label>
            {trimmed ? (
              <button
                type="button"
                onClick={onClear}
                disabled={uploading}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Quitar
              </button>
            ) : null}
          </div>
          <input
            type="url"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="o pegá una URL"
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs text-gray-700"
          />
        </div>
      </div>
    </div>
  );
}
