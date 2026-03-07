# Refactor dashboard admin — entregables

## Archivos tocados

| Archivo | Cambio |
|---------|--------|
| `src/lib/admin-auth.ts` | **Nuevo.** Helper `withAdminAuth(request, handler)` + `logBlockStart`, `logBlockOk`, `logBlockError`. |
| `src/app/api/admin/dashboard/route.ts` | **Reemplazado.** Devuelve 410 Deprecated; apunta a los 4 endpoints nuevos. |
| `src/app/api/admin/dashboard/profiles/route.ts` | **Nuevo.** GET bloque profiles. |
| `src/app/api/admin/dashboard/uberpool/route.ts` | **Nuevo.** GET bloque uberpool. |
| `src/app/api/admin/dashboard/ratings/route.ts` | **Nuevo.** GET bloque ratings. |
| `src/app/api/admin/dashboard/indriver/route.ts` | **Nuevo.** GET bloque indriver. |
| `src/app/admin/page.tsx` | **Refactor.** Carga por bloques (profiles + uberpool al entrar; ratings e indriver al expandir), estado por bloque (idle/loading/success/error), retry por bloque. |

## Endpoints creados

| Método | Ruta | Bloque | Contenido |
|--------|------|--------|-----------|
| GET | `/api/admin/dashboard/profiles` | profiles | pendingDrivers, totalDrivers, totalPassengersProfile |
| GET | `/api/admin/dashboard/uberpool` | uberpool | totalViajesPublicados, viajesEnCurso, viajesCompletados, totalReservas, asientosOcupados, tasaCancelacion, activeRides |
| GET | `/api/admin/dashboard/ratings` | ratings | ratingPromedioConductor, ratingPromedioPasajero |
| GET | `/api/admin/dashboard/indriver` | indriver | solicitudesCreadas, disponibilidadesCreadas, ofertasEnviadas, ofertasAceptadas, viajesCreadosDesdeOferta, precios promedios |

Todos requieren los mismos headers de auth que antes: `Authorization: Bearer <token>` y/o `x-admin-token`.

## Helper de auth reutilizable

- **Ubicación:** `src/lib/admin-auth.ts`
- **Uso:** `withAdminAuth(request, async (req, user) => { ... return NextResponse.json(...) })`
- El helper hace: extrae JWT, valida usuario, comprueba `profiles.role === 'admin'`. Si falla responde 401 o 403; si no, ejecuta el handler con el `user` ya validado.
- Logs por bloque: `logBlockStart(blockName)`, `logBlockOk(blockName)`, `logBlockError(blockName, shortMessage, err?)`. En producción no se incluyen tokens, cookies, user_id ni stack completo; stack solo en development.

## Cómo probar en local

1. `npm run dev`
2. Iniciar sesión con un usuario que tenga `profiles.role = 'admin'`.
3. Ir a `/admin`.
4. Comprobar que se cargan solos los bloques **profiles** y **uberpool** (primera fila de tarjetas + sección UberPool).
5. Expandir **Valoraciones (★ Conductor / ★ Pasajero)** → debe cargar el bloque ratings y mostrar los promedios.
6. Expandir **InDriver** → debe cargar el bloque indriver y mostrar la grid.
7. Para simular fallo de un bloque:
   - En DevTools → Network, bloquear la URL que contiene `/api/admin/dashboard/profiles` (o uberpool/ratings/indriver) y recargar/expandir.
   - O comentar temporalmente el `return NextResponse.json(...)` en ese route y lanzar un `throw new Error('test')` antes.
8. Verificar que solo ese bloque muestra error + “Reintentar” y el resto sigue mostrando datos.

## Cómo detectar en producción qué bloque falló

- Los logs se emiten en el **servidor** (cada API route), no en el cliente.
- En los logs de la plataforma (p. ej. Vercel → Project → Logs o Runtime Logs), buscar:
  - `[ADMIN_BLOCK_START] <nombre>` — inicio del bloque.
  - `[ADMIN_BLOCK_OK] <nombre>` — bloque terminó bien.
  - `[ADMIN_BLOCK_ERROR] <nombre> <mensaje corto>` — falló ese bloque; el nombre indica cuál (profiles, uberpool, ratings, indriver).

No se registran tokens, cookies ni user_id en esos mensajes.
