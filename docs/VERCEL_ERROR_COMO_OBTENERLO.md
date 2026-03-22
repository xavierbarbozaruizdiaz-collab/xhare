# Cómo obtener el error exacto de Vercel (para resolver el deploy)

Para poder corregir el fallo **sin tocar lo que ya funciona**, necesito el **mensaje de error real** del build.

## Pasos

1. Entrá a **[vercel.com](https://vercel.com)** y abrí el proyecto que falla (**transporte** o **xhare**).
2. En la lista de **Deployments**, hacé click en el deploy que está en rojo (Error).
3. En esa página, buscá la pestaña **"Building"** o **"Build Logs"** (o el paso donde falla).
4. Bajá hasta el final del log, donde aparece el error en rojo.
5. **Copiá todo el mensaje de error** (desde la línea que dice "Error:" o "Failed" hasta el final del bloque, unas 15–30 líneas).
6. Pegalo en el chat cuando me escribas de nuevo.

## Ejemplo de lo que necesito

Algo así (el tuyo puede ser distinto):

```
Error: supabaseUrl is required.
    at ...
    at ...
Error occurred prerendering page "/admin/drivers"
```

O:

```
Module not found: Can't resolve 'algún-paquete'
```

Con ese texto exacto se puede ver la causa y aplicar **solo** el cambio necesario, sin modificar el resto.
