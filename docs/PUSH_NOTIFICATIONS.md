# Notificaciones push

## Estado actual

- **App**: al iniciar sesión en Android/iOS, la app pide permiso de notificaciones, obtiene el token FCM/APNS y lo envía a `POST /api/push/register`. Los tokens se guardan en la tabla `push_tokens` (por usuario y dispositivo).
- **Envío**: aún no está implementado. Para enviar notificaciones hay que usar Firebase Cloud Messaging (FCM) desde un backend o función.

## Cómo enviar notificaciones

1. **Firebase**: tener un proyecto en Firebase Console, descargar `google-services.json` en `android/app/` (ya referenciado en el build de Android). Para **enviar** desde servidor necesitás la cuenta de servicio (JSON) de Firebase.
2. **Obtener tokens del usuario**: desde tu backend (Edge Function, API route con service role, o cron), consultar `push_tokens` filtrando por `user_id` para los usuarios a notificar.
3. **Llamar a FCM**: con la cuenta de servicio, usar la API HTTP v1 de FCM para enviar a cada token. Ejemplo desde Node (Firebase Admin SDK):

   ```js
   const admin = require('firebase-admin');
   admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
   await admin.messaging().send({
     token: deviceToken,
     notification: { title: 'Recordatorio', body: 'Tu viaje es mañana a las 08:00' },
     data: { screen: '/rides/123' }, // para abrir la app en una pantalla
   });
   ```

4. **Cuándo enviar**: ejemplos útiles:
   - **Nueva reserva**: cuando se inserta una fila en `bookings` para un viaje, notificar al `driver_id` del viaje.
   - **Recordatorio de viaje**: cron que busca viajes con `departure_time` en las próximas 24 h y notifica a conductor y pasajeros (consultando `bookings` y `push_tokens`).
   - **Cambio de estado**: al marcar viaje como "en camino", notificar a pasajeros con reserva.

## Tabla `push_tokens`

| Columna   | Tipo      | Descripción                          |
|-----------|-----------|--------------------------------------|
| id        | uuid      | PK                                   |
| user_id   | uuid      | Usuario (auth.users)                 |
| token     | text      | Token FCM o APNS                     |
| platform  | text      | 'android', 'ios', 'web'              |
| created_at| timestamptz | Última actualización del registro  |

Constraint único: `(user_id, token)` para no duplicar el mismo dispositivo.

## Permisos en Android

En Android 13+ hace falta el permiso `POST_NOTIFICATIONS`. El plugin `@capacitor/push-notifications` usa `requestPermissions()`; si el usuario rechaza, no se obtendrá token hasta que lo habilite en Ajustes.
