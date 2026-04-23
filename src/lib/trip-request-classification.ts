/**
 * Clasificación de demanda (Fase 2): la fuente de verdad vive en Postgres
 * (`trip_request_time_bucket_15m`, `z_trip_requests_classify_before_insert`).
 * Este módulo tipa el resultado y arma payloads de log en Node.
 *
 * Los pipelines de agrupación deben ignorar `trip_requests` en estado terminal `cancelled`
 * (p. ej. tras `detach_passenger_favorite_grouped_requests`).
 */

export type TripRequestClassificationLog = {
  trip_request_id: string;
  corridor_id: string | null;
  time_bucket: string | null;
  classification_status: 'unclassified' | 'classified' | string;
  origin_node_key: string | null;
  destination_node_key: string | null;
};

export function classificationLogFromRow(row: Record<string, unknown>): TripRequestClassificationLog {
  return {
    trip_request_id: String(row.id ?? ''),
    corridor_id: row.corridor_id != null ? String(row.corridor_id) : null,
    time_bucket: row.time_bucket != null ? String(row.time_bucket) : null,
    classification_status:
      row.classification_status != null ? String(row.classification_status) : 'unclassified',
    origin_node_key: row.origin_node_key != null ? String(row.origin_node_key) : null,
    destination_node_key: row.destination_node_key != null ? String(row.destination_node_key) : null,
  };
}
