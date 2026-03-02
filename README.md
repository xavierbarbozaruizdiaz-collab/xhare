# Xhare - Transporte de Pasajeros

Sistema MVP de transporte de pasajeros con minibuses de 15 pasajeros. Implementa matching por **Ruta Fija** (Fase 1) con arquitectura lista para **Modo Libre** (Fase 2).

## Stack Tecnológico

- **Next.js 14** (App Router) + TypeScript
- **TailwindCSS** para estilos
- **Supabase** (Auth + Postgres + RLS)
- **Leaflet** para mapas
- **Zod** para validación

## Requisitos Previos

- Node.js 18+ y npm
- Cuenta de Supabase (gratuita)
- Git

## Instalación

### 1. Clonar y configurar el proyecto

```bash
# El proyecto ya está creado en move-transporte/
cd move-transporte

# Instalar dependencias
npm install
```

### 2. Configurar variables de entorno

Crea un archivo `.env.local` en la raíz del proyecto:

```env
NEXT_PUBLIC_SUPABASE_URL=tu_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
NEXT_PUBLIC_MAP_PROVIDER=leaflet
```

Obtén estos valores desde tu proyecto en [Supabase Dashboard](https://app.supabase.com):
- Ve a Settings → API
- Copia `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
- Copia `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Copia `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ mantener secreto)

### 3. Aplicar migraciones de base de datos

En Supabase Dashboard:

1. Ve a **SQL Editor**
2. Abre el archivo `supabase/migrations/001_initial_schema.sql`
3. Copia todo el contenido
4. Pégalo en el SQL Editor
5. Ejecuta la query (Run)

Esto creará:
- Todas las tablas (profiles, routes, ride_requests, rides, etc.)
- Políticas RLS (Row Level Security)
- Funciones helper (is_admin, is_driver)
- Settings por defecto

### 4. Crear usuario administrador

Después de crear tu primer usuario (desde la UI de login), ejecuta este SQL en Supabase SQL Editor para convertirlo en admin:

```sql
-- Reemplaza 'tu_email@ejemplo.com' con el email de tu usuario
UPDATE profiles
SET role = 'admin'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'tu_email@ejemplo.com'
);
```

O si conoces el UUID del usuario:

```sql
UPDATE profiles
SET role = 'admin'
WHERE id = 'uuid-del-usuario';
```

Después de asignar el rol, ese usuario solo tiene que **iniciar sesión con su email y contraseña** en la misma pantalla de login; la app lo redirige automáticamente a `/admin`.

### 5. Aplicar migración de aprobación de conductores (opcional)

Si querés que los conductores requieran aprobación del admin antes de publicar viajes, ejecutá también en el SQL Editor el contenido de `supabase/migrations/013_driver_pending_and_admin_profiles.sql`. Los pasajeros siguen habilitados sin aprobación.

### 6. Crear una ruta activa (para testing)

Para que el matching funcione, necesitas al menos una ruta activa. Ejecuta este SQL:

```sql
INSERT INTO routes (name, direction, polyline, active)
VALUES (
  'Ruta Principal',
  'Norte-Sur',
  '[
    {"lat": -34.6037, "lng": -58.3816},
    {"lat": -34.6040, "lng": -58.3820},
    {"lat": -34.6045, "lng": -58.3825},
    {"lat": -34.6050, "lng": -58.3830}
  ]'::jsonb,
  true
);
```

Ajusta las coordenadas según tu ubicación (ejemplo usa Buenos Aires).

## Ejecutar el proyecto

Se suele usar **varias terminales** a la vez:

### Terminal 1 — Servidor Next.js (obligatorio)

```bash
cd move-transporte   # o la ruta de tu proyecto
npm run dev
```

El servidor queda en **http://localhost:3000**. Dejalo abierto mientras trabajás.

### Terminal 2 — Emulador Android con live reload (opcional)

Solo si querés probar la app en el emulador. **Primero** tené el servidor corriendo en la Terminal 1.

```bash
cd move-transporte
npx cap run android --live-reload
```

- En **emulador**: la app carga desde `http://10.0.2.2:3000` (configurado en `capacitor.config.ts`).
- En **dispositivo físico**: cambiá en `capacitor.config.ts` la URL del `server` por la IP de tu PC, por ejemplo `http://192.168.x.x:3000`.

### Resumen

| Terminal | Comando | Cuándo |
|----------|---------|--------|
| 1 | `npm run dev` | Siempre; deja corriendo |
| 2 | `npx cap run android --live-reload` | Cuando quieras probar en Android |

Para solo abrir la web: con la Terminal 1 alcanza; entrá a http://localhost:3000 en el navegador.

### Reinicio rápido (Windows PowerShell)

Si el servidor y el emulador se cerraron y querés volver a dejar todo andando:

1. **Terminal 1 — Servidor**
   ```powershell
   cd c:\Users\PCera\transporte
   npm run dev
   ```
   Esperar a ver `Local: http://localhost:3000` y `Ready`.

2. **Terminal 2 — Emulador (si no está corriendo)**
   ```powershell
   & "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd Medium_Phone_API_36.0
   ```
   Esperar a que aparezca en `adb devices` como `emulator-5554	device`.

3. **Terminal 3 — Sync + run con live reload**
   ```powershell
   cd c:\Users\PCera\transporte
   npx cap sync android
   npx cap run android --live-reload --target emulator-5554
   ```
   `--target emulator-5554` evita el prompt de selección de dispositivo. Si tenés otro dispositivo, usá su id (ej. `adb devices`).

- **Si `adb` no está en el PATH:** usar la ruta completa:
  `& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices`
- **Si el puerto 3000 está ocupado:** `netstat -ano | findstr :3000` y luego `taskkill /PID <PID> /F`.
- **Gradle con Java 21:** en `android/gradle.properties` debe estar `org.gradle.java.home=C:\\Program Files\\Android\\Android Studio\\jbr`. Si hubo problemas, `cd android` y `.\gradlew.bat --stop` antes de `cap run`.

## Estructura del Proyecto

```
move-transporte/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/               # API Routes
│   │   │   ├── requests/      # CRUD de solicitudes
│   │   │   ├── rides/         # Gestión de viajes (chofer)
│   │   │   ├── matching/      # Motor de matching
│   │   │   └── admin/         # Endpoints admin
│   │   ├── app/                # UI Pasajero
│   │   ├── driver/            # UI Chofer
│   │   ├── admin/             # UI Admin
│   │   └── login/             # Autenticación
│   ├── components/            # Componentes React
│   ├── lib/
│   │   ├── supabase/          # Clientes Supabase
│   │   ├── geo.ts             # Utilidades geográficas
│   │   └── matching/          # Motor de matching
│   │       ├── engine.ts      # Orquestador
│   │       ├── routeFixed.ts  # Matching Ruta Fija
│   │       └── free.ts        # Stub Modo Libre
│   └── types/                 # TypeScript types
├── supabase/
│   └── migrations/            # Migraciones SQL
└── README.md
```

## Flujo de Uso

### Pasajero

1. Registrarse/Iniciar sesión en `/login`
2. Ir a `/app` para crear solicitud:
   - Seleccionar punto de recogida y destino en el mapa
   - Indicar cantidad de pasajeros (1-4)
   - Elegir ventana horaria
3. Ver solicitudes en `/app/requests`
4. Confirmar propuesta si el sistema sugiere un viaje

### Chofer

1. Iniciar sesión (rol `driver`)
2. Ir a `/driver`
3. Marcar disponibilidad
4. Ver viajes asignados
5. Marcar pasajeros como "abordó" o "no-show"

### Admin

1. Iniciar sesión con la cuenta que tiene rol `admin` (misma pantalla de login); la app redirige a `/admin`.
2. En el panel: **Solicitudes de conductores** (aprobar o rechazar), **Pasajeros**, **Viajes**, **Usuarios**.
3. Los conductores nuevos quedan en "driver_pending" hasta que un admin los apruebe; los pasajeros se habilitan sin aprobación.
4. Ejecutar matching y asignar choferes según la app.

## API Endpoints

### Requests

- `POST /api/requests` - Crear solicitud
- `GET /api/requests` - Listar mis solicitudes
- `POST /api/requests/:id/confirm` - Confirmar propuesta

### Rides (Chofer)

- `GET /api/rides/mine` - Mis viajes asignados
- `POST /api/rides/:id/checkin` - Marcar pasajero (abordó/no-show)

### Matching

- `POST /api/matching/run` - Ejecutar matching (admin)

### Admin

- `GET /api/admin/dashboard` - Dashboard con stats
- `POST /api/admin/rides/:id/assign-driver` - Asignar chofer

## Algoritmo de Matching (Ruta Fija)

1. Verifica si pickup y dropoff están dentro del corredor de la ruta (`route_corridor_m`)
2. Calcula punto de encuentro (más cercano en la polyline al pickup)
3. Agrupa solicitudes por "bucket" de salida (redondeado a intervalos de `time_window_minutes`)
4. Busca ride existente con capacidad disponible o crea uno nuevo
5. Asigna pasajero al ride y actualiza estado

## Parámetros Configurables

Edita la tabla `settings` en Supabase:

- `capacity`: 15 (capacidad del minibús)
- `time_window_minutes`: 20 (intervalo de agrupación)
- `route_corridor_m`: 800 (metros de corredor)
- `max_walk_meters`: 600
- `max_detour_minutes`: 10
- `pickup_cluster_radius_m`: 500
- `mode_enabled_route_fixed`: true
- `mode_enabled_free`: false

## Ejemplo de Request JSON para Testing

```json
{
  "pickup_lat": -34.6037,
  "pickup_lng": -58.3816,
  "pickup_label": "Plaza de Mayo",
  "dropoff_lat": -34.6045,
  "dropoff_lng": -58.3825,
  "dropoff_label": "Obelisco",
  "pax_count": 2,
  "window_start": "2024-01-15T10:00:00Z",
  "window_end": "2024-01-15T10:30:00Z"
}
```

## Comandos Útiles

```bash
# Desarrollo
npm run dev

# Build para producción
npm run build

# Iniciar producción
npm start

# Linter
npm run lint
```

## Deploy en Vercel

1. Conecta tu repo a Vercel
2. Agrega las variables de entorno en Vercel Dashboard
3. Deploy automático en cada push

## Notas Importantes

- ⚠️ **NUNCA** commitees `.env.local` con keys reales
- El `SUPABASE_SERVICE_ROLE_KEY` solo se usa en el servidor (bypass RLS)
- Los mapas usan OpenStreetMap (gratis, no requiere API key)
- El matching se ejecuta manualmente desde admin (puedes automatizarlo con cron)

## Próximos Pasos (Fase 2)

- Implementar `matchFree()` para modo libre
- Optimización de rutas (TSP)
- Notificaciones push
- Pagos integrados
- App móvil

## Troubleshooting

**Error: "Unauthorized"**
- Verifica que las variables de entorno estén correctas
- Asegúrate de estar autenticado

**Error: "Request outside route corridor"**
- Verifica que la ruta tenga polyline válida
- Ajusta `route_corridor_m` en settings si es necesario

**No aparecen viajes para el chofer**
- Verifica que el admin haya asignado un chofer al ride
- El ride debe estar en status `assigned` o `en_route`

## Licencia

Proyecto privado - Todos los derechos reservados

