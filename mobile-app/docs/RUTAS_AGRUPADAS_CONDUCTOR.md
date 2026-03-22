# Rutas agrupadas para el conductor (sugerencias)

Objetivo: que en **Solicitudes de trayecto** el conductor vea **rutas ya agrupadas** (no solo solicitudes sueltas), con cantidad de usuarios por ruta (ej. 10/15), y al tocar una ruta se abra una pantalla con el **mapa** y los **puntos de los pasajeros**.

---

## 1. Dónde se ve (UX)

- **Pantalla actual:** Conductor → **Solicitudes de trayecto** (`DriverTripRequestsScreen`).
- **Cambio:** En esa misma pantalla, la lista pasa a ser de **rutas agrupadas**, no de solicitudes individuales.
- **Cada ítem de la lista:**
  - Ruta resumida: origen → destino (ej. “Asunción → Ciudad del Este”).
  - Fecha (y opcional hora).
  - **Cantidad de pasajeros:** ej. **“10/15 usuarios”** (10 solicitantes en esa ruta, tope 15 por grupo).
- **Al tocar un ítem:** se abre una **pantalla de detalle** donde:
  - Se ve el **mapa** con la ruta (polyline sugerida).
  - Se ven los **puntos de los pasajeros** (origen/destino de cada solicitud agrupada), por ejemplo marcadores o clusters.
  - Acción: “Publicar viaje para esta ruta” (prellenando origen/destino/fecha desde la ruta agrupada y vinculando las solicitudes que la componen).

Así el conductor ve demanda agregada (10/15) y, al abrir, entiende la ruta y los puntos reales de los pasajeros en el mapa.

---

## 2. Cómo generar la agrupación (lógica sugerida)

### 2.1 Qué es “una ruta agrupada”

- **Insumos:** Todas las `trip_requests` con `status = 'pending'` y `requested_date` futura (igual que hoy).
- **Agrupar por “ruta similar”:**
  - **Misma fecha:** mismo `requested_date` (o ventana de ±1 día si se quiere).
  - **Origen “cerca”:** por ejemplo que los `origin_lat/origin_lng` estén a ≤ X km de un mismo punto (ej. centroide del grupo o zona). X razonable: 2–5 km.
  - **Destino “cerca”:** igual, `destination_lat/destination_lng` a ≤ X km de un punto común.
- **Tope por grupo:** Máximo **15** solicitudes por ruta agrupada. Si hay más de 15 “similares”, se pueden formar varios grupos (ej. dos grupos de 10 y 8) o un grupo de 15 y otro con el resto.

Con eso se obtienen “clusters” de solicitudes que comparten fecha y corredor origen–destino.

### 2.2 Dónde hacer el cálculo

**Opción A – Backend (recomendada)**  
- Nuevo endpoint, ej. `GET /api/trip-requests/grouped` (o RPC en Supabase).
- Input: opcionalmente `requested_date_from`, `requested_date_to`.
- Lógica en el servidor:
  1. Traer `trip_requests` pendientes con fecha en rango y con `origin_lat/origin_lng/destination_lat/destination_lng` no nulos.
  2. Agrupar por fecha y por “corredor” (por ejemplo agrupar por celdas de grilla de ~5–10 km, o por distancia a centroides).
  3. Para cada grupo: contar solicitudes, calcular un origen/destino representativo (promedio o primera solicitud), opcionalmente generar polyline (OSRM) para ese origen/destino.
  4. Devolver lista de “rutas agrupadas”: `{ group_id, origin_label, destination_label, requested_date, requested_time (ej. primera o más común), count, max_count: 15, trip_request_ids[] }`.
- La app (conductor) solo consume esta lista y, al tocar, pide el detalle (puntos por solicitud) para dibujar el mapa.

**Opción B – Tabla “rutas agrupadas”**  
- Tabla tipo `grouped_demand_routes` (id, origin_lat, origin_lng, origin_label, destination_lat, destination_lng, destination_label, requested_date, requested_time, passenger_count, max_count, created_at, updated_at).
- Al crear o cancelar una `trip_request`, un job o trigger intenta:
  - asignar la solicitud a un grupo existente (misma fecha, origen/destino “cerca”);
  - o crear un grupo nuevo.
- El conductor lista esta tabla (o una vista) en lugar de `trip_requests` crudas. Ventaja: datos ya precalculados. Coste: mantener la tabla al día.

**Opción C – Solo en la app**  
- La app pide todas las `trip_requests` pendientes (como ahora) y agrupa en el cliente (misma lógica de proximidad y fecha). Menos escalable y más lento; no recomendable si hay muchas solicitudes.

Recomendación: **Opción A** (endpoint que agrupa on-the-fly o con caché corta). Si el volumen crece, se puede pasar a algo como la Opción B.

---

## 3. Detalle de una ruta agrupada (mapa y puntos)

- **Pantalla nueva (o modal):** ej. `GroupedRouteDetailScreen`.
- **Parámetros:** `group_id` o `trip_request_ids[]` (o los datos de la ruta agrupada devueltos por el API).
- **Datos a cargar:**
  - Lista de solicitudes del grupo (con `origin_lat, origin_lng, origin_label, destination_lat, destination_lng, destination_label`).
  - Opcional: polyline de la “ruta representativa” (origen/destino promedio o primera solicitud, vía OSRM).
- **En el mapa:**
  - **Polyline** de la ruta (si se calcula).
  - **Marcadores** por cada pasajero: por ejemplo un marcador de origen y uno de destino por solicitud (o solo origen, o agrupados en clusters si son muchos). Color o ícono distinto si hace falta (origen vs destino).
- **Texto:** “X usuarios en esta ruta”, fecha, y botón “Publicar viaje para esta ruta” que lleve a Publicar con datos prellenados y, si el backend lo soporta, con el grupo o las `trip_request_ids` vinculadas.

Así el conductor ve en un solo lugar la ruta y la distribución real de los pasajeros (puntos en el mapa).

---

## 4. Resumen de flujo

1. **Pasajero:** Buscar viajes (en el futuro con mapa para fijar origen/destino/paradas). Si no hay viaje, “Guardar solicitud” → se crea/actualiza `trip_request`.
2. **Backend (nuevo):** Agrupa `trip_requests` pendientes por fecha y corredor origen–destino (y tope 15 por grupo), expone lista de rutas agrupadas (ej. `GET /api/trip-requests/grouped`).
3. **Conductor – Solicitudes de trayecto:** Lista de **rutas agrupadas** con texto tipo “10/15 usuarios” y origen → destino.
4. **Conductor – tocar una ruta:** Se abre detalle con **mapa**, polyline de la ruta y **puntos de los pasajeros** (orígenes/destinos de las solicitudes del grupo).
5. **Conductor:** “Publicar viaje para esta ruta” → Publicar con datos de la ruta y vinculación al grupo/solicitudes.

---

## 5. Qué hay hoy y qué falta

| Parte | Hoy | Falta |
|-------|-----|--------|
| Lista en Solicitudes de trayecto | Lista de **solicitudes individuales** (una por card). | Pasar a lista de **rutas agrupadas** con N/15. |
| Detalle al tocar | Navega directo a **Publicar** con una sola `trip_request_id`. | Pantalla (o modal) **detalle de la ruta agrupada** con mapa + puntos de pasajeros, luego “Publicar viaje para esta ruta”. |
| Mapa en Solicitudes | No hay. | Mapa en la pantalla de **detalle de ruta agrupada** con polyline y marcadores de pasajeros. |
| Agrupación | No existe. | Backend (o tabla) que agrupe por fecha + proximidad origen/destino, tope 15 por grupo. |

Con esto, lo que describís (ver en Solicitudes de trayecto la lista de rutas agrupadas con 10/15, abrir y ver la ruta en el mapa con los puntos de los pasajeros) queda acotado a: backend de agrupación + nueva pantalla de detalle con mapa + cambiar la lista de Solicitudes a “rutas agrupadas”.
