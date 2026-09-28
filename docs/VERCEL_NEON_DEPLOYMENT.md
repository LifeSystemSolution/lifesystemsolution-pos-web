# Despliegue en Vercel Pro + Neon (São Paulo)

Reemplaza a [VERCEL_SUPABASE_DEPLOYMENT.md](./VERCEL_SUPABASE_DEPLOYMENT.md).
La app solo necesita PostgreSQL estándar: no usa nada propio de Supabase
(las variables `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` ya no las lee
ningún archivo).

## Por qué São Paulo

Cada request a `/api/db` hace ~4 viajes a la base (BEGIN, empresa, consulta,
COMMIT). Con Vercel y la base en regiones distintas cada viaje cuesta
~100 ms; en la misma región, 1–2 ms. Desde Lima, São Paulo está a ~60–80 ms.

- Vercel: `vercel.json` fija las funciones en **`gru1`** (São Paulo).
- Neon: crear el proyecto en **AWS São Paulo (`aws-sa-east-1`)**. La región
  no se puede cambiar después.

## Variables de entorno (Vercel → Settings → Environment Variables)

| Variable | De dónde sale |
| --- | --- |
| `DATABASE_URL` | Neon → **Connect** → marcar **Connection pooling** (el host lleva `-pooler`). URL completa `postgresql://...?sslmode=require` |
| `AUTH_JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` |

Las variables de SUNAT/consultas (si se usan) se copian igual que antes.

## Paso a paso

1. Vercel: pasar el equipo a **Pro** (Hobby no permite uso comercial).
2. Neon: crear proyecto, región **AWS São Paulo**, Postgres 16 o superior.
   Plan de pago (Launch). En **Compute** desactivar *Scale to zero* para que
   la primera consulta del día no sea lenta; autoscaling 0.25 → 1 CU.
3. Neon → **SQL Editor**: ejecutar `db/schema.sql` completo (base vacía; las
   migraciones de `db/migrations/` ya están incluidas en el esquema).
4. Crear la cuenta dueña de la plataforma (la contraseña se muestra una
   sola vez en tu terminal):
   `node --env-file=.env.local scripts/create-platform-owner.mjs tu@correo.com`
   Las empresas, locales y usuarios se crean después desde `/plataforma`.
5. Cargar `DATABASE_URL` y `AUTH_JWT_SECRET` en Vercel (Production) y en
   `.env.local`, y desplegar.
6. Verificar `https://TU-DOMINIO/api/health/database` →
   `{ "ok": true, "database": "connected" }`.

## Qué se optimizó en el código (2026-09-27)

- **Filtros en SQL** (`lib/local/db-query.ts`): los `where` de igualdad y
  los rangos de fecha se resuelven en Postgres. Antes cada consulta traía la
  colección entera de la empresa (todas las tiendas, todo el historial).
- **Polling agrupado** (`lib/local/firebase-shim/firestore.ts`): todas las
  suscripciones de la pestaña van en UN request cada 3 s (antes, uno por
  suscripción), las duplicadas se leen una vez, y si nada cambió el servidor
  responde `unchanged` sin reenviar datos. Pestaña oculta: cada 30 s.
- **Pool de 5 conexiones** por instancia (antes 2: los requests hacían cola).
- Cocina solo lee pedidos sin pagar.
- **RLS efectivo** (`db/migrations/005_app_role_rls.sql`): el rol de conexión
  (`neondb_owner`) tiene BYPASSRLS y se saltaba la política aunque hubiera
  FORCE. Ahora cada transacción de empresa corre como `pos_app` (sin
  BYPASSRLS, solo permisos sobre `documents`). Verificado en Neon: un SELECT
  sin filtro solo ve la empresa propia y no se puede escribir en otra.

Estimación con 25 usuarios: de ~50 requests/s a ~8 requests/s, cada uno
leyendo solo las filas que necesita.
