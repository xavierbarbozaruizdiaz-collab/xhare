import './dispatch-map-map.css';

/** Evita prerender estático: Leaflet solo corre en el cliente. */
export const dynamic = 'force-dynamic';

export default function AdminDispatchMapLayout({ children }: { children: React.ReactNode }) {
  return children;
}
