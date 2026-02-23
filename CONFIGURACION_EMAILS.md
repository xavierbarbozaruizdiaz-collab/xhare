# Configuración de Emails en Supabase

## Problema Actual

Si estás recibiendo errores `429 (Too Many Requests)` o los emails de verificación no llegan, necesitas configurar el servicio de emails en Supabase.

## Soluciones

### Opción 1: Configurar SMTP Personalizado (Recomendado para Producción)

1. Ve a tu proyecto en [Supabase Dashboard](https://app.supabase.com)
2. Navega a **Authentication** → **Email Templates**
3. Ve a **Settings** → **SMTP Settings**
4. Configura tu proveedor SMTP:
   - **Gmail**: Usa App Password
   - **SendGrid**: Usa API Key
   - **Mailgun**: Usa API Key
   - **Amazon SES**: Usa credenciales AWS

### Opción 2: Deshabilitar Verificación de Email (Solo para Desarrollo)

Si estás en desarrollo y quieres probar sin verificación de email:

1. Ve a **Authentication** → **Providers** en Supabase Dashboard
2. Desplázate hasta **Email**
3. Desactiva **"Confirm email"** temporalmente
4. Guarda los cambios

**⚠️ IMPORTANTE**: Solo haz esto en desarrollo. En producción siempre debes tener verificación de email habilitada.

### Opción 3: Usar el Email de Prueba de Supabase

Supabase tiene un límite de emails gratuitos. Para desarrollo:

1. Ve a **Authentication** → **Users** en Supabase Dashboard
2. Puedes verificar manualmente usuarios desde ahí
3. O usa el email de prueba que Supabase proporciona

### Opción 4: Configurar Redirect URL

Asegúrate de que la URL de redirección esté configurada:

1. Ve a **Authentication** → **URL Configuration**
2. Agrega tu URL de desarrollo: `http://localhost:3000`
3. Agrega tu URL de producción cuando despliegues

## Verificar Configuración

Después de configurar SMTP o deshabilitar verificación:

1. Intenta crear una nueva cuenta
2. Revisa la consola del navegador para errores
3. Si configuraste SMTP, revisa los logs en tu proveedor de email

## Límites de Supabase

- **Plan Gratuito**: 3 emails por hora
- **Plan Pro**: 4,000 emails por mes
- **Plan Team**: 50,000 emails por mes

Si alcanzas el límite, verás el error `429 (Too Many Requests)`.

## Solución Temporal

Si necesitas continuar desarrollando mientras configuras SMTP:

1. Deshabilita temporalmente la verificación de email (Opción 2)
2. O verifica manualmente los usuarios desde el Dashboard de Supabase
3. O espera unos minutos para que se resetee el límite de tasa

## Mejoras Implementadas en el Código

El código ahora incluye:

- ✅ Manejo mejorado de errores 429
- ✅ Botón para reenviar email de verificación
- ✅ Mensajes informativos sobre el estado del email
- ✅ Detección de cuando el email no está confirmado
