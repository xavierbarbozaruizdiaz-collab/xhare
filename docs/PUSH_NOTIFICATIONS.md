# Notificaciones push (backend + app nativa)

## Dónde vive cada cosa

- **Cliente que registra el token:** la app **Expo** en `mobile-app/` (no la web Next). Tras el login, envía el token a `POST /api/push/register`.
- **Web:** no registra push FCM (solo notificaciones del navegador si el usuario las permite, aparte de este flujo).
- **Envío masivo:** aún no implementado; el servidor debe usar **FCM** (Firebase Cloud Messaging) con la cuenta de servicio.

## Cómo enviar desde el servidor

1. Proyecto en **Firebase Console** y cuenta de servicio (JSON) para el Admin SDK.
2. Leer tokens desde la tabla **`push_tokens`** (`user_id`, `token`, `platform`).
3. Enviar con Firebase Admin, por ejemplo:

```js
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
await admin.messaging().send({
  token: deviceToken,
  notification: { title: 'Recordatorio', body: 'Tu viaje es mañana a las 08:00' },
  data: { screen: '/rides/123' },
});
```

4. Momentos típicos: nueva reserva, recordatorio de viaje, cambio de estado a `en_route`.

## Tabla `push_tokens`

| Columna    | Descripción                          |
|------------|--------------------------------------|
| user_id    | Usuario (auth.users)                 |
| token      | Token FCM / APNS                     |
| platform   | `android`, `ios`, `web`              |

Constraint único `(user_id, token)`.

## Android 13+

Hace falta permiso de notificaciones en el dispositivo; en la app Expo se gestiona con **`expo-notifications`** (ver código en `mobile-app/`).
