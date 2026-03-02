'use client';

import { useEffect } from 'react';

interface AppDrawerProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export default function AppDrawer({ open, onClose, children }: AppDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 transition-opacity"
        aria-label="Cerrar menú"
      />
      <div
        className="absolute top-0 right-0 h-full w-[min(320px,85vw)] max-w-[320px] bg-white shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <span className="text-lg font-semibold text-gray-900">Menú</span>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Cerrar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-4">
          {children}
        </nav>
      </div>
    </div>
  );
}
