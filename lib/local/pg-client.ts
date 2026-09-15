/**
 * lib/local/pg-client.ts
 * ---------------------------------------------------------------------------
 * Cliente de PostgreSQL (Supabase). SOLO se importa desde código de servidor
 * (Route Handlers en app/api/**), nunca desde componentes "use client" ni
 * desde el shim del navegador — "pg" es un módulo de Node.
 *
 * Adaptado de lifesystem-pos-desktop/lib/local/pg-client.ts: ahí conectaba a
 * un Postgres local con host/puerto sueltos; acá conecta a Supabase con una
 * sola connection string (el modo "Transaction pooler", puerto 6543 — ver
 * docs/SQL_MIGRATION_PLAN.md). hashPassword/verifyPassword viven en
 * lib/local/auth.ts, no acá.
 * ---------------------------------------------------------------------------
 */
import { Pool } from "pg"

declare global {
  // eslint-disable-next-line no-var
  var __lssPgPool: Pool | undefined
}

const POOL_SIZE = 10

export function getPool(): Pool {
  if (!global.__lssPgPool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error("Falta DATABASE_URL en el entorno (ver .env.example)")
    }
    const pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }, // Supabase pooler exige TLS
      // El pooler de Supabase (PgBouncer, modo transaction) ya reparte
      // conexiones entre invocaciones serverless — cada instancia de esta
      // función solo necesita un puñado propias, no cientos.
      max: POOL_SIZE,
      idleTimeoutMillis: 30_000,
    })
    global.__lssPgPool = pool

    // Precalentar: el handshake TLS + el startup de Postgres contra un
    // Postgres en otra región cuesta ~600-700ms POR CONEXIÓN NUEVA. Sin esto,
    // cuando el navegador dispara varias lecturas en paralelo al montar una
    // página (varias colecciones a la vez), cada una que no encuentra una
    // conexión ociosa paga ese costo de nuevo — es la causa real de la
    // lentitud que se vio en dev. Abriendo las conexiones de una al arrancar
    // el proceso, quedan listas ANTES de que llegue tráfico real.
    for (let i = 0; i < POOL_SIZE; i++) {
      pool
        .connect()
        .then((client) => client.release())
        .catch((err) => console.error("[pg-client] Error precalentando conexión:", err.message))
    }
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
 * dos) para ahorrar un viaje de red — con Supabase en otra región, cada
 * round-trip de más se nota.
 *
 * SIEMPRE usar esto para tocar `documents` — nunca `pool.query` directo con
 * un `company_id` armado a mano en el WHERE (ese es justo el tipo de olvido
 * que RLS está para cubrir, no para reemplazar el filtrado a mano en el resto
 * de las queries).
 */
export async function withCompanyScope<T>(
  accountId: string,
  fn: (client: import("pg").PoolClient, companyId: string) => Promise<T>
): Promise<{ companyId: null } | { companyId: string; result: T }> {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const { rows } = await client.query<{ company_id: string }>(
      `SELECT company_id, set_config('app.company_id', company_id, true)
       FROM company_members WHERE auth_account_id = $1`,
      [accountId]
    )
    const companyId = rows[0]?.company_id
    if (!companyId) {
      await client.query("ROLLBACK")
      return { companyId: null }
    }
    const result = await fn(client, companyId)
    await client.query("COMMIT")
    return { companyId, result }
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}
