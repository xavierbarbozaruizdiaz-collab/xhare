# Faltantes en la app móvil vs versión web

Lista actualizada de lo que **aún falta** en la app móvil (Expo) para equiparar la experiencia a la web.  
Lo que **ya está implementado** en móvil se indica como ✅.

---

## ✅ Ya implementado en móvil

### Pasajero – Buscar viajes
- Etiquetas en campos (Origen, Destino, Fecha, Pasajeros, Precio máx., Ordenar).
- Date picker nativo.
- Filtro por pasajeros (1–8) y precio máximo.
- Ordenar por: más temprano, más barato, más asientos.
- Avatar del conductor, valoración (estrellas), duración estimada en cada tarjeta.
- Mensaje cuando no hay resultados y bloque **“Guardar mi solicitud”** (hora + botón).
- **Búsqueda por proximidad**: si hay origen y destino con coords (geocode), se filtran viajes a ≤2 km de la ruta y en orden.
- Pantalla **“Mis solicitudes”** y enlace desde Buscar viajes.
- Botón “Actualizar” y pull to refresh.

### Pasajero – Mis reservas
- Badge de estado, cancelar reserva, navegación al detalle del viaje.

### Conductor – Publicar viaje
- Geocoding / autocompletado para origen y destino.
- **Paradas intermedias (waypoints)**: hasta 2, con sugerencias de geocode.
- Llamada a `/api/route/polyline` con origen, destino y waypoints → duración y distancia.
- Date y time picker para fecha/hora de salida.
- Validación de fecha/hora futura; uso de `vehicle_seat_count` y datos del perfil.
- Creación de `ride_stops`: origen, waypoints, destino.

### Conductor – Mis viajes
- Listado de viajes, reservas por viaje, navegación a detalle y a publicar/editar.

### General
- Preferencia de navegación (Maps/Waze) en Ajustes.
- Detalle de viaje, reservar (BookRide), editar viaje.

---

## Lo que falta para quedar igual que en la web

### 1. Mensajes (pasajero y conductor) ✅
- **Web:** `/messages` (lista de conversaciones) y `/messages/[id]` (chat con conductor/pasajero). Tablas `conversations`, `chat_messages`.
- **Móvil:** ✅ Lista de conversaciones (MessagesScreen), chat (ChatScreen) con realtime. Acceso desde Inicio y Ajustes.

### 2. Viajes a oferta (“Offer”) ✅
- **Web:** `/offer` con “Busco” (pasajero busca trayecto) y “Tengo” (conductor ofrece asientos). Rutas como `/offer/busco`, `/offer/tengo`, detalle y creación de ofertas/demandas.
- **Móvil:** ✅ OfferScreen, OfferBusco, OfferTengo, creación (OfferBuscoNew, OfferTengoNew). Acceso desde Ajustes.

### 3. Conductor – Publicar desde una solicitud de pasajero ✅
- **Web:** El conductor entra a `/driver/trip-requests`, ve solicitudes pendientes, y puede ir a publicar con `?trip_request_id=...`. Se pre-rellenan origen/destino/fecha desde la solicitud y se vincula el viaje a la solicitud (y se marcan solicitudes como aceptadas).
- **Móvil:** ✅ DriverTripRequestsScreen (“Solicitudes” en pestaña Conductor). “Publicar viaje para esta” navega a PublishRide con `tripRequestId`; se pre-rellenan datos desde la solicitud.

### 4. Conductor – “Volver a agendar” desde un viaje ✅
- **Web:** En “Mis viajes” (y en viajes finalizados) hay enlace “Volver a agendar” que lleva a `/publish?from_ride_id=...` y pre-rellena origen, destino y fecha desde ese viaje.
- **Móvil:** ✅ En viajes finalizados aparece “Volver a agendar”; navega a PublishRide con `fromRideId`.

### 5. Conductor – Flexibilidad de salida al publicar ✅
- **Web:** Opción “Salida estricta (5 min)” vs “Flexible (hasta 30 min)” (`strict_5` / `flexible_30`). Se guarda `flexible_departure` (y/o `departure_flexibility`) en el viaje.
- **Móvil:** ✅ Opciones “Estricta (5 min)” y “Flexible (30 min)” en PublishRideScreen; se envía en el payload.

### 6. Conductor – Setup de vehículo ✅
- **Web:** `/driver/setup` para configurar modelo, año, asientos, etc. antes de publicar (y para cumplir requisitos).
- **Móvil:** ✅ VehicleSetupScreen (modelo, año, asientos). Acceso desde Ajustes → “Configurar vehículo”.

### 7. Mapas
- **Web:** En publicar hay mapa para elegir origen/destino/waypoints; en **reservar** hay mapa para marcar punto de subida (A) y bajada (B); en búsqueda se puede mostrar mapa con resultados.
- **Móvil:** ✅ **Reservar:** mapa con ruta del viaje donde el pasajero toca para marcar subida (A) y bajada (B); precio por tramo con esas coordenadas (segment-stats). La ruta se puede abrir en Maps/Waze desde el detalle del viaje. **Pendiente/opcional:** mapa en publicar (origen/destino/waypoints) y mapa en búsqueda.

### 8. (Opcional) Mis viajes – pestaña “Finalizados” ✅
- **Web:** Vista separada o filtro “Finalizados” en Mis viajes.
- **Móvil:** ✅ DriverScreen tiene pestañas “Próximos” y “Finalizados”.

### 9. (Opcional) Admin
- **Web:** Zona `/admin` (usuarios, conductores, viajes, facturación, etc.).
- **Móvil:** No suele ser necesario en app de usuario; se puede omitir.

---

## Resumen priorizado de faltantes

| Prioridad | Faltante | Estado |
|-----------|----------|--------|
| ~~Alta~~ | ~~Mensajes (lista + chat)~~ | ✅ Implementado |
| ~~Alta~~ | ~~Conductor: Solicitudes de trayecto + publicar con `trip_request_id`~~ | ✅ Implementado |
| ~~Media~~ | ~~Flexibilidad de salida (strict_5 / flexible_30)~~ | ✅ Implementado |
| ~~Media~~ | ~~“Volver a agendar” (`from_ride_id`)~~ | ✅ Implementado |
| ~~Media~~ | ~~Viajes a oferta (Offer – Busco / Tengo)~~ | ✅ Implementado |
| ~~Media~~ | ~~Setup vehículo~~ | ✅ Implementado |
| ~~Media~~ | Mapa en reservar (marcar A/B como Uber/Bolt) | ✅ Implementado |
| Baja     | Mapas en publicar/búsqueda | Opcional (react-native-maps) |
| Baja     | Admin en móvil | No recomendado |

Queda como **opcional** solo: mapas en publicar/búsqueda y admin. El resto está alineado con la web.
