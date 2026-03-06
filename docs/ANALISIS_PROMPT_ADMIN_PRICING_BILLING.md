# Análisis del prompt: Admin Pricing + Billing Drivers

Este documento resume la auditoría del repo frente al prompt, las discrepancias encontradas y los **ajustes recomendados** antes de ejecutar.

---

## 1. Auditoría rápida (validación de supuestos)

| Supuesto del prompt | Estado en el repo |
|---------------------|-------------------|
| Tabla de reservas | **Correcto:** tabla `bookings` (no ride_bookings). Columnas: `id`, `ride_id`, `passenger_id`, `seats_count`, `price_paid`, `status`, `payment_status`, `pickup_*`, `dropoff_*`, `selected_seat_ids`. **No existen:** `pricing_snapshot`, `pricing_settings_id`, `segment_distance_km`, `base_fare`. |
| Tabla rides | Existe con `status` (`draft`, `published`, `booked`, `en_route`, `completed`, `cancelled`), `driver_id`, etc. |
| Dónde se marca ride completed | **Correcto:** Edge Function `supabase/functions/ride-update-status` (POST con `ride_id`, `status: 'completed'`). Invocada desde `src/app/rides/[id]/page.tsx`. La función **solo** actualiza `rides.status` (y `started_at` si en_route); no toca bookings ni crea cargos. |
| Cómo se distingue un driver | **Correcto:** `profiles.role` ∈ `('passenger','driver','admin','driver_pending')`. Función `is_admin(uuid)` en DB (migración 001). |
| Pricing actual | **Correcto:** `src/lib/pricing/segment-fare.ts`: `MIN_FARE_PYG = 7140`, `PYG_PER_KM = 2780`; bloque 1.5× base cada 4 asientos; redondeo 100. |
| Pantalla reserva | **Correcto:** `src/app/rides/[id]/reservar/page.tsx` usa `baseFareFromDistanceKm(km)` y `totalFareFromBaseAndSeats(base, seats)`; insert directo a `bookings` con `price_paid` (sin snapshot ni pricing_settings_id). |
| Admin | **Correcto:** `AdminAuthContext` + `profile.role === 'admin'`. Layout `/admin` con nav: Inicio, Conductores, Pasajeros, Viajes, Usuarios, Config. **No existen** `/admin/pricing` ni `/admin/billing`. |

**Conclusión:** El prompt está alineado con el repo. Solo hay que añadir columnas a `bookings` y crear tablas/funciones nuevas; no hay conflictos de nombres ni flujos que contradigan el enunciado.

---

## 2. Discrepancias y aclaraciones

### 2.1 Bookings sin “completed” automático

- En el esquema, `bookings.status` puede ser `'completed'`, pero **en ningún sitio** se actualiza a `completed` cuando el conductor marca el viaje como completado.
- **Recomendación:** Para “viaje efectivo” y cargo al chofer, definir **solo** por `ride.status = 'completed'` (no exigir “al menos 1 booking confirmada”). Opcionalmente, en la misma feature o en una posterior, al marcar `ride.status = 'completed'` actualizar los bookings no cancelados a `status = 'completed'` (trigger o en la Edge Function) para consistencia y reportes.

### 2.2 Valores “100%” vs constantes actuales

- El prompt pide guardar “valores 100%” (`min_fare_100`, `per_km_100`) y `discount_percent` para derivar el efectivo.
- En el código hoy están **efectivos** ya (ej. 7140, 2780 ≈ 60% de una referencia). Para **retrocompatibilidad**, el fallback cuando no hay `pricing_settings` debe usar exactamente `MIN_FARE_PYG = 7140` y `PYG_PER_KM = 2780` (y mismo block/round), no otros números.

### 2.3 Lectura de pricing por pasajeros (RLS)

- Si solo **admin** puede hacer SELECT en `pricing_settings`, los pasajeros no podrían leer el settings activo y el precio en `/rides/[id]/reservar` fallaría.
- **Recomendación:** Política RLS tipo: *“Authenticated puede SELECT en `pricing_settings` donde `is_active = true`”* (solo lectura del registro activo). Insert/Update/Delete solo admin.

### 2.4 Origen de `driver_accounts`

- El prompt pide “1 por driver” pero no define cuándo se crea.
- **Recomendación:** Crear `driver_accounts` **on-demand**: al registrar el primer `driver_charge` (cuando un ride pasa a `completed`), o alternativamente con un trigger al aprobar conductor (`profiles.driver_approved_at` / `role = 'driver'`). Para MVP, crearlo en el mismo flujo que crea el primer cargo (evita migración de datos de conductores existentes).

### 2.5 Cargo al completar: Edge Function vs trigger

- El prompt pide no romper `ride-update-status` y sugiere una Edge Function nueva o RPC para el cargo.
- **Recomendación:** Opción A) **Trigger en DB** después de `UPDATE rides SET status = 'completed'`: crea/actualiza `driver_accounts` y inserta `driver_charges` (idempotente por `(ride_id, driver_id)`). No depende del cliente ni de una segunda llamada. Opción B) Extender `ride-update-status` para que, al poner `status = 'completed'`, llame a una función SQL (por ejemplo `register_driver_charge(ride_id)`) que haga lo mismo. Ambas evitan que el frontend tenga que invocar una segunda función después de “Completar viaje”.

### 2.6 Flujos offer/accept y precio

- Las migraciones 026 y 031 insertan en `bookings` con un `v_price_paid` calculado dentro del RPC. Si ese cálculo no usa `segment-fare.ts`, las reservas creadas por offer/accept no tendrán el mismo criterio de precio que la pantalla reservar.
- **Recomendación:** Dejar explícito en el plan: **Fase 1:** parametrizar solo el flujo de **reservar** (pantalla reserva + snapshot en booking). **Fase 2 (opcional):** unificar precio y snapshot en los RPCs de offer/accept para no tener dos fuentes de verdad.

---

## 3. Ajustes sugeridos al prompt (antes de ejecutar)

### 3.1 Texto a añadir o matizar

1. **Fallback de pricing**  
   Añadir: “Si no hay fila activa en `pricing_settings`, usar exactamente las constantes actuales de `segment-fare.ts` (MIN_FARE_PYG 7140, PYG_PER_KM 2780, mismo block 1.5/4 y redondeo 100) para no cambiar el comportamiento actual.”

2. **RLS pricing_settings**  
   Especificar: “Authenticated puede SELECT solo la fila con `is_active = true`. Solo admin puede INSERT/UPDATE/DELETE en `pricing_settings`.”

3. **Viaje efectivo**  
   Dejar definido: “Para MVP, ‘viaje efectivo’ = `ride.status = 'completed'` (no exigir booking confirmada/completed). Opcional: al marcar ride completed, actualizar bookings no cancelados a `status = 'completed'`.”

4. **Creación de driver_accounts**  
   Añadir: “Crear `driver_accounts` en el momento del primer cargo (o en trigger al pasar ride a completed), con upsert por `driver_id`.”

5. **Registro del cargo**  
   Añadir: “Preferir **trigger** en `rides` al pasar `status` a `completed` (o función SQL llamada desde la Edge Function existente) para crear `driver_charge` y actualizar `driver_accounts`, de forma idempotente por `(ride_id, driver_id)`. Así no se añade una segunda llamada desde el cliente.”

6. **Scope Fase 1**  
   Añadir: “En Fase 1 solo se parametriza el flujo de reserva desde la pantalla `/rides/[id]/reservar` (cálculo + snapshot). Los RPCs de offer/accept que insertan en `bookings` quedan con su lógica actual de precio; unificación en fase posterior si se desea.”

### 3.2 Nombres de migraciones sugeridos

- `040_pricing_settings.sql`
- `041_driver_accounts_and_charges.sql`
- `042_bookings_pricing_snapshot.sql`
- `043_rls_pricing_and_driver_accounts.sql`
- `044_trigger_driver_charge_on_ride_completed.sql`  
  (o integrar 043 y 044 según prefieras)

### 3.3 Orden recomendado de implementación

1. Migraciones: `pricing_settings` → `driver_accounts` + `driver_charges` → columnas en `bookings` (`pricing_snapshot`, opcionalmente `pricing_settings_id`, `segment_distance_km`, `base_fare`).
2. RLS para todas las tablas nuevas y modificadas (incluida lectura pública del activo en `pricing_settings`).
3. Helper `runtime-pricing.ts` + cambios en `segment-fare.ts` (wrappers con defaults + funciones con pricing parametrizado).
4. Reserva: cargar settings activo, calcular con effective, guardar snapshot en el insert/update de `bookings`.
5. Trigger (o extensión de Edge Function) para crear cargo y actualizar `driver_accounts` al completar ride; suspensión automática si deuda > límite.
6. Gates en frontend: publicar/iniciar viaje comprobando `driver_accounts.account_status` (bloquear si `suspended`).
7. Panel admin: `/admin/pricing`, `/admin/drivers` (deuda/estado/suspender), `/admin/billing` (cargos, marcar pagado, export CSV).
8. Documentación en `docs/ADMIN_PRICING_AND_BILLING.md`.

---

## 4. Resumen ejecutivo

- El prompt es **ejecutable** y coherente con el repo; la auditoría no encontró tablas ni flujos que lo invaliden.
- Los **ajustes** propuestos son sobre todo: clarificar RLS de `pricing_settings`, definir “viaje efectivo” solo por `ride.status = 'completed'`, crear `driver_accounts` on-demand, usar **trigger (o función SQL)** para el cargo al completar en lugar de una segunda Edge Function llamada desde el cliente, y acotar Fase 1 al flujo de reservar.
- Con estos ajustes, se puede seguir el plan del prompt (pasos, diffs mínimos, migrations versionadas, RLS estricta) y luego ejecutar las pruebas manuales indicadas.

Si querés, el siguiente paso puede ser bajar esto a un **checklist concreto** (archivos a crear/modificar y orden de pasos) y después implementar migración por migración y código por archivo.
