'use client';

import dynamic from 'next/dynamic';

/** Carga solo en cliente para no importar Capacitor durante el build (Vercel). */
const RideDetailClient = dynamic(() => import('./RideDetailClient'), { ssr: false });

export default function RideDetailPage() {
  return <RideDetailClient />;
}
