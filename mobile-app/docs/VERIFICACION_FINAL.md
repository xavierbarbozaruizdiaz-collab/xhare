# Verificación final antes de otra app

Checklist ejecutado antes de pasar a otro proyecto.

---

## ✅ TypeScript

- `npm run check` (tsc --noEmit) **pasa**.
- Corregido: tipo duplicado `Point` en `routeApi.ts`.
- Corregido: tipos de navegación para deep links (`MainScreenParams` en `types.ts`).

---

## ✅ Estructura y configuración

- **Entrada:** `index.ts` → `App` → `AuthProvider` + `RootNavigator` + `PushRegistrationEffect`.
- **Env:** `src/core/env.ts` usa `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_BASE_URL` (desde `extra` o `process.env`).
- **app.config.js:** `scheme: 'xhare'`, `extra` con las tres variables, dotenv desde `.env`.

---

## ✅ Navegación

- **Root:** Auth (Login) | Main (stack con tabs + pantallas).
- **Pantallas registradas:** MainTabs, RideDetail, BookRide, PublishRide, EditRide, MyTripRequests, DriverTripRequests, VehicleSetup, Messages, Chat, Offer, OfferBusco, OfferTengo, OfferBuscoNew, OfferTengoNew.
- **Deep links:** `xhare://ride/{id}`, `xhare://chat/{id}` manejados en RootNavigator; push tap abre enlace si payload tiene `rideId`, `conversationId` o `url`.

---

## ✅ Flujos principales

| Flujo | Pantalla(s) | Nota |
|-------|-------------|------|
| Login / recuperar contraseña | LoginScreen | "¿Olvidaste tu contraseña?" + reset por email |
| Buscar viajes / reservar | PassengerScreen, BookRideScreen | Paradas + precio por tramo cuando hay ride_stops |
| Publicar / editar viaje | PublishRideScreen, EditRideScreen | Waypoints, flexibilidad, trip_request_id, from_ride_id |
| Conductor: viajes y solicitudes | DriverScreen, DriverTripRequestsScreen | Tabs Próximos/Finalizados, "Solicitudes", "Volver a agendar" |
| Configurar vehículo | VehicleSetupScreen | Ajustes → Configurar vehículo |
| Mensajes y chat | MessagesScreen, ChatScreen | Realtime |
| Ofertas Busco/Tengo | OfferScreen, OfferBusco, OfferTengo, New | Ajustes → Viajes a oferta |

---

## ⚠️ Sin tests automáticos

- No hay `*.test.ts` ni `*.spec.ts` en el proyecto.
- Validación manual recomendada: login, reserva con paradas, publicar, push/deep link.

---

## Resumen

- **Build TypeScript:** OK.
- **Configuración y navegación:** OK.
- **Documentación:** VERIFICACION_MOBILE.md y FALTANTES_VS_WEB.md actualizados.

Listo para seguir con otra app; para builds nativos (EAS/APK) revisar `.env` o secretos en EAS con las mismas variables.
