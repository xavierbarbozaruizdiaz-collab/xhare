import { Suspense } from 'react';
import { SafetyShareTrackClient } from './SafetyShareTrackClient';

export default async function ViajeCompartidoPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const normalized = String(code ?? '').trim();
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-gray-900">
      <main className="mx-auto max-w-lg px-4 py-10 pb-16">
        <Suspense
          fallback={
            <div className="min-h-[40vh] flex items-center justify-center text-gray-600">Cargando seguimiento…</div>
          }
        >
          <SafetyShareTrackClient code={normalized} />
        </Suspense>
      </main>
    </div>
  );
}
