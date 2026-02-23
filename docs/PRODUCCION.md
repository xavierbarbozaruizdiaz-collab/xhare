# Checklist para pasar a producción (~2000 usuarios)

## Ajustes ya aplicados en el código

- **Rate limiting:** Ubicación conductor (1 req/15 s por viaje), polyline (40 req/min por cliente).
- **Caché:** Rutas (polyline) en memoria 5 min para no saturar OSRM.
- **Paginación:** Búsqueda (150 resultados máx., 20 por página con "Cargar más"), Mis viajes y Mis reservas (50 máx.).
- **Idempotencia:** Aceptar oferta no crea doble ride ni doble booking; índices y RPC actualizados (migración 031).
- **Índices:** Compuestos para rides, passenger_ride_requests, driver_ride_availability, bookings (migración 031).
- **Error boundary:** Errores de render muestran fallback y "Reintentar".
- **Health check:** `GET /api/health` para monitoreo (responde 200 si app y DB ok).
- **Polling:** Intervalos de producción (viaje 15 s, ubicación 25 s, barra viaje en curso 20 s).

## Antes de desplegar

1. **Migraciones:** Aplicar en Supabase (en orden) hasta la **031** inclusive.
   - Si falla el índice único `idx_bookings_ride_passenger_unique` por duplicados en `bookings`, eliminar duplicados y volver a ejecutar.
2. **Variables de entorno:** Revisar `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y cualquier clave de APIs externas (geocode, etc.).
3. **OSRM:** El servidor público tiene límites. Para mucho tráfico, configurar routing propio o proveedor de pago y cambiar `OSRM_BASE` en `/api/route/polyline/route.ts`.
4. **Rate limit en memoria:** Con múltiples instancias (p. ej. Vercel), el rate limit es por instancia. Para límite global usar Redis/Upstash (ver comentarios en `src/lib/rate-limit.ts`).

## Monitoreo recomendado

- Llamar a `GET /api/health` cada 1–5 min y alertar si devuelve 503.
- Revisar logs de Supabase (conexiones, consultas lentas).
- Si usás Vercel/similar: métricas de funciones y tiempo de respuesta.

## Límites orientativos para ~2000 usuarios

- Búsqueda: hasta 150 viajes por consulta; listados personales 50.
- Ubicación: 1 actualización cada 15 s por conductor activo.
- Polyline: 40 solicitudes por minuto por IP/usuario; respuestas cacheadas 5 min.
