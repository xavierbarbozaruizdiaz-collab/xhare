# Diagnóstico: por qué el mapa no aparece visualmente en pantallas móviles

Auditoría UI: condiciones de render, layout y flujo. Sin cambios de código.

---

## 1. Pantalla "Publicar viaje"

**Archivo exacto:** `src/screens/PublishRideScreen.tsx`

**Dónde se monta el mapa:** Líneas 487-492, dentro del mismo `ScrollView` que contiene el formulario (origen, destino, paradas, fecha, etc.).

```tsx
{routePolyline.length >= 2 && (Platform.OS === 'ios' || Platform.OS === 'android') && (
  <View style={styles.mapSection}>
    <Text style={styles.label}>Ruta</Text>
    <RouteMapView points={routePolyline} style={styles.mapWrap} />
  </View>
)}
```

**Condición exacta de render:**

1. **`routePolyline.length >= 2`**  
   `routePolyline` es un array de `{ lat, lng }`. Solo se rellena en el `useEffect` que depende de `origin`, `destination` y `waypoints` (aprox. líneas 191-223).

2. **`origin` y `destination` no son el texto del input.**  
   Son estado que solo se actualiza cuando el usuario **toca una sugerencia** de geocode:
   - `selectSuggestion(item, 'origin')` → `setOrigin(point)` con `lat`, `lng`, `label`
   - `selectSuggestion(item, 'destination')` → `setDestination(point)`  
   Si el usuario solo escribe en "Origen" y "Destino" y **no elige una fila de la lista**, `origin` y `destination` siguen en `null` → el `useEffect` pone `setRoutePolyline([])` y hace `return` → **el mapa no se muestra nunca**.

3. **Cuándo sí hay datos para el mapa:**  
   Cuando el usuario ha **seleccionado** (tap) una sugerencia para Origen y otra para Destino. Entonces:
   - El efecto corre con `origin` y `destination` definidos.
   - Primero se hace `setRoutePolyline(fallbackPoints)` (origen + waypoints + destino), así que `routePolyline.length >= 2` pasa de inmediato.
   - Luego, en async, se llama `fetchRoute` y si la API devuelve polyline se actualiza `routePolyline`.

**Layout y scroll:**

- El mapa está **en medio del ScrollView**: después de Origen, Destino, dos Paradas intermedias y del bloque "Duración estimada / Distancia" (si existe), y **antes** de Fecha, Hora, Flexibilidad, Asientos, etc.
- Estilos: `mapSection: { marginBottom: 16 }`, `mapWrap: { height: 200 }`. `RouteMapView` tiene por defecto `wrap: { width: '100%', height: 200 }`. Tiene altura fija y no está oculto por estilos.
- **Puede quedar fuera de la parte visible:** En pantallas pequeñas o con teclado abierto, el usuario puede no hacer scroll hasta "Ruta" y por tanto **no ver el mapa aunque esté renderizado**.

**Conclusión Publicar viaje:**

- **Mapa:** Implementado y condicionado.
- **Por qué no lo ves en muchas capturas:**
  - **Causa más probable:** No se ha elegido **ambos** origen y destino desde la lista de sugerencias (solo se escribió texto). Sin eso, `routePolyline` queda vacío y el bloque del mapa no se renderiza.
  - **Causa posible:** Haber elegido ambos pero no hacer scroll hacia abajo hasta la sección "Ruta" (el mapa está debajo de varios campos).
- No es un fallo de configuración nativa de Google Maps: si la condición se cumple, el componente se monta; si además la API key está bien, el mapa se dibuja.

---

## 2. Pantalla "Buscar viajes"

**Archivo exacto:** `src/screens/PassengerScreen.tsx`

**¿Hay mapa (MapView)?** **No.** No se importa `MapView`, `RouteMapView` ni `PickupDropoffMapView`. No hay ningún componente de mapa en esta pantalla.

**Qué hay:** Formulario de búsqueda (origen, destino, fecha, pasajeros, precio máx.), geocode para filtrar por proximidad (`searchAddresses`, `rideProximityCheck`), y lista de resultados (tarjetas de viajes). Todo es texto y listas.

**Conclusión Buscar viajes:**

- **Mapa:** No implementado.
- En el estado actual, esta pantalla **nunca** muestra un mapa. No es un error de configuración ni de layout: simplemente no existe vista de mapa en "Buscar viajes".

---

## 3. Pantalla "Reservar" (detalle de viaje → Reservar)

**Archivo exacto:** `src/screens/BookRideScreen.tsx`

**Dónde se monta el mapa:** Líneas 336-348.

```tsx
{useMapPickupDropoff && (
  <View style={styles.field}>
    <Text style={styles.label}>Punto de subida y bajada</Text>
    <PickupDropoffMapView
      baseRoute={baseRoute}
      pickup={mapPickup}
      dropoff={mapDropoff}
      onPickupChange={setMapPickup}
      onDropoffChange={setMapDropoff}
      height={280}
    />
  </View>
)}
```

**Condición exacta de render:** **`useMapPickupDropoff`** (aprox. línea 81), que es `baseRoute.length >= 2`.

**Qué es `baseRoute`:** Se calcula en un `useMemo` (aprox. 69-79):

- Si el viaje tiene **al menos 2** `ride_stops`: lista de puntos ordenados por `stop_order` (`{ lat, lng }`).
- Si no tiene paradas pero tiene **origen y destino con coords**: `[origen, destino]`.
- Si falta algo de eso: `[]`.

**Datos necesarios para que aparezca el mapa:**

- Viaje cargado con:
  - **O bien** al menos 2 paradas (`ride_stops`) con `lat`/`lng`,  
  - **o bien** `origin_lat`, `origin_lng`, `destination_lat`, `destination_lng` válidos.

Si el viaje viene sin coords (por ejemplo solo labels), `baseRoute` queda con longitud &lt; 2 y el mapa no se muestra. Además, dentro de `PickupDropoffMapView`, si `baseRoute.length < 2` se hace `return null` (línea 79 del componente).

**Layout:** El mapa está arriba en el scroll (después del título, ruta, hint y antes de "Paradas extra", Asientos, Precio). Altura 280. No hay estilos que lo oculten.

**Conclusión Reservar:**

- **Mapa:** Implementado y condicionado a `baseRoute.length >= 2`.
- Aparece cuando el viaje tiene ruta con al menos 2 puntos (paradas o origen+destino con coordenadas). Si no ves el mapa, el viaje que estás reservando no tiene esos datos en el backend o no se están cargando.

---

## 4. Diagnóstico resumido

| Pregunta | Respuesta |
|----------|-----------|
| **A) Pantallas que sí tienen mapa hoy** | **Reservar** (si `baseRoute.length >= 2`). **Publicar viaje** (si `routePolyline.length >= 2`, es decir, usuario eligió origen y destino desde sugerencias). |
| **B) Pantallas que no tienen mapa hoy** | **Buscar viajes** (no hay MapView implementado). |
| **C) Condición para que aparezca** | **Publicar:** `routePolyline.length >= 2` → en la práctica, **haber seleccionado** una sugerencia de Origen y una de Destino (tap en la lista). **Reservar:** `baseRoute.length >= 2` → viaje con al menos 2 puntos de ruta (paradas o origen+destino con coords). **Buscar:** ninguna; no hay mapa. |
| **D) ¿Problema de configuración nativa o de UI/flujo?** | **Principalmente UI/flujo:** En Publicar, la condición de "origen/destino elegidos desde sugerencias" y la posición del mapa en el scroll explican que no lo veas si solo escribís o no hacés scroll. En Buscar, es que el mapa no está implementado. La configuración de Google Maps afecta solo a que el mapa se **dibuje** cuando el componente **sí** se monta (p. ej. en Android con API key). |

---

## 5. Cambio mínimo recomendado para "Publicar viaje"

Objetivo: que el mapa sea visible siempre que haya origen y destino con coordenadas, y que sea más evidente para el usuario.

**Opción A – Condición igual, mejor visibilidad**

- No cambiar la lógica: el mapa sigue mostrándose solo cuando `routePolyline.length >= 2`.
- **Mover el bloque del mapa** justo después de los campos Origen y Destino (y sus sugerencias), por ejemplo antes de "Parada intermedia 1". Así, en cuanto el usuario elige origen y destino, el mapa aparece sin tener que hacer tanto scroll.
- Opcional: añadir un texto tipo "Elegí origen y destino arriba para ver la ruta" cuando `routePolyline.length < 2`, para dejar claro que hay que elegir de la lista.

**Opción B – Mostrar mapa en cuanto haya 2 puntos (sin depender de API)**

- La condición sigue siendo tener 2+ puntos. Hoy esos puntos se rellenan cuando el usuario elige sugerencias (y el efecto pone primero `fallbackPoints` y luego puede actualizar con la polyline de la API). No hace falta cambiar eso para "mostrar algo".
- Asegurar que en el efecto, cuando hay `origin` y `destination`, **siempre** se llame a `setRoutePolyline(fallbackPoints)` (ya se hace), y que no haya ningún camino donde `routePolyline` quede vacío con origen y destino elegidos. Con el código actual ya debería mostrarse; si en algún flujo no se ve, revisar que `selectSuggestion` efectivamente setee `origin`/`destination` con `lat`/`lng`.

**Recomendación mínima:** Aplicar **Opción A** (mover la sección "Ruta" + `RouteMapView` más arriba en el scroll, justo después de Destino) y, si se quiere, el texto de ayuda cuando aún no hay ruta. Eso mejora la UX sin tocar la lógica de negocio ni la configuración nativa.

---

## 6. Buscar viajes: aclaración

En **Buscar viajes** el mapa **no está implementado**. No es un fallo de Google Maps ni de layout: esa pantalla solo tiene búsqueda textual/geográfica y lista de resultados. Si se quiere una "vista con mapa como referencia de ruta", habría que **añadir** un componente de mapa (por ejemplo un mapa con la ruta o los resultados), lo cual sería una nueva funcionalidad, no la corrección de algo que ya exista.

---

## Checklist rápido

- **Publicar viaje:** Mapa implementado; se muestra solo si elegís origen y destino desde las sugerencias; además puede quedar fuera de vista si no hacés scroll hasta "Ruta".
- **Buscar viajes:** Mapa no implementado; la pantalla nunca muestra mapa.
- **Reservar:** Mapa implementado; se muestra cuando el viaje tiene al menos 2 puntos de ruta (paradas o origen+destino con coords).
- **Configuración nativa (Google Maps):** Afecta al render del mapa cuando el componente sí se monta; no explica por sí sola que "no veas el mapa" en Publicar si la causa es no elegir sugerencias o no hacer scroll.
