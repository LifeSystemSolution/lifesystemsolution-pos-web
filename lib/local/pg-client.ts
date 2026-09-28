/**
 * lib/local/pg-client.ts
 * ---------------------------------------------------------------------------
 * Cliente de PostgreSQL (Neon; antes Supabase). SOLO se importa desde código de servidor
 * (Route Handlers en app/api/**), nunca desde componentes "use client" ni
 * desde el shim del navegador — "pg" es un módulo de Node.
 *
 * Adaptado de lifesystem-pos-desktop/lib/local/pg-client.ts: ahí conectaba a
 * un Postgres local con host/puerto sueltos; acá conecta con una sola
 * connection string al pooler del proveedor (Neon: el host con "-pooler";
 * Supabase: "Transaction pooler", puerto 6543). hashPassword/verifyPassword viven en
 * lib/local/auth.ts, no acá.
 * ---------------------------------------------------------------------------
 */
import { Pool } from "pg"

declare global {
  // eslint-disable-next-line no-var
  var __lssPgPool: Pool | undefined
}

// En Vercel cada instancia de la función puede crear su propio pool, y con
// Fluid compute una misma instancia atiende varios requests a la vez: con 2
// conexiones los requests concurrentes hacían cola. DATABASE_URL apunta al
// pooler (PgBouncer, modo transaction — en Neon, el host con "-pooler"), que
// acepta miles de clientes, así que 5 por instancia es seguro.
const POOL_SIZE = 5

export function getPool(): Pool {
  if (!global.__lssPgPool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error("Falta DATABASE_URL en el entorno (ver .env.example)")
    }
    const pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }, // Neon/Supabase exigen TLS
      // El pooler (PgBouncer, modo transaction) ya reparte
      // conexiones entre invocaciones serverless — cada instancia de esta
      // función solo necesita un puñado propias, no cientos.
      max: POOL_SIZE,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
    global.__lssPgPool = pool
  }
  return global.__lssPgPool
}

/**
 * Resuelve qué empresa es `accountId` (auth_accounts.id, del JWT de sesión
 * ya verificado) Y corre `fn` en la MISMA transacción,
 * con `app.company_id` seteado para toda la conexión durante esa transacción
 * — es lo que hace que la política RLS de `documents` (ver db/schema.sql)
 * aplique. `set_config(..., true)` con el tercer argumento en `true` es
 * "local a la transacción": se olvida solo al hacer COMMIT/ROLLBACK, no se
 * filtra a la siguiente conexión que el pool le preste a otro request —
 * importante, porque si se seteara a nivel de sesión (`SET` sin `LOCAL`) en
 * una conexión pooleada, el próximo request que reuse esa conexión física
 * heredaría el `company_id` de otro cliente. Nunca cambiar esto a `SET` a
 * secas para "ahorrar" el BEGIN/COMMIT.
 *
 * Resolver la empresa y setear la config van en UNA sola consulta (en vez de
 * dos) para ahorrar un viaje de red.
 *
 * En esa misma consulta se cambia al rol `pos_app` (también local a la
 * transacción): el rol de DATABASE_URL tiene BYPASSRLS y con él la política
 * RLS no se aplicaba. pos_app solo tiene permisos sobre `documents` — dentro
 * de `fn` no se puede tocar ninguna otra tabla. Ver
 * db/migrations/005_app_role_rls.sql.
 *
 * SIEMPRE usar esto para tocar `documents` — nunca `pool.query` directo con
 * un `company_id` armado a mano en el WHERE (ese es justo el tipo de olvido
 * que RLS está para cubrir, no para reemplazar el filtrado a mano en el resto
 * de las queries).
 */
export type CompanyScope = {
  companyId: string
  /** null = cuenta de EMPRESA (ve todos los locales); con valor = cuenta de LOCAL (solo ese local). */
  storeId: string | null
  isPlatformOwner: boolean
}

export type CompanyScopeOutcome<T> =
  | { status: "no_company" }
  | { status: "disabled"; reason: "account" | "company" }
  | { status: "ok"; scope: CompanyScope; result: T }

/**
 * Además de la empresa, resuelve en la MISMA consulta (cero viajes extra) el
 * local al que está atada la cuenta (company_members.store_id) y si la
 * cuenta o la empresa fueron desactivadas — así desactivar corta el acceso
 * en el siguiente request aunque el JWT (7 días) siga vigente. Las cuentas
 * dueñas de la plataforma ignoran el flag `active` de su propia cuenta (no
 * pueden dejarse afuera a sí mismas).
 */
export async function withCompanyScope<T>(
  accountId: string,
  fn: (client: import("pg").PoolClient, scope: CompanyScope) => Promise<T>
): Promise<CompanyScopeOutcome<T>> {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const { rows } = await client.query<{
      company_id: string
      store_id: string | null
      account_active: boolean
      is_platform_owner: boolean
      company_active: boolean
    }>(
      `SELECT cm.company_id,
              cm.store_id,
              a.active AS account_active,
              a.is_platform_owner,
              c.active AS company_active,
              set_config('app.company_id', cm.company_id, true),
              set_config('role', 'pos_app', true)
       FROM company_members cm
       JOIN auth_accounts a ON a.id = cm.auth_account_id
       JOIN companies c ON c.id = cm.company_id
       WHERE cm.auth_account_id = $1`,
      [accountId]
    )
    const row = rows[0]
    if (!row) {
      await client.query("ROLLBACK")
      return { status: "no_company" }
    }
    if (!row.account_active && !row.is_platform_owner) {
      await client.query("ROLLBACK")
      return { status: "disabled", reason: "account" }
    }
    if (!row.company_active) {
      await client.query("ROLLBACK")
      return { status: "disabled", reason: "company" }
    }
    const scope: CompanyScope = {
      companyId: row.company_id,
      storeId: row.store_id,
      isPlatformOwner: row.is_platform_owner,
    }
    const result = await fn(client, scope)
    await client.query("COMMIT")
    return { status: "ok", scope, result }
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}

/**
 * Para rutas /api/platform/* que YA verificaron `session.isPlatformOwner ===
 * true` en el servidor. Setea `app.is_platform_owner`, la segunda condición
 * de la política RLS de `documents` (ver db/schema.sql) — dejar pasar
 * cualquier fila sin importar su `company_id`. Nunca llamar esto con datos
 * de sesión no verificados: es la única forma de ver a través de todas las
 * empresas a la vez.
 */
export async function withPlatformOwnerScope<T>(
  fn: (client: import("pg").PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query(`SELECT set_config('app.is_platform_owner', 'true', true)`)
    const result = await fn(client)
    await client.query("COMMIT")
    return result
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}
