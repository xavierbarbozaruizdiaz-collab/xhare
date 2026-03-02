# Seguridad de las APIs

Todas las rutas API que modifican datos o devuelven datos sensibles validan **en el servidor**:

1. **Autenticación**: `supabase.auth.getUser()` (o helper `getAuth()` de `@/lib/api-auth`). Si no hay usuario → 401.
2. **Autorización por rol**: según la ruta, se exige `role = 'driver'`, `'admin'` o que el recurso pertenezca al usuario (conductor dueño del viaje, pasajero dueño de la reserva).
3. **Rate limiting**: rutas sensibles (actualizar estado, llegar a parada, ubicación, calificar) usan `@/lib/rate-limit` para limitar abusos.

## Rutas de viajes (rides)

| Ruta | Quién | Comprobación |
|------|--------|--------------|
| `POST /api/rides/[id]/update-status` | Conductor | `requireDriver` + `driver_id === user.id` |
| `POST /api/rides/[id]/set-awaiting-confirmation` | Conductor | `driver_id === user.id`, `status === 'en_route'` |
| `POST /api/rides/[id]/arrive` | Conductor | `driver_id === user.id`, paradas y reservas del viaje |
| `POST /api/rides/[id]/location` | Conductor | `driver_id === user.id`, `status === 'en_route'` |
| `POST /api/rides/[id]/rate-driver` | Pasajero | Reserva en el viaje (`passenger_id === user.id`) |
| `POST /api/rides/[id]/rate-passenger` | Conductor | `driver_id === user.id` + reserva del pasajero |
| `POST /api/rides/[id]/checkin` | Conductor | `driver_id === user.id` |

## Otras rutas

- **Admin**: `GET /api/admin/dashboard` y rutas bajo `/api/admin/` exigen `role === 'admin'`.
- **Requests**: `POST/GET /api/requests` exigen usuario; creación exige `role === 'passenger'`. `POST /api/requests/[id]/confirm` exige que `passenger_id === user.id`.

## Helpers

En `src/lib/api-auth.ts`:

- `getAuth()` → usuario autenticado o 401.
- `requireDriver()` → conductor o 403.
- `requireAdmin()` → admin o 403.
- `requireDriverOwnsRide(rideId)` → conductor dueño del viaje o 404.

Uso en una ruta:

```ts
const auth = await requireDriverOwnsRide(params.id);
if (auth instanceof NextResponse) return auth;
// auth.user, auth.supabase, auth.ride
```

## RLS en Supabase

Las políticas RLS en tablas (`rides`, `bookings`, `profiles`, etc.) refuerzan que cada usuario solo pueda leer/escribir lo que le corresponde. Las APIs no sustituyen RLS: ambas capas se usan para robustez.
