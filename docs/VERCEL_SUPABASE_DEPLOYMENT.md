# Despliegue de Vercel + Supabase

Esta aplicación no usa las variables `NEXT_PUBLIC_SUPABASE_*` ni las de la
integración automática de Vercel. El navegador solo habla con las rutas API
de Next.js; estas rutas se conectan a PostgreSQL y usan Supabase Realtime en
el servidor. Configura **exactamente** las cuatro variables siguientes:

| Variable de Vercel | De dónde sale | Uso |
| --- | --- | --- |
| `DATABASE_URL` | Supabase: **Connect** → *Transaction pooler* | Consultas PostgreSQL desde las API routes. Debe ser una URL completa `postgresql://...`, con SSL. |
| `SUPABASE_URL` | Supabase: **Project Settings** → **API** → *Project URL* | URL del proyecto, sin `/rest/v1`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase: **Project Settings** → **API** → *Secret keys* → `service_role`/secret key | Solo relay servidor→Realtime. Nunca debe llevar prefijo `NEXT_PUBLIC_`. |
| `AUTH_JWT_SECRET` | Generar con `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` | Firma de las sesiones propias de la aplicación. No es el JWT secret de Supabase. |

## Paso a paso

1. En Supabase, abre el proyecto correcto y verifica que su región sea la más
   cercana a los usuarios. Si Vercel está en `sa-east-1`, usa Supabase en la
   misma región o la más cercana para evitar latencia de red.
2. En **SQL Editor**, ejecuta primero `db/schema.sql` si la base está vacía.
   Si ya ejecutaste una versión anterior del esquema, ejecuta además una vez
   `db/migrations/001_documents_company_primary_key.sql`.
3. En **Database → Replication** verifica que `documents` esté habilitada para
   Realtime. El esquema también intenta añadir la tabla a `supabase_realtime`.
4. En Vercel, abre el proyecto → **Settings → Environment Variables**. Crea
   las cuatro variables de la tabla para los entornos **Production**, **Preview**
   y **Development** que realmente vayas a usar. No copies `POSTGRES_*`,
   `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_JWT_SECRET` ni
   `SUPABASE_SECRET_KEY`: este código no los lee.
5. Pega `DATABASE_URL` desde el modo *Transaction pooler*, no una URL parcial
   ni los campos host/usuario por separado. Conserva el usuario, contraseña,
   host, puerto y los parámetros de la URL tal como los entrega Supabase.
6. Guarda las variables y haz un redeploy nuevo: Vercel solo las inyecta al
   construir y ejecutar despliegues posteriores.
7. Tras desplegar, visita `https://TU-DOMINIO/api/health/database`. La respuesta
   esperada es `{ "ok": true, "database": "connected" }`. Un `503` con
   `not_configured` significa que falta `DATABASE_URL`; `unavailable` indica
   URL/contraseña/red/región incorrectas. La ruta no expone secretos.
8. Prueba un inicio de sesión y una lectura/escritura real. Revisa los logs de
   Vercel durante esa prueba; deben desaparecer mensajes de `DATABASE_URL`,
   `AUTH_JWT_SECRET` o configuración de Supabase.

## Reglas de seguridad

* Nunca expongas `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` ni
  `AUTH_JWT_SECRET` como `NEXT_PUBLIC_*`, en commits, capturas o el navegador.
* Si una clave apareció en una captura, chat o repositorio, rótala en Supabase
  o Vercel y redeploya inmediatamente.
* Conserva `AUTH_JWT_SECRET`: cambiarlo cierra todas las sesiones activas.
* Antes de producción, restringe en Supabase los orígenes/redirecciones de
  Auth si activas Supabase Auth en el futuro; hoy la autenticación de este
  proyecto es propia y está en `auth_accounts`.

## Limitaciones que hay que cerrar antes de producción

* No hay migración automática ni pipeline de despliegue de SQL: los scripts
  deben aplicarse y registrarse de forma controlada.
* El endpoint de datos aún carga todos los documentos de una colección y
  filtra/ordena en Node.js. Con ventas e inventario grandes esto será lento;
  hay que trasladar las consultas frecuentes a SQL con índices por campos.
* Las actualizaciones en tiempo real abren una suscripción Supabase por cada
  conexión SSE y pasan el JWT de la sesión por query string. Se debe cambiar
  por un ticket SSE de corta duración y compartir suscripciones por empresa
  antes de crecer el número de terminales.
* Faltan rate limiting de login, pruebas automatizadas de integración,
  monitorización/alertas, backup/restore probado y una política formal de
  rotación de secretos.
