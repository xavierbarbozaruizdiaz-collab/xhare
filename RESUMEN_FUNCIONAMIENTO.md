# Resumen del Funcionamiento del Sistema Xhare

## 📋 Descripción General

**Xhare** es un sistema MVP de transporte de pasajeros con minibuses de 15 pasajeros. Permite que los pasajeros soliciten viajes y el sistema los agrupa automáticamente en viajes compartidos según rutas fijas predefinidas.

## 🏗️ Arquitectura del Sistema

### Stack Tecnológico
- **Frontend**: Next.js 14 (App Router) + TypeScript + TailwindCSS
- **Backend**: Next.js API Routes
- **Base de Datos**: Supabase (PostgreSQL + Auth + RLS)
- **Mapas**: Leaflet (OpenStreetMap)
- **Validación**: Zod

### Estructura de Base de Datos

#### Tablas Principales:
1. **profiles** - Perfiles de usuarios (pasajeros, choferes, admins)
2. **routes** - Rutas fijas predefinidas con polilíneas
3. **ride_requests** - Solicitudes de viaje de los pasajeros
4. **rides** - Viajes agrupados creados por el sistema
5. **ride_stops** - Paradas de cada viaje
6. **ride_passengers** - Relación pasajeros-viajes
7. **settings** - Configuración del sistema
8. **audit_events** - Logs de eventos del sistema

## 🔄 Flujo Completo del Sistema

### 1. Registro y Autenticación

#### Creación de Cuenta:
1. Usuario va a `/login` y selecciona "Regístrate"
2. Completa formulario: nombre, teléfono, email, contraseña, rol (Pasajero/Chofer)
3. Al crear cuenta:
   - Se crea usuario en `auth.users` (Supabase Auth)
   - **Trigger automático** (`handle_new_user`) crea perfil en `profiles` con el rol seleccionado
   - Si verificación de email está desactivada → sesión inmediata
   - Si está activada → requiere verificar email

#### Inicio de Sesión:
1. Usuario ingresa email y contraseña
2. Supabase valida credenciales
3. Sistema carga perfil del usuario
4. **Redirección automática según rol**:
   - `admin` → `/admin`
   - `driver` → `/driver`
   - `passenger` → `/app`

### 2. Flujo del Pasajero

#### Crear Solicitud de Viaje (`/app`):
1. **Selección de puntos**:
   - Usuario selecciona punto de recogida en el mapa (o escribe dirección)
   - Usuario selecciona destino en el mapa (o escribe dirección)
   
2. **Configuración del viaje**:
   - Cantidad de pasajeros (1-4)
   - Ventana horaria:
     - "Ahora" (próximos 30 min)
     - "En 15 minutos"
     - "En 30 minutos"
     - "Programado" (fecha/hora específica)

3. **Envío de solicitud**:
   - POST a `/api/requests`
   - Se valida que el usuario sea `passenger`
   - Se crea registro en `ride_requests` con estado `submitted`
   - Se registra evento en `audit_events`

#### Ver Solicitudes (`/app/requests`):
1. GET a `/api/requests` (solo solicitudes del usuario)
2. Muestra lista de solicitudes con:
   - Puntos de recogida y destino
   - Estado (submitted, proposed, confirmed, assigned, etc.)
   - Modo (route_fixed, free, unknown)
   - Punto de encuentro propuesto (si existe)

#### Confirmar Propuesta:
1. Si el matching encuentra un viaje → estado cambia a `proposed`
2. Pasajero ve botón "Confirmar" en `/app/requests`
3. POST a `/api/requests/:id/confirm`
4. Estado cambia a `confirmed`
5. Listo para asignar chofer

### 3. Motor de Matching (Algoritmo Ruta Fija)

#### Ejecución del Matching (`/admin` → "Ejecutar Matching"):
1. Admin presiona botón "Ejecutar Matching"
2. POST a `/api/matching/run`
3. Sistema busca todas las solicitudes con estado `submitted` o `confirmed`
4. Para cada solicitud, ejecuta `matchRequest()`:

#### Algoritmo de Matching Ruta Fija (`matchRouteFixed`):

**Paso 1: Validación de Ubicación**
- Verifica que existe al menos una ruta activa
- Calcula distancia del pickup al corredor de la ruta
- Calcula distancia del dropoff al corredor de la ruta
- Si ambos están dentro de `route_corridor_m` (default: 800m) → continúa
- Si no → rechaza la solicitud

**Paso 2: Cálculo de Punto de Encuentro**
- Encuentra el punto más cercano en la polyline de la ruta al pickup del pasajero
- Este punto será el "meeting point" donde el pasajero abordará

**Paso 3: Agrupación por Ventana Horaria**
- Redondea la hora de inicio a intervalos de `time_window_minutes` (default: 20 min)
- Ejemplo: 10:07 → 10:00, 10:23 → 10:20
- Agrupa solicitudes que tienen el mismo "bucket" de tiempo

**Paso 4: Búsqueda de Viaje Existente**
- Busca viajes (`rides`) que:
  - Estén en la misma ruta
  - Tengan el mismo "bucket" de tiempo de salida
  - Estén en estado `building` o `ready`
  - Tengan capacidad disponible (suma de pasajeros < `capacity`)

**Paso 5: Creación o Asignación**
- Si encuentra viaje con capacidad → agrega pasajero a ese viaje
- Si no encuentra → crea nuevo viaje (`status: building`)
- Crea registro en `ride_passengers` (relación pasajero-viaje)
- Actualiza `ride_requests` con:
  - `mode: route_fixed`
  - `status: assigned`
  - `proposed_meeting_lat/lng`: punto de encuentro
  - `proposed_meeting_label`: etiqueta del punto

**Paso 6: Creación de Paradas**
- Si es nuevo viaje → crea parada inicial en el punto de encuentro
- Las paradas se ordenan según `stop_order`

### 4. Flujo del Administrador

#### Dashboard (`/admin`):
1. Muestra estadísticas:
   - Total de solicitudes
   - Total de viajes
   - Total de pasajeros

2. Lista de viajes activos:
   - Viajes en estado `building`, `ready`, `assigned`, `en_route`
   - Muestra chofer asignado (si tiene)
   - Botón para asignar chofer si no tiene

3. Lista de solicitudes recientes:
   - Últimas 20 solicitudes creadas
   - Estado y modo de cada una

#### Ejecutar Matching:
- Botón "Ejecutar Matching" procesa todas las solicitudes pendientes
- Resultado muestra cuántas se procesaron y resultados

#### Asignar Chofer:
1. Admin selecciona un viaje sin chofer
2. Selecciona chofer de la lista (solo choferes disponibles)
3. POST a `/api/admin/rides/:id/assign-driver`
4. Actualiza `rides.driver_id` y cambia estado a `assigned`

### 5. Flujo del Chofer

#### Panel del Chofer (`/driver`):
1. **Disponibilidad**:
   - Checkbox "Disponible" guarda estado en `profiles.available`
   - Solo choferes disponibles pueden recibir asignaciones
   - Estado se carga automáticamente al iniciar sesión

2. **Ver Viajes Asignados**:
   - GET a `/api/rides/mine` (solo viajes del chofer)
   - Muestra viajes con estado `assigned` o `en_route`
   - Lista de viajes con:
     - ID del viaje
     - Estado
     - Hora de salida
     - Cantidad de pasajeros

3. **Detalles del Viaje**:
   - Al seleccionar un viaje, muestra:
     - **Paradas**: Lista ordenada de paradas con coordenadas/etiquetas
     - **Pasajeros**: Lista de pasajeros con:
       - Punto de recogida → Destino
       - Cantidad de pasajeros
       - Estado (pending, checked_in, no_show)

4. **Gestión de Estados**:
   - **"Iniciar Viaje"**: Cambia estado de `assigned` → `en_route`
   - **"Completar Viaje"**: Cambia estado de `en_route` → `completed`
   - POST a `/api/rides/:id/update-status`

5. **Check-in de Pasajeros**:
   - Para cada pasajero con estado `pending`:
     - Botón "Abordó" → POST a `/api/rides/:id/checkin` con `status: checked_in`
     - Botón "No Show" → POST a `/api/rides/:id/checkin` con `status: no_show`
   - Actualiza estado en `ride_passengers`

## 🔐 Seguridad y Permisos (RLS)

### Row Level Security (RLS):
- **Profiles**: Usuarios solo ven su propio perfil (admins ven todos)
- **Ride Requests**: Pasajeros solo ven sus propias solicitudes
- **Rides**: Choferes solo ven sus viajes asignados
- **Settings**: Solo admins pueden ver/modificar
- **Routes**: Todos pueden ver rutas activas, solo admins pueden modificar

### Roles:
- **passenger**: Puede crear solicitudes, ver sus solicitudes, confirmar propuestas
- **driver**: Puede ver sus viajes asignados, cambiar estados, hacer check-in
- **admin**: Acceso completo, puede ejecutar matching, asignar choferes, ver todo

## ⚙️ Configuración del Sistema

### Parámetros en `settings`:
- `capacity`: 15 (capacidad del minibús)
- `time_window_minutes`: 20 (intervalo de agrupación temporal)
- `route_corridor_m`: 800 (metros de corredor permitido)
- `max_walk_meters`: 600 (máxima distancia a pie)
- `max_detour_minutes`: 10 (máximo desvío permitido)
- `pickup_cluster_radius_m`: 500 (radio de agrupación de pickups)
- `mode_enabled_route_fixed`: true (habilitar modo ruta fija)
- `mode_enabled_free`: false (modo libre aún no implementado)

## 📊 Estados del Sistema

### Estados de Solicitudes (`ride_requests.status`):
- `draft` - Borrador (no usado actualmente)
- `submitted` - Enviada, esperando matching
- `proposed` - Matching encontró viaje, esperando confirmación
- `confirmed` - Pasajero confirmó, lista para asignar chofer
- `assigned` - Asignada a un viaje con chofer
- `en_route` - Viaje en curso
- `boarded` - Pasajero abordó
- `completed` - Viaje completado
- `cancelled` - Cancelada
- `expired` - Expirada

### Estados de Viajes (`rides.status`):
- `building` - En construcción (agregando pasajeros)
- `ready` - Listo para asignar chofer
- `assigned` - Chofer asignado
- `en_route` - En ruta
- `completed` - Completado
- `cancelled` - Cancelado

### Estados de Pasajeros en Viaje (`ride_passengers.status`):
- `pending` - Esperando abordar
- `checked_in` - Abordó
- `no_show` - No se presentó
- `cancelled` - Cancelado

## 🔄 Flujo Completo Ejemplo

### Escenario: Pasajero solicita viaje y es asignado

1. **Pasajero crea solicitud**:
   - Selecciona pickup: "Plaza de Mayo"
   - Selecciona destino: "Obelisco"
   - 2 pasajeros, ventana "Ahora"
   - Estado: `submitted`

2. **Admin ejecuta matching**:
   - Sistema verifica que pickup y destino están en corredor de ruta
   - Calcula punto de encuentro en la ruta
   - Busca viaje existente con capacidad
   - No encuentra → crea nuevo viaje
   - Agrega pasajero al viaje
   - Estado solicitud: `assigned`
   - Estado viaje: `building`

3. **Otro pasajero solicita viaje similar**:
   - Mismo proceso, pero encuentra el viaje creado anteriormente
   - Agrega pasajero al mismo viaje
   - Viaje ahora tiene 2 pasajeros

4. **Admin asigna chofer**:
   - Selecciona chofer disponible
   - Estado viaje: `assigned`
   - Chofer puede ver el viaje en su panel

5. **Chofer inicia viaje**:
   - Presiona "Iniciar Viaje"
   - Estado viaje: `en_route`

6. **Chofer hace check-in**:
   - Pasajero 1 aborda → "Abordó" → `checked_in`
   - Pasajero 2 no aparece → "No Show" → `no_show`

7. **Chofer completa viaje**:
   - Presiona "Completar Viaje"
   - Estado viaje: `completed`

## 🎯 Características Implementadas

### ✅ Completado:
- Sistema de autenticación con roles
- Creación automática de perfiles
- Sistema de solicitudes de viaje
- Motor de matching por Ruta Fija
- Panel de administración
- Panel del chofer con disponibilidad
- Sistema de check-in de pasajeros
- Gestión de estados de viajes
- Badges visuales de roles
- Redirección automática por rol
- Manejo de errores mejorado

### 🚧 Pendiente (Fase 2):
- Modo Libre (`matchFree()`)
- Optimización de rutas (TSP)
- Notificaciones push
- Pagos integrados
- App móvil

## 📝 Notas Importantes

- El matching se ejecuta **manualmente** desde el panel de admin
- Los choferes deben estar marcados como "Disponible" para recibir asignaciones
- Los viajes se agrupan automáticamente por ventana horaria y ruta
- El sistema valida que los puntos estén dentro del corredor de la ruta
- Todos los eventos se registran en `audit_events` para auditoría
