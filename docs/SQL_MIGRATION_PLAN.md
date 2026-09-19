# Plan de migración: Firestore → Supabase (Postgres), multi-empresa

## Estado actual: CERO dependencia de Firebase

La versión final de este proyecto no usa Firebase para nada — ni Auth ni
Firestore. El plan original (más abajo) arrancó manteniendo Firebase Auth
para el Paso 1 y migrando solo los datos; a mitad de camino se decidió sacar
Firebase del todo y reemplazar también el login. Lo que quedó:

- **Auth propia** (`lib/local/auth.ts`, `app/api/auth/login/route.ts`):
  correo/contraseña contra la tabla `auth_accounts` (scrypt, mismo esquema
  que ya usaba lifesystem-pos-desktop), con un JWT propio (`AUTH_JWT_SECRET`)
  como token de sesión — reemplaza por completo a Firebase Auth.
- **`company_members`** ahora mapea `auth_account_id` (no `firebase_uid`) a
  `company_id`.
- Los paquetes `firebase` y `firebase-admin` están desinstalados; no hay un
  solo `import` de Firebase en todo el código activo.
- `lib/firebase/firestore.ts` y `lib/local/firebase-shim/` **mantienen esos
  nombres de carpeta** por continuidad con el desktop y para no tocar los
  ~4500 líneas de lógica de negocio ni los ~40 archivos que los importan —
  pero no tienen ninguna relación con el Firebase real, es solo el nombre
  heredado del archivo que reemplazan.

## Objetivo original (para contexto histórico)

- Sacar Firestore de todo excepto la autenticación (Firebase Auth se
  quedaría para el Paso 1 del login: correo/contraseña) — **superado**, ver
  arriba.
- Todo lo demás (`stores`, `users`, `products`, `orders`, financiero,
  inventario, comprobantes...) pasa a vivir en Postgres (Supabase).
- El sistema es SaaS: una empresa puede tener varias sedes (`stores`), y la
  plataforma debe soportar varias empresas distintas sin que se mezclen datos
  entre ellas.
- Priorizar Supabase Realtime como reemplazo de los `onSnapshot` (23
  listeners en 6 archivos), en vez de dejarlo para después del polling.

## Por qué este enfoque (contexto)

`lifesystem-pos-desktop` ya resolvió "Firestore → Postgres" con un shim
(`lib/local/firebase-shim/firestore.ts`) que implementa el mismo subconjunto
de la API de `firebase/firestore` (`doc`, `collection`, `where`, `onSnapshot`,
`runTransaction`...) sobre una tabla `documents (collection, id, data JSONB)`.
Gracias a eso, las ~4500 líneas de lógica de negocio en
`lib/firebase/firestore.ts` no se tocaron — solo cambió el `import` al final
del archivo. Ese shim ya está probado de punta a punta (login, pedidos,
cocina, pagos, cierre de caja).

Reusamos esa misma idea acá, con dos diferencias importantes respecto al
desktop (que fue diseñado para una sola empresa en una sola PC):

1. **Tabla `companies` nueva** + columna `company_id` en `documents`.
2. **El shim corre contra Supabase en la nube**, no contra un Postgres local,
   y el reemplazo de `onSnapshot` usa Supabase Realtime en vez de polling
   cada 2s (que solo tenía sentido dentro de una LAN).

Ver [db/schema.sql](../db/schema.sql) para el esquema concreto.

## El bug que hay que cerrar en el mismo movimiento

Hoy, sin capa de empresa, estas funciones de `lib/firebase/firestore.ts` son
**globales** (leen/buscan en toda la base, no por empresa):

- [`getAllStores()`](../lib/firebase/firestore.ts#L662) — usada directo en
  [`components/dashboard/stores-status.tsx:49`](../components/dashboard/stores-status.tsx#L49)
  y [`app/dashboard/page.tsx:73`](../app/dashboard/page.tsx#L73). Con una
  segunda empresa en la plataforma, el dashboard de una mostraría también las
  sedes de la otra.
- [`getStoreByCode(code)`](../lib/firebase/firestore.ts#L657) — el código de
  tienda es único en toda la plataforma, no por empresa.
- [`getUserByPin(pin)`](../lib/firebase/firestore.ts#L707) — usada en el login
  de `super_admin` ([contexts/auth-context.tsx:271](../contexts/auth-context.tsx#L271)):
  busca el PIN entre TODOS los usuarios de TODAS las empresas.

Esto no rompe nada con una sola empresa de prueba. Rompe apenas entra la
segunda. Se corrige agregando `companyId` como primer filtro de estas tres
funciones (y cualquier otra que aparezca al auditar el resto del archivo con
el mismo criterio: "¿esto filtra por empresa o trae todo?").

## Cómo se resuelve `companyId` en cada request

1. Firebase Auth verifica el token (sin cambios — Paso 1 del login).
2. El backend busca la empresa dueña de ese `firebaseUid`/`email` en
   `companies.owner_firebase_uid` (hoy esto se aproxima con
   `getStoresByFirebaseCredentials`, que compara contra `store.firebaseUid`;
   pasa a resolverse primero a nivel de empresa, no de tienda suelta).
3. Ese `companyId` se guarda en el contexto de auth (junto a `user`/`store`,
   igual que hoy) y se manda en cada llamada a la API.
4. Cada API route, antes de tocar la base, hace
   `SELECT set_config('app.company_id', $1, true)` dentro de la misma
   conexión/transacción — así la política RLS de `documents` (ver schema.sql)
   rechaza cualquier fila de otra empresa aunque el código de arriba tenga un
   bug de scoping. Es la misma idea que ya usa el shim del desktop para
   optimistic concurrency (`expectedVersions`), solo que ahora también aplica
   a aislamiento entre empresas.

## Reemplazo de `onSnapshot`: relay de Supabase Realtime, no polling directo desde el navegador

**Decisión: el navegador nunca habla directo con Supabase.** En vez de darle
al cliente una API key de Supabase y dejar que se suscriba directo a
Realtime (lo cual exigiría "Third-Party Auth" de Supabase para que RLS
entienda un JWT de Firebase — viable, pero es una pieza más para salir a
producción pronto), el servidor hace de puente:

```
Navegador                Next.js API (server)              Supabase
   |                            |                              |
   |--- EventSource SSE ------->|                              |
   |    /api/realtime?          |--- 1 suscripción compartida->|
   |    collection=orders&      |    Realtime (service role,   |
   |    storeId=...             |    nunca sale del server)    |
   |                            |<-- evento postgres_changes ---|
   |                            |  (filtra por company_id/      |
   |                            |   storeId antes de reenviar)  |
   |<--- evento SSE (solo lo ---|                              |
   |     que le corresponde)    |                              |
```

- El servidor abre **una sola** suscripción de Realtime a `documents`
  (con la service role key, que jamás llega al navegador) y la reparte entre
  todos los clientes SSE conectados, filtrando por `company_id`/`storeId`
  antes de reenviar cada evento.
- El shim (`lib/local/firebase-shim/firestore.ts` adaptado) cambia su
  `onSnapshot` de "poll cada 2s a `/api/local-db`" a "abrir `EventSource`
  contra `/api/realtime`" — la firma de la función no cambia, así que
  `lib/firebase/firestore.ts` sigue sin tocarse.
- Si el stream SSE se corta (límite de duración de la función serverless),
  `EventSource` reconecta solo — es comportamiento nativo del navegador, no
  hay que programarlo.
- Ventaja sobre exponer Realtime directo al navegador: el aislamiento entre
  empresas queda en un solo lugar (este relay), no depende de configurar
  claims de JWT custom en Supabase. Se puede migrar a Realtime directo más
  adelante si el relay se vuelve un cuello de botella (no debería, para el
  rango de sedes del que hablamos antes).

## Fases de trabajo

1. ✅ **Crear proyecto Supabase** (región São Paulo) + correr
   [db/schema.sql](../db/schema.sql) (incluye `FORCE ROW LEVEL SECURITY` —
   sin esto el dueño de la tabla se salta RLS).
2. ✅ **Alta de la primera empresa** — [db/seed-first-company.sql](../db/seed-first-company.sql)
   (`companies` + `company_members`, mapeando tu UID de Firebase actual).
3. ✅ **Piezas de servidor**: [lib/local/pg-client.ts](../lib/local/pg-client.ts)
   (`withCompanyScope`), [lib/firebase-admin/config.ts](../lib/firebase-admin/config.ts)
   (verifica el idToken), [app/api/db/route.ts](../app/api/db/route.ts)
   (resuelve `companyId` y corre la operación con RLS activo).
4. ✅ **Shim adaptado** — [lib/local/firebase-shim/firestore.ts](../lib/local/firebase-shim/firestore.ts),
   mismo API que el original de Firestore, ahora hablando con `/api/db` con
   el idToken en el header. **Verificado de punta a punta** con
   `app/dev-test/page.tsx` (write + read reales contra Supabase, con RLS).
   `onSnapshot` todavía hace polling (3s) — el relay de Realtime es el
   siguiente paso, no cambia esta firma cuando se reemplace.
5. ⛔ **Relay de Realtime** (histórico — **eliminado 2026-09-19**: no funciona en
   Vercel serverless y no respetaba el alcance por local; el shim usa polling) —
   `app/api/realtime/route.ts` (SSE alimentado por Supabase Realtime, filtrado por `company_id`) +
   `onSnapshot` del shim adaptado para usarlo. **Verificado en vivo**: un
   `UPDATE` hecho desde el SQL Editor de Supabase apareció en el navegador
   sin refrescar ni hacer polling.
6. ⬜ **Migrar datos reales** de Firestore a `documents` (stores, users,
   products, etc. de la empresa actual) — recién ahí `getDocs`/`onSnapshot`
   sobre esas colecciones van a devolver algo.
7. ✅ **Bug de scoping — resuelto por diseño, sin tocar `firestore.ts`.**
   `/api/db` resuelve `companyId` desde el token en CADA request y escopea
   ahí (más RLS de respaldo) — `getAllStores`, `getStoreByCode`,
   `getUserByPin` quedan filtrados por empresa automáticamente sin que la
   lógica de negocio necesite conocer el concepto de "empresa", igual que
   pasaba con las reglas de seguridad de Firestore. No hay nada que migrar
   acá.
8. ✅ **Swap real** — hecho en `lib/firebase/firestore.ts` (una línea, igual
   que el desktop) + los 6 archivos que importaban `firebase/firestore`
   directo y se habían saltado ese único punto central (`lib/utils.ts`,
   `contexts/pos-context.tsx`, `lib/services/facturacion-service.ts`,
   `lib/services/clientes-service.ts`, `components/caja/closure-sales-modal.tsx`,
   `components/caja/daily-sales.tsx`). No hizo falta tocar `auth-context.tsx`
   para resolver `companyId` — eso lo resuelve `/api/db` por su cuenta desde
   el token en cada request, la app cliente no necesita saber que existe.
9. ⬜ Borrar `app/dev-test/` cuando ya no se use para probar cosas nuevas.
   `scripts/perf-test.mjs` se queda como herramienta de diagnóstico (no toca
   datos, solo mide).

## Cuentas de Firebase reales de esta empresa

Al migrar los datos se encontraron **5 cuentas de Firebase distintas** ya en
uso (de antes del modelo SaaS, cuando cada tienda podía tener su propio
login): 2 super_admin (`admin@lifesystemsolution.com`,
`johannsebastian789@gmail.com`) + 3 admins de tienda (`local_1_demo`,
`local_2_demo`, `local_3_demo`). Las 5 están mapeadas en `company_members` a
`lifesystemsolution`. Si aparece un nuevo "Este usuario no está asociado a
ninguna empresa" con una cuenta real, es una cuenta que falta agregar a
`company_members` — no un bug.

## Diagnóstico de latencia (resuelto)

La lentitud inicial no era un problema de diseño: en desarrollo, cada
reinicio de `next dev` deja el pool de conexiones "frío", y establecer una
conexión nueva a Supabase (TLS + handshake de Postgres) cuesta ~600-700ms.
Con tráfico concurrente real (`scripts/perf-test.mjs`), una vez las
conexiones están genuinamente calientes, el promedio baja a **~400ms por
operación** — el piso físico de 4 viajes de red (BEGIN/lookup+RLS/consulta/
COMMIT) a ~100ms cada uno hacia São Paulo. En producción (servidor que no se
reinicia en cada cambio de código, a diferencia del dev server) la mayoría
del tráfico real va a estar en ese estado "caliente", no en el frío que se
vio hoy. `getPool()` precalienta 10 conexiones al arrancar el proceso para
acortar esa ventana fría inicial.

## Fuera de este plan (a propósito)

- Integración SUNAT ampliada (notas de crédito, resumen diario, reenvío) —
  se retoma después, según lo acordado.
- Normalización relacional completa (tablas propias por colección en vez de
  `documents` JSONB) — queda como refinamiento futuro, tabla por tabla, sin
  bloquear la salida a producción.
