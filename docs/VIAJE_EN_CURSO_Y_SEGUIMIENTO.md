# Inicio del viaje, seguimiento y burbuja flotante

## Estado actual

### Inicio del viaje (conductor)
- **Base de datos:** La tabla `rides` tiene `status` con valores: `draft`, `published`, `booked`, `en_route`, `completed`, `cancelled`.
- **API:** Existe `POST /api/rides/[id]/update-status` que permite al conductor actualizar el estado (por ejemplo a `en_route` o `completed`). Solo el dueño del viaje (driver) puede llamarla.
- **UI:** En la página del viaje (`/rides/[id]`) el conductor hoy solo ve "Editar viaje" y "Mis viajes". **No hay botones "Iniciar viaje" ni "Finalizar viaje".**

### Seguimiento y actualización del recorrido
- **Ruta estática:** El mapa muestra la ruta planificada (polyline, paradas, recogidas/bajadas de pasajeros). No hay actualización en tiempo real.
- **Posición del conductor en vivo:** No existe. No se guarda ni se muestra la ubicación GPS del conductor durante el viaje.
- Para tener seguimiento en vivo haría falta:
  - Guardar la posición del conductor (tabla nueva o columnas en `rides`: `driver_lat`, `driver_lng`, `driver_location_updated_at`).
  - Que la app del conductor envíe la posición cada X segundos mientras el viaje está `en_route`.
  - Que la app del pasajero (o una pantalla compartida) consulte esa posición y la dibuje en el mapa.

### Burbuja flotante / mantener la app activa
- **Web/React:** No hay ningún componente tipo "burbuja" ni barra fija que indique "Viaje en curso" al navegar por la app.
- **Mantener la app activa:**
  - En **navegador/PWA:** una barra o burbuja fija que muestre "Viaje en curso" ayuda a que el usuario no cierre la pestaña; no evita que el sistema suspenda la pestaña en segundo plano.
  - En **app nativa (Android):** se suele usar un *Foreground Service* con notificación persistente ("Viaje en curso") para que el sistema no mate la app y el GPS siga enviando posición.
  - En **iOS:** permisos de ubicación "siempre" o "mientras se usa la app" y, si se quiere seguimiento en segundo plano, capacidades de ubicación en background.

---

## Plan sugerido (por fases)

### Fase 1 – Controles del conductor (rápido)
1. En la página del viaje (`/rides/[id]`), si el usuario es el conductor:
   - Si `status` es `published` o `booked`: mostrar botón **"Iniciar viaje"** que llame a `POST /api/rides/[id]/update-status` con `{ "status": "en_route" }`.
   - Si `status` es `en_route`: mostrar botón **"Finalizar viaje"** que llame con `{ "status": "completed" }`.
2. Recargar el viaje después de cambiar el estado para que se vea el nuevo estado y los botones correctos.

### Fase 2 – Barra / “burbuja” de viaje en curso
1. **Contexto o estado global:** Saber si el usuario (conductor) tiene algún viaje con `status = 'en_route'`. Puede ser:
   - Un hook que consulte "mis viajes" y filtre por `en_route`, o
   - Un contexto React que guarde "ride en curso" al pulsar "Iniciar viaje".
2. **Componente de barra fija:** Un componente (por ejemplo `ActiveRideBar`) que se muestre fijo arriba o abajo de la pantalla cuando haya un viaje en curso:
   - Texto: "Viaje en curso: [origen] → [destino]" (o similar).
   - Botón "Ver viaje" que lleve a `/rides/[id]`.
   - Botón "Finalizar" que llame a update-status `completed` (opcional, o solo desde la página del viaje).
3. Mostrar esta barra en el layout principal (o en las páginas que correspondan) para que se vea mientras el conductor navega por la app.

### Fase 3 – Seguimiento en vivo ✅ Implementado
1. **Base de datos:** Migración `029_ride_driver_location.sql` añade a `rides`: `driver_lat`, `driver_lng`, `driver_location_updated_at`.
2. **API:** `POST /api/rides/[id]/location` (body `{ lat, lng }`). Solo el conductor del viaje y solo si `status = 'en_route'`.
3. **App conductor:** En la página del viaje, cuando el usuario es conductor y el viaje está `en_route`, se envía la posición cada 20 s vía `navigator.geolocation.getCurrentPosition` → `POST .../location`.
4. **Mapa:** El componente `RideRouteMap` recibe la prop `driverLocation`; cuando el viaje está `en_route` y hay posición guardada, se muestra un marcador azul "Conductor en camino". La página del viaje hace polling cada 12 s para refrescar datos (posición del conductor) para conductor y pasajeros.

### Fase 4 – Mantener la app activa ✅ Implementado (notificación local)
- **Notificación al iniciar viaje:** Al pulsar "Iniciar viaje", si el navegador permite notificaciones, se muestra una notificación "Viaje en curso - Xhare" (y si el permiso no estaba dado, se pide). Al tocarla se enfoca la ventana de la app.
- **App nativa (futuro):** Foreground Service (Android) y permisos de ubicación en background (iOS/Android) para que el envío de posición siga aunque la app no esté en primer plano.

---

## Resumen

| Funcionalidad | Estado actual | Acción sugerida |
|---------------|----------------|-----------------|
| Conductor inicia viaje | API existe, sin botón en UI | Fase 1: botones "Iniciar viaje" y "Finalizar viaje" en `/rides/[id]` |
| Conductor finaliza viaje | Mismo API | Incluido en Fase 1 |
| Barra / burbuja "Viaje en curso" | No existe | Fase 2: componente fijo + contexto o consulta de viaje en curso |
| Seguimiento en vivo (posición conductor) | ✅ Implementado | Migración 029, API POST /location, envío cada 20 s, marcador en mapa, polling 12 s |
| Mantener app activa (notificación) | ✅ Implementado | Notificación local al iniciar viaje; barra fija "Viaje en curso" (Fase 2) |

Si querés, el siguiente paso puede ser implementar la **Fase 1** (botones del conductor) y un esqueleto de la **Fase 2** (barra de viaje en curso) en el código.
