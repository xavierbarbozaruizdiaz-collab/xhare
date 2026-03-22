# Auditoría: sistema de mapas y rutas (mobile-app)

Análisis del estado actual sin modificar código. Solo diagnóstico.

---

## A) ARQUITECTURA ACTUAL

### Diagrama textual del flujo

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ FLUJO 1: PUBLICAR VIAJE (conductor)                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│ Usuario escribe Origen / Destino / Paradas                                    │
│        ↓                                                                      │
│ Geocode: GET /api/geocode/search?q=... (backend → Nominatim)                  │
│        ↓                                                                      │
│ Usuario elige sugerencia → coords (lat, lon desde Nominatim → lng en app)   │
│        ↓                                                                      │
│ Con origen + destino (+ waypoints): POST /api/route/polyline                  │
│        ↓                                                                      │
│ Backend → OSRM route/v1/driving/{lng,lat};...?overview=full&geometries=geojson│
│        ↓                                                                      │
│ Backend transforma geometry.coordinates [lng,lat] → [{ lat, lng }]          │
│        ↓                                                                      │
│ App recibe polyline + durationMinutes + distanceKm                            │
│        ↓                                                                      │
│ RouteMapView dibuja Polyline + Marker origen (verde) + Marker destino (rojo) │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ FLUJO 2: RESERVAR VIAJE (pasajero) – mapa pickup/dropoff                     │
├─────────────────────────────────────────────────────────────────────────────┤
│ Usuario entra a Reservar → se cargan ride + ride_stops                      │
│        ↓                                                                      │
│ baseRoute = ride_stops ordenados por stop_order O bien [origen, destino]     │
│        ↓                                                                      │
│ PickupDropoffMapView recibe baseRoute (NO viene de OSRM en este paso)        │
│        ↓                                                                      │
│ Usuario toca mapa → marca A (subida), luego B (bajada)                       │
│        ↓                                                                      │
│ POST /api/route/segment-stats { origin: A, destination: B }                  │
│        ↓                                                                      │
│ Backend → OSRM route/v1/driving/{lng,lat};{lng,lat}?overview=false          │
│        ↓                                                                      │
│ Backend devuelve distanceKm + durationMinutes (si OSRM falla se devuelve error) │
│        ↓                                                                      │
│ App calcula precio (segment-fare + runtime-pricing) y muestra en UI         │
│        ↓                                                                      │
│ MapView ya tiene Polyline (baseRoute) + Marker A (rojo) + Marker B (azul)  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ FLUJO 3: BÚSQUEDA POR PROXIMIDAD (pasajero)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ Usuario escribe Origen + Destino en Buscar viajes                            │
│        ↓                                                                      │
│ Geocode: searchAddresses(origin) y searchAddresses(destination)               │
│        → GET /api/geocode/search (Nominatim)                                   │
│        ↓                                                                      │
│ searchRides() devuelve lista de viajes (Supabase)                           │
│        ↓                                                                      │
│ rideProximityCheck(ride, originCoords, destCoords) por cada viaje            │
│        → buildPolylineFromRide(ride) desde base_route_polyline o ride_stops  │
│        → distancePointToPolylineMeters + getPositionAlongPolyline             │
│        → match = ≤2 km y orden origen < destino en la polyline               │
│        ↓                                                                      │
│ Sin mapa en esta pantalla; solo filtrado y orden.                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Resumen:** Usuario selecciona origen/destino → frontend llama endpoint interno → endpoint llama OSRM (o Nominatim en geocode) → respuesta se transforma (polyline o stats) → MapView dibuja Polyline/Markers cuando corresponde.

---

## B) ARCHIVOS CLAVE

### Mapa (render)

| Archivo | Uso |
|--------|-----|
| `src/components/PickupDropoffMapView.tsx` | Mapa en **Reservar**: ruta del viaje (polyline), usuario toca para A/B, Markers rojo/azul. |
| `src/components/RouteMapView.tsx` | Mapa en **Publicar viaje**: polyline origen→waypoints→destino, Marker origen (verde), Marker destino (rojo). |

No hay más componentes que usen `MapView` en mobile-app (no existe `MapComponent.tsx` ni `RideRouteMap.tsx` en móvil; esos son de la web).

### Routing (llamadas a backend / OSRM)

| Archivo | Uso |
|--------|-----|
| `src/backend/routeApi.ts` | `fetchRoute(origin, destination, waypoints)` → POST `/api/route/polyline`. `fetchSegmentStats(origin, destination)` → POST `/api/route/segment-stats`. |
| Backend (fuera de mobile-app): `src/app/api/route/polyline/route.ts` | Recibe origin/destination/waypoints, llama OSRM, devuelve polyline + durationMinutes + distanceKm. |
| Backend: `src/app/api/route/segment-stats/route.ts` | Recibe origin/destination (pickup/dropoff), llama OSRM, devuelve distanceKm + durationMinutes. |

### Geocoding

| Archivo | Uso |
|--------|-----|
| `src/backend/geocodeApi.ts` | `searchAddresses(query, limit)` → GET `/api/geocode/search?q=...&countrycodes=py`. |
| Backend: `src/app/api/geocode/search/route.ts` | Proxy a Nominatim. |

### Cálculo de precio (basado en ruta/segmento)

| Archivo | Uso |
|--------|-----|
| `src/lib/pricing/segment-fare.ts` | `baseFareFromDistanceKmWithPricing`, `totalFareFromBaseAndSeatsWithPricing` (minFare, PYG/km, bloques). |
| `src/lib/pricing/runtime-pricing.ts` | `loadActivePricingSettings`, `computeEffectivePricing` (DB o fallback). |
| Usado en `BookRideScreen` cuando hay segment-stats (mapPickup/mapDropoff o paradas). |

### Utilidades geo (polyline, proximidad)

| Archivo | Uso |
|--------|-----|
| `src/lib/geo.ts` | `distanceMeters`, `distancePointToPolylineMeters`, `getPositionAlongPolyline`, `buildPolylineFromRide`, `rideProximityCheck`. Usado en búsqueda por proximidad (PassengerScreen) y lógica de “corredor”. |

---

## C) FLUJO OSRM

### Endpoint 1: `/api/route/polyline` (usado en Publicar viaje)

- **Quién lo llama:** `routeApi.fetchRoute(origin, destination, waypoints)` desde `PublishRideScreen`.
- **Método y body:** `POST`, body: `{ origin: { lat, lng }, destination: { lat, lng }, waypoints: [{ lat, lng }, ...] }`.
- **Backend:** Construye URL OSRM:
  - Base: `https://router.project-osrm.org`
  - Path: `route/v1/driving/{origin.lng},{origin.lat};[waypoints];{dest.lng},{dest.lat}`
  - Query: `overview=full&geometries=geojson`
- **Respuesta OSRM:** `routes[0].geometry.coordinates` = array `[lng, lat]`; `duration` (segundos), `distance` (metros).
- **Transformación:** `coords.map(([lng, lat]) => ({ lat, lng }))` → polyline en formato app. Si OSRM falla (NoRoute, etc.), se devuelve error 502 y no se estima duración localmente.
- **Qué recibe la app:** `{ polyline: [{ lat, lng }, ...], durationMinutes?, distanceKm? }`.
- **Cómo llega al mapa:** `PublishRideScreen` guarda `result.polyline` en `routePolyline`; si hay ≥2 puntos y es iOS/Android, renderiza `<RouteMapView points={routePolyline} />`.

### Endpoint 2: `/api/route/segment-stats` (usado en Reservar)

- **Quién lo llama:** `routeApi.fetchSegmentStats(origin, destination)` desde `BookRideScreen` (cuando hay mapPickup+mapDropoff o pickupStop+dropoffStop, o solo origen/destino sin paradas).
- **Método y body:** `POST`, body: `{ origin: { lat, lng }, destination: { lat, lng } }`.
- **Backend:** URL: `route/v1/driving/{origin.lng},{origin.lat};{destination.lng},{destination.lat}?overview=false`.
- **Respuesta OSRM:** `routes[0].distance` (metros), `duration` (segundos).
- **Transformación:** distanceKm = distance/1000, durationMinutes = ceil(duration/60). Si OSRM falla, se devuelve error 502 y no se estima duración localmente.
- **Qué recibe la app:** `{ distanceKm?, durationMinutes? }` (no polyline).
- **Uso en mapa:** No se dibuja una nueva polyline con OSRM aquí; la polyline del mapa en Reservar es `baseRoute` (ride_stops u origen/destino). OSRM solo aporta distancia/duración para precio.

---

## D) ESTADO DEL MAPA

- **react-native-maps:** Se usa en los dos componentes de mapa; en Android, la API key de Google Maps se inyecta vía `app.config.js` (`GOOGLE_MAPS_ANDROID_API_KEY` → `android.config.googleMaps.apiKey`). Sin key el mapa puede quedar en blanco en Android.
- **Polyline:**
  - **RouteMapView:** Recibe `points` (array `{ lat, lng }`), los convierte a `coordinates` con `latitude: p.lat, longitude: p.lng`, y usa `<Polyline coordinates={coordinates} strokeColor="#166534" strokeWidth={4} />`. Correcto.
  - **PickupDropoffMapView:** Igual: `baseRoute` → `coordinates` con `latitude`/`longitude`, `<Polyline coordinates={coordinates} strokeColor="#166534" strokeWidth={4} />`. Correcto.
- **Markers:**
  - **RouteMapView:** Origen = primer punto, `pinColor="green"`, title "Origen"; destino = último punto, `pinColor="red"`, title "Destino".
  - **PickupDropoffMapView:** Subida (A) = `pinColor="#dc2626"`, Bajada (B) = `pinColor="#2563eb"`. Coordenadas desde estado `mapPickup` / `mapDropoff` (`latitude`, `longitude`). Correcto.
- **Convención de coordenadas:** En toda la app móvil y en los endpoints se usa `{ lat, lng }`. El backend traduce a OSRM (lng,lat) al armar la URL. No hay inversión lat/lng en los componentes de mapa.

---

## E) POSIBLES PROBLEMAS

1. **Mapa en blanco en Android:** Si `GOOGLE_MAPS_ANDROID_API_KEY` no está definida en el build (EAS Secret o env), `android.config.googleMaps` no se inyecta y el mapa puede mostrarse vacío. Ya documentado en VERIFICACION_MOBILE y app.config.
2. **Ruta no dibujada en Reservar si el viaje no tiene coords:** Si `baseRoute.length < 2` (por ejemplo ride sin `origin_lat/lng` o `ride_stops`), `PickupDropoffMapView` retorna `null` y no se muestra mapa. Comportamiento esperado; el riesgo es un viaje mal cargado desde backend.
3. **Polyline en Publicar antes de respuesta OSRM:** Al tener origen y destino, se hace primero `setRoutePolyline(fallbackPoints)` (línea recta) y luego, al llegar la respuesta, `setRoutePolyline(result.polyline)`. Si OSRM falla o la API no está configurada, se queda la línea recta. No es un bug; es fallback.
4. **Recálculos de ruta en Publicar:** El `useEffect` que llama a `fetchRoute` depende de `origin?.lat, origin?.lng, destination?.lat, destination?.lng, waypoints`. Cada cambio de waypoint o de origen/destino dispara una nueva llamada. No hay debounce en este efecto; si el usuario cambia rápido, puede haber varias peticiones. El backend tiene rate limit y caché (5 min por misma key), lo que mitiga abuso.
5. **Segment-stats en BookRide:** Se llama a `fetchSegmentStats` cuando cambian `mapPickup`, `mapDropoff` o paradas. No hay debounce: un toque en el mapa dispara la llamada de inmediato. Aceptable para 2 puntos; si en el futuro se hiciera algo más dinámico, podría valorarse debounce.
6. **Geocode: convención lon vs lng:** Nominatim devuelve `lon`; en `geocodeApi.ts` el tipo usa `lon` y en `selectSuggestion` se usa `parseFloat(s.lon)` para el valor que se guarda como `lng`. Consistente; no hay bug.
7. **buildPolylineFromRide (geo.ts):** Si `base_route_polyline` viene como GeoJSON `[lng, lat]`, se usa `lat: p.lat ?? p[1], lng: p.lng ?? p[0]`. Correcto para arrays tipo `[lng, lat]`.
8. **distanceToSegment en geo.ts:** Usa aproximación plana (`* 111000` para grados→metros aproximado). Para distancias cortas (corredor 2 km) es aceptable; para rutas muy largas podría subestimarse. No afecta al flujo principal de mapas.
9. **EXPO_PUBLIC_API_BASE_URL vacío:** Si no está configurado, `fetchRoute` y `fetchSegmentStats` devuelven `{ error: '...' }` y no se obtiene polyline ni segment-stats. La UI muestra fallback (línea recta en Publicar) o sin precio por tramo en Reservar. Documentado.
10. **Sin validación de “corredor” en Reservar:** El pasajero puede marcar A y B en cualquier parte del mapa; no se valida que estén cerca de la ruta del viaje. El precio se calcula igual (segment-stats A→B). Mejora posible: avisar o rechazar si A/B están muy lejos de la polyline (igual que en web con `isWithinCorridor`).

---

## F) MEJORAS RECOMENDADAS (estructurales, sin reescribir)

1. **Debounce en Publicar:** Añadir debounce (ej. 300–500 ms) al efecto que llama a `fetchRoute` cuando cambian origen/destino/waypoints, para evitar rafagas de peticiones al escribir o cambiar sugerencias.
2. **EAS / env:** Mantener `GOOGLE_MAPS_ANDROID_API_KEY` en EAS Secrets para el perfil production (y preview si se usa) y documentar en un solo lugar (ej. README o VERIFICACION_MOBILE) los pasos para obtener la key y el SHA-1.
3. **Opción provider en MapView:** En Android, react-native-maps usa Google por defecto cuando está la API key. No es obligatorio, pero se puede fijar explícitamente `provider={PROVIDER_GOOGLE}` en los dos componentes de mapa para evitar ambigüedad si en el futuro se añade otro provider.
4. **Manejo de error de segment-stats en UI:** Si `fetchSegmentStats` devuelve `error`, en BookRideScreen se deja `segmentDistanceKm` y `segmentBaseFare` en null; el usuario puede no entender por qué no ve precio. Mostrar un mensaje breve (“No se pudo calcular el precio del tramo”) cuando `res.error` y hay mapPickup+mapDropoff.
5. **Cache de rutas en app:** El backend ya cachea polyline por 5 min. La app no cachea; cada montaje de PublishRide o cambio de origen/destino vuelve a llamar. Para ahorrar llamadas se podría cachear en memoria por clave (origen,destino,waypoints) con TTL corto; opcional y de bajo impacto.
6. **Validación opcional de corredor en Reservar:** Reutilizar `distancePointToPolylineMeters` (o equivalente) para comprobar que mapPickup y mapDropoff estén a menos de X metros de `baseRoute` y mostrar advertencia o deshabilitar confirmar si se excede; alinear con la lógica de la web si existe.

---

## Resumen por pregunta

| Pregunta | Respuesta |
|----------|-----------|
| ¿Dónde se usa el mapa? | `PickupDropoffMapView.tsx` (Reservar), `RouteMapView.tsx` (Publicar). |
| ¿Cómo se calcula la ruta? | Backend llama OSRM; polyline vía `/api/route/polyline`; segment-stats vía `/api/route/segment-stats`. |
| ¿Polyline de OSRM al mapa? | En Publicar: sí (polyline devuelta por API → RouteMapView). En Reservar: la polyline del mapa es la ruta del viaje (ride_stops o origen/destino); OSRM solo da distancia/duración para precio. |
| ¿Fallback si OSRM falla? | Sí: polyline = puntos en línea recta y duración estimada (polyline); haversine + duración estimada (segment-stats). |
| ¿Cache? | Backend: sí (polyline 5 min en memoria; segment-stats no cacheado). App: no. |
| ¿Validación distancia/corredor? | Búsqueda: sí (rideProximityCheck ≤2 km y orden). Reservar: no validación de corredor para A/B en el mapa. |
| ¿Precio basado en ruta? | Sí: segment-stats devuelve distanceKm → baseFareFromDistanceKmWithPricing → total con asientos. |
| ¿Rendimiento? | Sin debounce en fetchRoute (varias llamadas si el usuario cambia rápido); backend con rate limit y cache. useMemo en coordenadas/region en ambos mapas. |
| ¿Bugs lat/lng? | No detectados; convención { lat, lng } consistente; backend convierte a lng,lat para OSRM. |
