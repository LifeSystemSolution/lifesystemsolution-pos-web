# Panel de Plataforma (SaaS) y modelo de cuentas — `/plataforma`

> Agregado 2026-09-18; modelo de cuentas por nivel y control total agregados
> 2026-09-19. Separado por completo del `/admin` de cada empresa — es el
> panel del dueño del SaaS, no de ningún cliente. El login con la cuenta dueña
> de la plataforma entra DIRECTO acá (nunca pasa por PIN/selección de local).

## 1. Modelo de cuentas: quién entra cómo

Cada empresa tiene **dos niveles de cuenta de acceso** (correo + contraseña),
más los **perfiles con PIN** de cada empleado:

```
Dueño de la plataforma ── /plataforma ── controla TODO (empresas, cuentas, locales, usuarios, planes)
│
└─ Empresa "X"
   ├─ Cuenta de EMPRESA  (company_members.store_id = NULL)      → el SUPER ADMIN. Ve todos los locales.
   │     entra con su cuenta → pestaña "Super Admin" → su PIN → elige local
   │
   ├─ Local A
   │    └─ Cuenta del LOCAL A (store_id = A) ← la usan TODOS los empleados de A
   │          mesero / cajero / cocina entran con ESA cuenta → colocan SU PIN → su perfil
   │
   └─ Local B
        └─ Cuenta del LOCAL B (store_id = B)  ← empleados de B; nunca ven nada de A
```

- **Los locales no se mezclan.** Una cuenta de local solo ve/escribe datos de su
  propio local — lo hace cumplir el **servidor** (sección 4), no solo la UI.
- Un local **nunca queda sin cuenta**: crearlo (al crear la empresa o con
  "Agregar local") siempre incluye su cuenta de acceso.
- El PIN es único dentro de cada local, y el de los roles que cruzan locales
  (`super_admin`/`admin_global`) es único en toda la empresa — porque el login
  por PIN toma el primer usuario que coincide, y dos iguales harían que uno
  entre al perfil del otro.
- Empresa "demo" (`lifesystemsolution`): `acc_local1/2/3` quedaron atadas a
  LOCAL DEMO 1/2/3 (migración 004); `acc_admin` sigue siendo de empresa.

## 2. Quién es "dueño de la plataforma"

- `auth_accounts.is_platform_owner` (migración 002). **Nunca se autoasigna
  desde la API** — solo a mano en la base de datos.
- Viaja en el JWT (`SessionPayload.isPlatformOwner`). Es independiente del rol
  PIN: una cuenta puede ser dueña de la plataforma y además miembro normal de
  una empresa (caso actual: `acc_johann`).
- Sus cuentas están protegidas: `loadManageableAccount()` impide desactivarlas,
  cambiarles la contraseña o borrarlas desde `/plataforma`, y una cuenta no
  puede modificarse a sí misma (evita dejarse afuera por accidente).

## 3. Control total desde `/plataforma`

| Sobre… | Crear | Editar | Activar/desactivar | Eliminar | Otros |
|---|:-:|:-:|:-:|:-:|---|
| **Empresa** | ✓ (con Super Admin + 1er local) | nombre, plan, SUNAT | ✓ (corta a todos) | ✓ (cascada, confirma nombre) | — |
| **Cuenta de acceso** | ✓ (nivel empresa o local) | nivel (re-asignar), contraseña | ✓ (corte inmediato) | ✓ | — |
| **Local** | ✓ (siempre con su cuenta) | nombre, código | ✓ (arrastra a sus cuentas) | ✓ (cascada, confirma nombre) | — |
| **Usuario operativo (PIN)** | ✓ (PIN auto o manual) | nombre, rol, local, locales asignados | ✓ | ✓ | regenerar PIN, ver PIN |
| **Plan** | ✓ | ✓ | ✓ | ✓ | informativo (sin cobro aún) |

- **Desactivar** conserva los datos y corta el acceso en el siguiente request
  (aunque el JWT de 7 días siga vigente): `withCompanyScope()` revisa
  `auth_accounts.active` y `companies.active` en la MISMA consulta que resuelve
  la empresa (cero viajes extra). El navegador abierto se cierra solo y vuelve
  al login con un aviso (`/?disabled=1`).
- Desactivar un **local** desactiva también las cuentas atadas a él (así el
  corte es inmediato) y al reactivarlo las reactiva.
- **Eliminar** es irreversible: exige escribir el nombre exacto (la UI lo pide y
  el servidor lo vuelve a exigir con `?confirm=`). Borra en cascada:
  - Local: todo documento con su `storeId` (pedidos, mesas, productos,
    inventario, cajas, usuarios, clientes, comprobantes…), sus cuentas de
    acceso, y lo quita de `assignedStores` de los `admin_global`.
  - Empresa: todos sus documentos, membresías y cuentas de acceso (la cuenta del
    dueño de la plataforma nunca se borra, solo pierde la membresía).

## 4. Cómo se hace cumplir (servidor)

Dos capas, ambas en el servidor:

**a) Aislamiento entre empresas — RLS.** `documents` tiene `FORCE ROW LEVEL
SECURITY`; la política deja pasar `company_id = app.company_id`, o
`app.is_platform_owner = 'true'` (solo lo setea `withPlatformOwnerScope()`,
que únicamente llaman las rutas `/api/platform/*` tras verificar
`isPlatformOwner`). `companies`, `plans` y `auth_accounts` no tienen RLS: solo
se tocan desde el backend.

**b) Aislamiento entre locales y alta/baja estructural —
[`lib/local/db-access-policy.ts`](../lib/local/db-access-policy.ts), aplicada por
[`app/api/db/route.ts`](../app/api/db/route.ts) en cada request:**

- Cuentas de LOCAL: `getDoc/getDocs` solo devuelven filas de su local
  (`stores` → su id; `users` → estricto por `storeId`, así nunca ven PIN de
  otros locales ni de roles que cruzan locales; el resto → `data.storeId` propio
  o sin `storeId`, que es dato compartido de la empresa). Las escrituras a
  cualquier doc de otro local, o que declaren otro `storeId`, → 403; una
  operación ajena dentro de un `batch` tumba el batch entero (no se aplica
  nada).
- Nadie salvo el dueño de la plataforma puede: crear `users`/`stores` (ni por
  `addDoc`, ni por `setDoc` con ID propio, ni por `batch` — cerrado el
  2026-09-19: antes solo se bloqueaba `addDoc`), borrar tiendas, ni asignar los
  roles `super_admin`/`admin_global`. Editar/desactivar lo que ya existe sigue
  permitido a los admins de la empresa (dentro de su alcance).
- Cuenta o empresa desactivada → 403 con `code: account_disabled |
  company_disabled`.

El relay `/api/realtime` se **eliminó** (2026-09-19): era código muerto (no
funciona en Vercel serverless) y, con cuentas de local, habría filtrado eventos
de todos los locales de la empresa.

## 5. Rutas de plataforma (todas exigen `isPlatformOwner`)

| Ruta | Qué hace |
|---|---|
| `GET/POST /api/platform/companies` | Listar / **crear empresa completa** en una transacción: cuenta de empresa (Super Admin) + 1er local con SU cuenta + usuario `super_admin` y `admin` con PIN únicos (devueltos una sola vez) |
| `GET/PATCH/DELETE /api/platform/companies/[id]` | Detalle completo (incluye PIN) / nombre-plan-activa-SUNAT / eliminar (`?confirm=`) |
| `POST /api/platform/companies/[id]/members` | Cuenta nueva: sin `storeId` = empresa, con `storeId` = local |
| `PATCH/DELETE …/members/[accountId]` | `active`, `password`, `storeId` (re-asignar) / eliminar |
| `POST …/stores` | Local nuevo: 10 mesas + inventario base + SU cuenta (`accountEmail/accountPassword`) |
| `PATCH/DELETE …/stores/[storeId]` | nombre/código/`active` (arrastra cuentas) / eliminar en cascada (`?confirm=`) |
| `POST …/users` | Usuario operativo (PIN auto o manual; rol ↔ local validados) |
| `PATCH/DELETE …/users/[userId]` | nombre/rol/local/PIN/`regeneratePin`/`active`/`assignedStores` / eliminar |
| `GET /api/platform/stores`, `GET /api/platform/users` | Vistas globales (locales; cuentas con nivel y estado) |
| `GET/POST/PATCH/DELETE /api/platform/plans` | CRUD de planes |

Errores esperados (correo duplicado, PIN repetido, local que no es de la
empresa…) responden 4xx con mensaje claro vía `runOwnerRoute()`.

## 6. Páginas

- `/plataforma` — resumen + **Crear empresa** (dos secciones: cuenta del Super
  Admin, y primer local con su cuenta; al terminar muestra ambas cuentas y los
  PIN, con botón "Copiar credenciales").
- `/plataforma/empresas/[id]` — el panel de control de una empresa: información
  (nombre/plan/estado/eliminar), cuentas de acceso, locales, usuarios operativos
  (PIN oculto con ojo, filtro por local, regenerar PIN) y SUNAT. Los borrados
  destructivos piden escribir el nombre.
- `/plataforma/usuarios` — cuentas de todas las empresas (nivel y estado).
- `/plataforma/planes` — CRUD de planes (informativo, sin cobro aún).

## 7. SUNAT por empresa — qué hace y qué le falta

`companies.sunat_settings` (JSONB: `{baseUrl, apiKey, apiSecret, configured}`)
guarda la config por empresa, editable desde `/plataforma/empresas/[id]`.
**Todavía NO está conectado a la emisión real** — `app/api/facturacion/route.ts`
sigue leyendo `SUNAT_API_*` de las variables de entorno globales. Falta:
- Que esa ruta resuelva `company_id` desde la sesión y lea
  `companies.sunat_settings` en vez del `process.env` global.
- Ojo: `app/api/facturacion` y `app/api/consultas/documento` **no exigen
  sesión hoy** (cualquiera que conozca la URL puede llamarlas). Con SUNAT sin
  configurar es inofensivo, pero hay que cerrarlo antes de activarlo.

## 8. Qué falta para "facturación real" del SaaS

- Validar que una empresa no supere `max_stores` de su plan al agregar un local
  (hoy no se bloquea ni se avisa — decisión de negocio).
- Integración de cobro (Stripe/Culqi/etc.).
- Cambiar la contraseña no invalida los JWT ya emitidos (duran 7 días);
  **desactivar** la cuenta sí corta de inmediato — usar eso si hay urgencia.

## Borrar datos de prueba (2026-09-28)

`/plataforma/empresas/[id]` → **Datos de prueba**. Borra la operación de toda
la empresa o de un solo local: pedidos, cajas, saldos y movimientos, gastos,
comprobantes, reportes e historial (lista exacta en
`lib/local/test-data-reset.ts`, `TRANSACTIONAL_COLLECTIONS`). No toca
productos, mesas, usuarios, locales, inventario, cuentas ni configuración.

- Muestra antes cuántos registros se borran (`GET .../test-data`).
- Exige escribir el nombre exacto del local o de la empresa (lo verifica el
  servidor) y solo lo puede usar el dueño de la plataforma.
- Por defecto devuelve al stock lo que descontaron esos pedidos (los ítems
  anulados no, porque ya se devolvieron al anularse) y libera las mesas.
- Todo en una transacción: si algo falla, no se borra nada.
