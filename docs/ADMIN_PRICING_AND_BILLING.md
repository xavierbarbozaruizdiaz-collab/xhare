# Admin Pricing y Billing de conductores

## Resumen

- **Pricing:** Configuración en DB (`pricing_settings`) con valores 100%, descuento y fee por viaje completado. La app calcula tarifa efectiva y guarda snapshot en cada reserva.
- **Billing:** Un cargo por viaje completado (`driver_charges`). Cuenta por conductor (`driver_accounts`) con deuda y límite; superar el límite suspende la cuenta y bloquea publicar/iniciar/finalizar viajes.

## Tablas

| Tabla | Uso |
|-------|-----|
| `pricing_settings` | Una fila activa (`is_active = true`): min_fare_100, pyg_per_km_100, discount_percent, round_to, block_size, block_multiplier, driver_fee_per_completed_ride, driver_debt_limit_default. |
| `driver_accounts` | Una fila por conductor (creada on-demand): account_status (active/suspended), debt_pyg, debt_limit_pyg. |
| `driver_charges` | Un cargo por (ride_id, driver_id) cuando el viaje pasa a `completed`: amount_pyg, status (pending/paid). |
| `bookings` | Columnas nuevas: pricing_snapshot (jsonb), pricing_settings_id, segment_distance_km, base_fare. |

## Flujos

1. **Reserva (pasajero):** La pantalla `/rides/[id]/reservar` obtiene el pricing activo (o usa fallback 7140/2780 PYG, block 4, 1.5×). Calcula base y total, y al confirmar guarda en `bookings`: price_paid, pricing_snapshot, pricing_settings_id, segment_distance_km, base_fare.
2. **Completar viaje (conductor):** El conductor marca "Finalizar viaje" → Edge Function `ride-update-status` actualiza `rides.status = 'completed'`. Un **trigger** en DB:
   - Inserta `driver_charge` (idempotente por ride_id + driver_id) con el fee configurado.
   - Crea/actualiza `driver_accounts` y recalcula debt_pyg; si debt_pyg > debt_limit_pyg pone account_status = 'suspended'.
3. **Suspensión:** Si el conductor está suspendido, no puede publicar viajes ni iniciar/finalizar viajes (comprobado en frontend y en la Edge Function).
4. **Marcar pagado:** En Admin → Billing se marca un cargo como "paid". Un **trigger** en `driver_charges` recalcula debt_pyg del conductor y, si queda por debajo del límite, reactiva la cuenta.

## Migraciones

- `040_pricing_settings.sql` – Tabla y RLS.
- `041_driver_accounts_and_charges.sql` – Tablas y RLS.
- `042_bookings_pricing_columns.sql` – Columnas en bookings.
- `043_trigger_driver_charge_on_completed.sql` – Trigger al completar ride.
- `044_driver_accounts_recalc_on_charge_update.sql` – Trigger al actualizar charge (marcar pagado).

## Panel Admin

- **Pricing** (`/admin/pricing`): Ver/editar el settings activo (valores 100%, descuento, fee, límite deuda default).
- **Conductores** (`/admin/drivers`): Solicitudes pendientes + lista de conductores aprobados con deuda, estado y botones Suspender/Reactivar.
- **Billing** (`/admin/billing`): Lista de cargos (pending/paid), marcar pagado, export CSV.

## Plan de pruebas manuales (Chrome + APK)

1. **Sin pricing activo (fallback)**  
   - Asegurarse de que no haya fila con `is_active = true` en `pricing_settings`.  
   - Ir a reservar un viaje: el precio debe calcularse igual que antes (misma fórmula 7140/2780, bloques).  
   - Confirmar reserva: en `bookings` debe guardarse pricing_snapshot con effective y pricing_settings_id null.

2. **Con pricing activo**  
   - En Admin → Pricing crear/activar un settings (ej. discount 20%).  
   - Reservar: el precio debe bajar según el descuento.  
   - Confirmar: snapshot debe incluir pricing_settings_id y effective.

3. **Snapshot en booking**  
   - Tras una reserva, en DB revisar la fila de `bookings`: pricing_snapshot (json), segment_distance_km, base_fare, price_paid coherentes.

4. **Cargo al completar**  
   - Como conductor, iniciar un viaje y luego "Finalizar viaje".  
   - En `driver_charges` debe aparecer una fila con ese ride_id y driver_id, status pending.  
   - En `driver_accounts` debe existir la fila del conductor con debt_pyg = fee.

5. **Suspensión**  
   - En Admin → Conductores, suspender un conductor (o subir su deuda por encima del límite con cargos pending).  
   - Como ese conductor: no debe poder publicar viaje (banner "Cuenta suspendida" en /publish).  
   - En detalle de un viaje suyo: "Iniciar viaje" y "Finalizar viaje" deshabilitados con mensaje.  
   - Llamar directamente a la Edge Function con status en_route o completed debe devolver 403 account_suspended.

6. **Marcar pagado y reactivación**  
   - En Admin → Billing, marcar un cargo como pagado.  
   - Comprobar que debt_pyg del conductor disminuye.  
   - Si la deuda queda por debajo del límite, account_status debe pasar a active (o en Conductores usar "Reactivar").  
   - El conductor debe poder volver a publicar e iniciar/finalizar.

7. **Export CSV**  
   - En Billing, "Exportar CSV": debe descargar un CSV con los cargos filtrados (id, ride_id, driver_id, amount_pyg, status, created_at).
