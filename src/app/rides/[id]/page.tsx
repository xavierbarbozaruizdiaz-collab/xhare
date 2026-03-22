'use client';

import dynamic from 'next/dynamic';

/** Mapa y geolocalización solo en cliente. */
const RideDetailClient = dynamic(() => import('./RideDetailClient'), { ssr: false });

export default function RideDetailPage() {
  return <RideDetailClient />;
}
