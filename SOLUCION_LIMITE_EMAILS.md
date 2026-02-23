# Solución: Límite de Emails en Supabase

## 🔴 Problema

No puedes crear usuarios con diferentes correos porque Supabase tiene un **límite de tasa por proyecto**, no por email individual:
- **Plan Gratuito**: 3 emails por hora (total del proyecto)
- Aunque uses diferentes correos, el límite es compartido

## ✅ Solución Rápida para Desarrollo

### Deshabilitar Verificación de Email (Recomendado)

Esto permite crear usuarios ilimitados sin necesidad de verificar email:

1. **Abre Supabase Dashboard**
   - Ve a: https://app.supabase.com
   - Inicia sesión con tu cuenta

2. **Selecciona tu Proyecto**
   - El proyecto que estás usando para esta aplicación

3. **Navega a Authentication**
   - En el menú lateral izquierdo, busca **"Authentication"**
   - Haz clic en **"Providers"**

4. **Configura Email Provider**
   - Busca la sección **"Email"**
   - Desplázate hasta encontrar **"Confirm email"**
   - **Desactiva** el toggle de "Confirm email"
   - Haz clic en **"Save"** o **"Update"**

5. **¡Listo!**
   - Ahora puedes crear usuarios sin límite
   - Los usuarios se crearán automáticamente sin necesidad de verificar email
   - Puedes usar cualquier correo (incluso correos falsos para pruebas)

## ⚠️ Importante

- **Solo para desarrollo**: Esta configuración es solo para desarrollo/testing
- **En producción**: Siempre debes tener verificación de email habilitada
- **Seguridad**: Sin verificación, cualquiera puede crear cuentas con emails falsos

## 🔄 Alternativas

### Opción 1: Esperar
- Espera 10-15 minutos para que se resetee el límite
- Solo podrás crear 3 usuarios más por hora

### Opción 2: Verificar Manualmente
1. Ve a **Authentication** → **Users** en Supabase Dashboard
2. Encuentra el usuario que quieres verificar
3. Haz clic en los tres puntos (⋯)
4. Selecciona **"Send verification email"** o marca como verificado manualmente

### Opción 3: Configurar SMTP Personalizado
Para producción, configura tu propio servicio SMTP:
- Ve a **Authentication** → **Email Templates** → **SMTP Settings**
- Configura Gmail, SendGrid, Mailgun, etc.

## 📝 Notas

- El límite se resetea cada hora
- El contador es por proyecto completo
- Usar diferentes correos no ayuda porque el límite es global

## 🎯 Después de Deshabilitar Verificación

Una vez deshabilitada la verificación:
- Los usuarios se crearán inmediatamente
- Podrás iniciar sesión sin verificar email
- No habrá límite de creación de usuarios
- Perfecto para desarrollo y pruebas
