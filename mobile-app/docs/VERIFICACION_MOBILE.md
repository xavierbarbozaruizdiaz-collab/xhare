# Verificación app móvil: estética, función, lógica

Revisión de gaps frente a la web y mejoras de UX/consistencia.

---

## ✅ Corregido en esta revisión

- **Confirmación antes de cancelar**: reserva (RideDetail + Pasajero) y solicitud (Mis solicitudes) piden confirmación con `Alert.alert` antes de cancelar.
- **Listas Offer**: al volver de "Nueva solicitud" / "Publicar lugar", las pantallas Busco y Tengo recargan la lista (`useFocusEffect`).
- **Hint búsqueda**: texto del estado vacío actualizado para mencionar filtro por proximidad cuando hay origen y destino.
- **EditRide hora**: se usa hora/minutos del `Date` en lugar de `toTimeString().slice(0,5)` para evitar problemas de locale.

---

## Estética / UX

| Aspecto | Estado | Nota |
|--------|--------|------|
| Colores y botones | OK | Verde #166534 consistente, botones primarios claros |
| Loading | OK | ActivityIndicator en cargas, "Buscando…", "Guardando…" |
| Estados vacíos | OK | Mensajes en listas vacías, Mis reservas, Mis solicitudes, Offer |
| Pull to refresh | OK | Donde hay listas (Pasajero, Conductor, Mensajes, etc.) |
| Confirmaciones destructivas | OK | Cancelar reserva y cancelar solicitud piden confirmación |
| Teclado | OK | KeyboardAvoidingView en Login y Chat |
| Scroll | OK | ScrollView/FlatList con contentContainerStyle |

---

## Función / Lógica

| Aspecto | Estado | Nota |
|--------|--------|------|
| Búsqueda por proximidad | OK | Geocode origen/destino, filtro ≤2 km y orden |
| Publicar con waypoints | OK | Hasta 2 paradas, polyline y ride_stops |
| Flexibilidad salida | OK | strict_5 / flexible_30 en payload |
| Volver a agendar / trip_request_id | OK | Prellenado y vinculado |
| Reserva (BookRide) | OK | Con ride_stops: elegir parada subida/bajada; precio por tramo (segment-stats + pricing_settings). Sin paradas: price_per_seat × asientos |
| Reserva pickup/dropoff | OK | Selector de parada de subida y parada de bajada desde ride_stops del viaje |
| Pricing por segmento | OK | Distancia vía /api/route/segment-stats; tarifa con pricing_settings activo o fallback (min fare, PYG/km, bloques) |
| Mensajes | OK | Lista + chat + realtime |
| Ofertas Busco/Tengo | OK | Crear y listar en app |

---

## Detalle reserva (BookRide) vs web

**Implementado:** En reservar se muestra un **mapa** con la ruta del viaje; el pasajero **toca el mapa** para marcar punto de subida (A) y punto de bajada (B), tipo Uber/Bolt. Con ambos puntos se llama a `POST /api/route/segment-stats` (OSRM) y el precio se calcula con las mismas reglas que la web (pricing_settings o fallback). Paradas extra (texto libre, hasta 3) se mantienen. En viajes sin paradas se usa origen/destino y price_per_seat × asientos.

**Android – mapa visible:** En el APK, el mapa (react-native-maps) usa Google Maps. Para que no salga en blanco hay que configurar una API key: en Google Cloud Console activar "Maps SDK for Android", crear una API key, y definir `GOOGLE_MAPS_ANDROID_API_KEY` en `.env` (local) o en EAS Secrets (build). Ver `app.config.js` → `android.config.googleMaps.apiKey`.

**Config:** `EXPO_PUBLIC_API_BASE_URL` apuntando al backend Next.js (sin barra final). Sin ella, en viajes con paradas se usa tarifa mínima de fallback.

---

## Lógica / edge cases

| Aspecto | Estado | Nota |
|--------|--------|------|
| Fecha/hora futura | OK | Validado en Publicar y EditRide |
| Solapamiento conductor | OK | EditRide y backend (driver_ride_overlap) |
| Asientos máximos | OK | Límites 1–20 (Offer), 1–8 (búsqueda), etc. |
| Hora en EditRide | OK | Formato HH:mm con getHours/getMinutes |
| Refresco al volver a Offer | OK | useFocusEffect en OfferBusco y OfferTengo |

---

## Opcional / mejoras futuras

- **Recuperar contraseña**: ✅ Implementado. En Login: "¿Olvidaste tu contraseña?" → envía enlace por email (Supabase `resetPasswordForEmail`).
- **Accesibilidad**: ✅ Implementado. `accessibilityLabel`, `accessibilityHint` y `accessibilityRole` en Login, Conductor (tabs, FAB, cards), Ajustes, Reservar, Detalle viaje, Pasajero (tabs, Buscar), Publicar, Configurar vehículo, Mensajes, Chat.
- **Deep links**: ✅ Implementado. Scheme `xhare`. URLs: `xhare://ride/{rideId}` → Detalle del viaje, `xhare://chat/{conversationId}` → Chat. Al tocar una notificación push se abre el deep link si el payload incluye `data.rideId`, `data.conversationId` o `data.url` (xhare://).
- **Offline**: sin soporte offline; todo depende de red.

---

## Qué se pasó por alto (y ya está corregido)

- **Mapa en reservar:** En la web el pasajero marca en un **mapa** el punto de subida y bajada (tipo Uber/Bolt). En móvil se había implementado solo la **lista de paradas** (elegir “Parada 1”, “Parada 2”), sin mapa. Ya está: en reservar se muestra el mapa con la ruta; el usuario toca para marcar A y B; el precio se calcula con esas coordenadas.

## Posiblemente pendiente (opcional)

- **Mapa al publicar:** En web el conductor elige origen/destino/waypoints en un mapa; en móvil solo formulario + geocode. Opcional.
- **Mapa en búsqueda:** Mostrar resultados en un mapa. Opcional.
- **Admin en móvil:** No previsto; se usa la web.

---

## Resumen

- **Estética**: coherente; loading, vacíos y confirmaciones destructivas cubiertos.
- **Función**: flujos principales alineados con web; reserva con **mapa** para marcar subida/bajada y precio por tramo.
- **Lógica**: validaciones y refrescos corregidos o verificados.
