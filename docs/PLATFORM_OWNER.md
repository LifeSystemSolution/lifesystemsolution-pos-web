# Panel de Plataforma (SaaS) — `/plataforma`

> Agregado 2026-09-18, ampliado el mismo día con creación de empresas,
> cuentas de acceso y config SUNAT por empresa. Separado por completo del
> `/admin` de cada empresa — es el panel del dueño del SaaS (LifeSystemSolution
> como negocio), no de ningún cliente/empresa individual. El login con la
> cuenta dueña de la plataforma entra DIRECTO acá — nunca pasa por la
> pantalla de PIN/selección de tienda (ver sección 7).

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
| `POST /api/platform/companies` | **Bootstrapea una empresa nueva completa**: `companies` + primera cuenta de login + tienda inicial + usuario operativo admin (PIN), todo en una transacción. Devuelve el PIN generado (una sola vez). |
| `GET /api/platform/companies/[id]` | Detalle: info + cuentas de acceso + tiendas + usuarios operativos + config SUNAT |
| `PATCH /api/platform/companies/[id]` | Actualiza `name`/`plan`/`active`/`sunatSettings` de una empresa |
| `POST /api/platform/companies/[id]/members` | Agrega otra cuenta de login a una empresa ya existente (ej. segundo admin) |
| `DELETE /api/platform/companies/[id]/members?accountId=X` | Quita el acceso de una cuenta |
| `POST /api/platform/companies/[id]/stores` | Agrega una tienda a una empresa existente — 10 mesas + inventario base de pizza (mismo shape que `initializeStoreData()`) |
| `POST /api/platform/companies/[id]/users` | Agrega un usuario operativo (PIN, generado automáticamente) a una empresa existente |
| `GET /api/platform/stores` | Lista todas las tiendas de todas las empresas |
| `GET /api/platform/users` | Lista cuentas de login (`auth_accounts`) con su empresa — nunca expone `password_hash` |
| `GET/POST/PATCH/DELETE /api/platform/plans` | CRUD de planes de suscripción |

### 4.1 Crear tiendas/usuarios es EXCLUSIVO de estas rutas

Desde 2026-09-18, `/admin` (el panel de cada empresa) ya no tiene forma de
crear tiendas ni usuarios operativos nuevos — los botones se quitaron, y
`app/api/db/route.ts` rechaza con 403 cualquier `addDoc` sobre las
colecciones `users`/`stores` si la sesión no tiene `isPlatformOwner: true`,
sin importar el rol (`super_admin` de empresa incluido). Esto se decidió a
nivel de negocio: el dueño de la plataforma quiere ser el único punto de alta
de tiendas/usuarios/cuentas de acceso. `/admin` conserva **editar y
desactivar** los que ya existen — solo la creación quedó centralizada acá.

Todas devuelven 403 si el JWT no trae `isPlatformOwner: true`.

## 5. Páginas

- `/plataforma` — resumen: empresas (plan, tiendas, usuarios, activa/no) +
  tiendas y a qué empresa pertenece cada una ("las conexiones"). Botón
  **"Crear empresa"**: pide nombre, plan, nombre de la primera tienda, correo
  y contraseña del admin — al crear muestra el PIN operativo generado (única
  vez que se ve).
- `/plataforma/empresas/[id]` — detalle de una empresa:
  - Info general: plan (selector) y activa/inactiva, con guardado.
  - Cuentas de acceso (correo/contraseña): agregar o quitar.
  - Tiendas de la empresa: **agregar** ("10 mesas + inventario de pizza,
    lista para usar) — cuentan contra el límite de tiendas del plan. Editar
    una existente sigue siendo cosa del `/admin` de la empresa.
  - Usuarios operativos con PIN: **agregar** (nombre, rol, tienda — el PIN se
    genera solo y se muestra una vez). Editar/desactivar uno existente sigue
    siendo cosa del `/admin` de la empresa.
  - **Conexión SUNAT de esta empresa**: URL base, API Key, API Secret,
    guardados en `companies.sunat_settings` (JSONB). Ver sección 6.
- `/plataforma/usuarios` — cuentas de login de todas las empresas (vista
  plana, cruzando empresas — complementa la vista por-empresa de arriba).
- `/plataforma/planes` — CRUD de planes (nombre, máximo de tiendas, costo
  mensual, moneda, activo/inactivo). **Informativo por ahora**: no hay cobro
  automático conectado, es la base para cuando se active la facturación.

## 6. SUNAT por empresa — qué hace y qué le falta

Cada empresa tiene su propio RUC, así que no puede compartir una sola config
de SUNAT global. `companies.sunat_settings` (JSONB: `{baseUrl, apiKey,
apiSecret, configured}`) guarda esa config por empresa, editable desde
`/plataforma/empresas/[id]`.

**Todavía NO está conectado a la emisión real de comprobantes** —
`app/api/facturacion/route.ts` sigue leyendo `SUNAT_API_BASE_URL`/`KEY`/
`SECRET` de las variables de entorno globales de Vercel (una sola config
para todas las empresas). Falta, para la siguiente etapa:
- Que `app/api/facturacion/route.ts` resuelva `company_id` desde la sesión y
  lea `companies.sunat_settings` de esa empresa en vez del `process.env`
  global.
- Decidir qué pasa si una empresa no tiene `sunat_settings.configured` — hoy
  el dashboard ya oculta las alarmas de SUNAT cuando no está configurado
  (ver TESTING_REPORT.md), ese comportamiento debería aplicar por empresa.

## 7. Login del dueño de la plataforma

`app/page.tsx` tiene un `useEffect` que redirige a `/plataforma` apenas
`isFirebaseAuthenticated && isPlatformOwner` son ambos verdaderos — antes de
que la pantalla de PIN llegue a mostrarse. No pasa por selección de
tienda ni PIN operativo en ningún momento.

## 8. Qué falta para "facturación real" del SaaS

Los planes hoy son solo datos — falta:
- Validar en `createOrderTransaction`/creación de tienda que una empresa no
  supere `max_stores` de su plan — no implementado, es de negocio decidir si
  se bloquea o solo se avisa.
- Integración de cobro (Stripe/Culqi/etc.) — fuera de alcance de esta
  primera versión.
