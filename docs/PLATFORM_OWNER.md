# Panel de Plataforma (SaaS) — `/plataforma`

> Agregado 2026-09-18. Separado por completo del `/admin` de cada empresa —
> es el panel del dueño del SaaS (LifeSystemSolution como negocio), no de
> ningún cliente/empresa individual.

## 1. Qué resuelve

El sistema es multi-tenant: varias empresas ("companies"), cada una con 1 o
varias tiendas ("sedes"), completamente aisladas entre sí por RLS (ver
[SQL_MIGRATION_PLAN.md](./SQL_MIGRATION_PLAN.md)). El dueño de la plataforma
necesita una vista que cruce esa frontera — cuántas empresas hay, cuántas
tiendas y usuarios tiene cada una, y a futuro qué plan/costo le corresponde —
sin que eso debilite el aislamiento que protege a cada cliente de los demás.

## 2. Quién puede entrar

- `auth_accounts.is_platform_owner` (columna `BOOLEAN`, migración
  `db/migrations/002_platform_owner.sql`). **Nunca se autoasigna desde la
  API** — solo se setea a mano en la base de datos.
- El flag viaja dentro del JWT de sesión (`SessionPayload.isPlatformOwner`,
  `lib/local/auth.ts`) desde el login (`app/api/auth/login/route.ts`), así
  que no hace falta una consulta extra en cada request.
- `contexts/auth-context.tsx` expone `isPlatformOwner` — controla el link
  "Plataforma" en `components/pos-header.tsx` y el guard de
  `app/plataforma/layout.tsx`.
- **Es independiente del rol PIN-based** (admin/cajero/mesero/cocina). Una
  cuenta puede ser dueña de la plataforma Y ADEMÁS ser miembro normal de su
  propia empresa (es el caso actual: `acc_johann`) — entra a `/plataforma`
  sin PIN ni selección de tienda, y por separado puede seguir usando el POS
  de su empresa como siempre.

## 3. Cómo ve datos de todas las empresas sin romper el aislamiento

`documents` tiene `FORCE ROW LEVEL SECURITY`. La política normal
(`company_id = current_setting('app.company_id', true)`) es la que aísla a
cada empresa — ningún usuario común puede tocarla. Se le agregó una segunda
condición, alcanzable SOLO desde el backend:

```sql
USING (
  company_id = current_setting('app.company_id', true)
  OR current_setting('app.is_platform_owner', true) = 'true'
)
```

`lib/local/pg-client.ts::withPlatformOwnerScope()` es la única función que
setea `app.is_platform_owner = 'true'` — y solo la llaman rutas
`app/api/platform/*` que ya verificaron `session.isPlatformOwner === true`
en el servidor (`lib/local/platform-auth.ts::getPlatformOwnerSession()`).
Ningún usuario normal puede llegar a setear esa variable, así que la
aislación entre empresas para todo el resto del sistema no cambia en nada.

Las tablas `companies` y `plans` no tienen RLS (nunca se exponen directo al
cliente, solo vía estas rutas) — mismo criterio que ya usaba `companies`
desde antes.

## 4. Rutas

| Ruta | Qué hace |
|---|---|
| `GET /api/platform/companies` | Lista empresas con cantidad de tiendas y usuarios |
| `PATCH /api/platform/companies` | Cambia `plan`/`active` de una empresa |
| `GET /api/platform/stores` | Lista todas las tiendas de todas las empresas |
| `GET /api/platform/users` | Lista cuentas de login (`auth_accounts`) con su empresa — nunca expone `password_hash` |
| `GET/POST/PATCH/DELETE /api/platform/plans` | CRUD de planes de suscripción |

Todas devuelven 403 si el JWT no trae `isPlatformOwner: true`.

## 5. Páginas

- `/plataforma` — resumen: empresas (plan, tiendas, usuarios, activa/no) +
  tiendas y a qué empresa pertenece cada una ("las conexiones").
- `/plataforma/usuarios` — cuentas de login de todas las empresas. Ojo: son
  las cuentas de correo/contraseña (una por empresa/admin), NO los usuarios
  operativos con PIN (mesero/cajero/cocina) — esos siguen viviendo dentro de
  cada empresa y se administran desde su propio `/admin`.
- `/plataforma/planes` — CRUD de planes (nombre, máximo de tiendas, costo
  mensual, moneda, activo/inactivo). **Informativo por ahora**: no hay cobro
  automático conectado, es la base para cuando se active la facturación.

## 6. Qué falta para "facturación real"

Los planes hoy son solo datos — falta:
- Asignar un plan a cada empresa desde la UI (por ahora solo vía `PATCH
  /api/platform/companies` con `plan` = el `name` o `id` de un plan; no hay
  selector en `/plataforma` todavía).
- Validar en `createOrderTransaction`/creación de tienda que una empresa no
  supere `max_stores` de su plan — no implementado, es de negocio decidir si
  se bloquea o solo se avisa.
- Integración de cobro (Stripe/Culqi/etc.) — fuera de alcance de esta
  primera versión.
