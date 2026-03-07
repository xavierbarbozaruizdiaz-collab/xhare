# Análisis: finalización de viaje, ubicación y un viaje por conductor

## 1. Notificación “No se pudo enviar la ubicación”

### Causas
- **429 (rate limit):** el backend permite 1 request cada 15 s; el cliente envía cada 25 s. En redes lentas o reintentos se podía superar el límite y se trataba como “fallo”, mostrando el aviso.
- **Un solo fallo transitorio** (GPS lento, red inestable) dejaba el aviso fijo hasta el próximo envío exitoso.
- **WebView en Android:** `navigator.geolocation` a veces es menos fiable que la API nativa de Capacitor.

### Cambios realizados
- **429 no se considera fallo:** si la respuesta es 429, no se muestra el aviso y se resetea el contador de fallos.
- **Aviso solo tras 2 fallos consecutivos:** un fallo puntual no muestra el mensaje; se muestra solo cuando fallan dos envíos seguidos.
- **GPS nativo en app:** en plataforma nativa (Capacitor) se usa `Geolocation.getCurrentPosition` de `@capacitor/geolocation`, con timeout 12 s, para mayor estabilidad.
- **Timeout web:** en navegador se sube el timeout a 10 s para dar más margen al GPS.

---

## 2. Conductor no puede iniciar más de un viaje a la vez

### Regla de negocio
Un conductor solo puede tener **un viaje en estado “en curso” (en_route)** a la vez.

### Implementación
- **Edge Function `ride-update-status`:** al pasar a `en_route` se consulta si el conductor tiene otro viaje con `status = 'en_route'` y `id != ride_id`. Si existe, se responde `400` con `error: 'already_has_active_ride'` y mensaje claro.
- **Front (página del viaje):** si la API devuelve `already_has_active_ride`, se muestra el mensaje: “Ya tenés un viaje en curso. Finalizá ese viaje antes de iniciar otro.” y se refresca el viaje para que el conductor vea el estado actual.

La restricción queda aplicada en backend; el front solo comunica el error y guía al usuario.

---

## 3. “Tarda mucho para finalizar el viaje” – Análisis (PM / dev senior)

### Flujo actual de finalización
1. Conductor toca **“Finalizar viaje”**.
2. Se llama a la Edge Function `ride-update-status` con `status: 'completed'`.
3. Se espera la respuesta y luego se hace `loadRide()` para refrescar datos.
4. Hasta que todo termina, el botón muestra “...” y la pantalla sigue en “en curso”.

### Posibles causas de la sensación de lentitud

| Causa | Impacto | Mitigación |
|-------|--------|------------|
| **Latencia de red** | 1–3 s según conexión | Actualización optimista (ver abajo). |
| **Cold start Edge Function** | 2–10 s la primera vez | No controlable desde app; la optimización de Supabase (keep-warm, etc.) es a nivel infra. |
| **Esperar a `loadRide()`** | Suma 1–2 s más antes de cambiar la UI | Dejar de esperar: actualizar estado en cliente en cuanto la API responde OK y hacer `loadRide()` en background. |
| **Fallo de ubicación** | No bloquea la finalización; el botón “Finalizar viaje” no depende de que la ubicación se envíe. | Mejoras en envío de ubicación (punto 1) evitan avisos molestos y dan más confianza; no acortan el tiempo de finalización en sí. |

### Cambios realizados para que “finalizar” se sienta más rápido
- **Actualización optimista:** cuando la Edge Function responde OK con `status: 'completed'`, se actualiza de inmediato el estado local del viaje a `completed` (sin esperar a `loadRide()`). El conductor ve al instante la pantalla de viaje finalizado.
- **Refresh en background:** `loadRide()` se ejecuta en segundo plano (`void loadRide()`) para no bloquear la UI.
- **Texto del botón:** mientras la petición está en curso se muestra “Finalizando…” en lugar de “...”, para dejar claro que la acción está en proceso.

### Flujo “Llegué” y paradas (no cambia el tiempo de finalización)
- Para cada parada el conductor toca **“Llegué”** → se abre el modal de confirmación (subidos / no show / bajados) → **Confirmar** → se llama a `/api/rides/[id]/arrive`.
- Eso es independiente de **“Finalizar viaje”**. La demora percibida suele ser: (1) tiempo hasta tocar “Finalizar viaje” y (2) tiempo de la petición a la Edge Function + refresh. Lo que hemos mejorado es (2) con la actualización optimista y el texto “Finalizando…”.

### Resumen
- **Ubicación:** menos falsos positivos del aviso y mejor uso del GPS en app nativa.
- **Un viaje por conductor:** enforced en backend y mensaje claro en front.
- **Finalización:** la UI pasa a “completado” en cuanto el servidor confirma; el refresh sigue en background y el botón indica “Finalizando…” mientras tanto.
