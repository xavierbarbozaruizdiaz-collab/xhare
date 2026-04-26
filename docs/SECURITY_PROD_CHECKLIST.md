# Security Prod Checklist (Anti-Hacker Minimum)

Checklist operativo para endurecer seguridad en produccion sin romper flujos actuales.

## 1) Secrets y variables de entorno

- `SUPABASE_SERVICE_ROLE_KEY`
  - Debe existir solo en backend/servidor.
  - Nunca exponerla en cliente (`NEXT_PUBLIC_*`, `EXPO_PUBLIC_*`, bundles o logs).
  - Rotar si hubo dudas de exposicion.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - Es publica por diseno (cliente), pero debe tener RLS correcto en tablas.
  - No usarla para operaciones privilegiadas.
- `GOOGLE_MAPS_API_KEY` (server) y `GOOGLE_MAPS_ANDROID_API_KEY` (mobile build)
  - Restringir por API permitida, cuota y origen (HTTP referrer / Android app + SHA-1).
  - No reutilizar la misma key para todo.
- `CRON_SECRET` / `DEMAND_ROUTES_SYNC_SECRET`
  - Mantener en entorno servidor y CI.
  - No loggear valor completo; solo indicar presencia/ausencia.

## 2) Public env audit (cliente)

Permitido en cliente:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_API_BASE_URL`

No permitido en cliente:

- cualquier `*_SERVICE_ROLE_*`
- cualquier `*_SECRET*`
- tokens de cron o admin

## 3) Endpoints sensibles

- Mantener rate limit en:
  - rutas de escritura (ride lifecycle, trip requests, ratings, chat side effects)
  - rutas admin de alto costo (dispatch, demand grouping, corridors versions/rollback)
- Mantener respuestas de error controladas:
  - no devolver `error.message` de DB/RPC al cliente
  - log interno con detalle para soporte

## 4) Authorization / RLS

- Verificar que cada endpoint valida:
  - autenticacion (JWT valido)
  - autorizacion (rol y ownership)
- Verificar RLS en tablas de dominio critico:
  - `rides`, `bookings`, `trip_requests`, `conversations`, `chat_messages`
- Probar IDOR manual:
  - usuario A no puede leer/escribir recursos de usuario B

## 5) Logs y alertas minimas

- Alertar por picos de:
  - `401`, `403`, `429`, `500`
- Alertar cuando endpoint admin recibe abuso (429 repetidos por actor/IP).
- Conservar trazabilidad sin PII ni secretos.

## 6) Verificacion rapida previa a release

1. Confirmar variables de entorno por entorno (`dev`, `preview`, `prod`).
2. Confirmar que no hay `.env` con secretos versionados.
3. Ejecutar smoke test de endpoints criticos (auth, ride lifecycle, booking, admin).
4. Revisar logs de arranque: ausencia de warnings de secretos faltantes.

## 7) Estado actual del repo (resumen)

- Ya hay hardening de:
  - rate limiting en rutas criticas user/admin
  - sanitizacion de errores para evitar fuga de detalle interno
- Queda recomendado:
  - prueba sistematica de IDOR/role-bypass
  - monitoreo/alertas en produccion
  - rotacion periodica de secrets
