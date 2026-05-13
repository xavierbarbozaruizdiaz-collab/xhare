import { SafetyShareTrackClient } from './SafetyShareTrackClient';

export default async function ViajeCompartidoPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const normalized = String(code ?? '').trim();
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-gray-900">
      <main className="mx-auto max-w-lg px-4 py-10 pb-16">
        <SafetyShareTrackClient code={normalized} />
      </main>
    </div>
  );
}
