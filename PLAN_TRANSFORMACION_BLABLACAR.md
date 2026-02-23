# Plan de Transformación a Modelo BlaBlaCar

## 🎯 Cambios Principales Requeridos

### 1. Modelo de Negocio
**Antes**: Sistema de matching automático donde el sistema agrupa pasajeros
**Ahora**: Marketplace donde choferes publican viajes y pasajeros buscan/reservan

### 2. Flujo Principal
**Antes**: Pasajero solicita → Admin ejecuta matching → Sistema agrupa → Admin asigna chofer
**Ahora**: Chofer publica viaje → Pasajero busca → Pasajero reserva asiento → Chofer confirma

### 3. Cambios en Base de Datos

#### Tabla `rides` - Cambios Necesarios:
- ✅ `origin_lat/lng/label` - Punto de origen del viaje
- ✅ `destination_lat/lng/label` - Punto de destino del viaje
- ✅ `price_per_seat` - Precio por asiento
- ✅ `available_seats` - Asientos disponibles (en lugar de capacity)
- ✅ `departure_time` - Ya existe, pero ahora es obligatorio
- ✅ `description` - Descripción del viaje
- ✅ `vehicle_info` - Info del vehículo (opcional)
- ✅ `flexible_departure` - Si acepta cambios de hora
- ✅ `flexible_return` - Si ofrece viaje de vuelta

#### Nueva Tabla `bookings` (reemplaza `ride_passengers`):
- `id` - ID de la reserva
- `ride_id` - Viaje reservado
- `passenger_id` - Pasajero que reserva
- `seats_count` - Cantidad de asientos reservados
- `pickup_stop_id` - Parada donde aborda (opcional, si hay paradas intermedias)
- `dropoff_stop_id` - Parada donde baja
- `status` - pending, confirmed, cancelled, completed
- `price_paid` - Precio pagado
- `created_at` - Fecha de reserva

#### Nueva Tabla `reviews`:
- `id` - ID de la reseña
- `ride_id` - Viaje calificado
- `reviewer_id` - Usuario que hace la reseña
- `reviewed_id` - Usuario calificado (chofer o pasajero)
- `rating` - Calificación (1-5)
- `comment` - Comentario
- `created_at` - Fecha

#### Nueva Tabla `messages`:
- `id` - ID del mensaje
- `ride_id` - Viaje relacionado
- `sender_id` - Usuario que envía
- `receiver_id` - Usuario que recibe
- `content` - Contenido del mensaje
- `read` - Si fue leído
- `created_at` - Fecha

### 4. Nuevas Funcionalidades

#### Para Choferes:
- Publicar viaje (origen, destino, fecha/hora, precio, asientos)
- Gestionar viajes publicados
- Aceptar/rechazar reservas
- Ver historial de viajes
- Ver reseñas recibidas

#### Para Pasajeros:
- Buscar viajes (origen, destino, fecha)
- Filtrar por precio, hora, asientos disponibles
- Ver detalles del viaje y perfil del chofer
- Reservar asientos
- Ver mis reservas
- Chatear con chofer
- Dejar reseña después del viaje

### 5. UI/UX Tipo BlaBlaCar

#### Homepage:
- Barra de búsqueda prominente (origen, destino, fecha)
- Lista de viajes disponibles con cards
- Filtros laterales (precio, hora, asientos)
- Diseño limpio y moderno

#### Card de Viaje:
- Foto del chofer (o avatar)
- Nombre del chofer
- Calificación (estrellas)
- Origen → Destino
- Fecha y hora
- Precio por asiento
- Asientos disponibles
- Botón "Ver detalles"

#### Página de Detalles:
- Mapa con ruta
- Información del chofer (foto, nombre, calificación, reseñas)
- Detalles del viaje
- Paradas intermedias (si las hay)
- Formulario de reserva
- Chat con chofer

## 🚀 Implementación por Fases

### Fase 1: Base de Datos y Modelo
1. Crear migración para actualizar `rides`
2. Crear tabla `bookings`
3. Crear tabla `reviews`
4. Crear tabla `messages`
5. Actualizar tipos TypeScript

### Fase 2: Funcionalidad Core
1. Choferes pueden publicar viajes
2. Pasajeros pueden buscar viajes
3. Pasajeros pueden reservar asientos
4. Choferes pueden aceptar/rechazar reservas

### Fase 3: UI/UX
1. Rediseñar homepage tipo BlaBlaCar
2. Cards de viajes modernas
3. Página de detalles mejorada
4. Búsqueda y filtros

### Fase 4: Funcionalidades Adicionales
1. Sistema de reseñas
2. Chat entre usuarios
3. Notificaciones
4. Pagos (opcional)
