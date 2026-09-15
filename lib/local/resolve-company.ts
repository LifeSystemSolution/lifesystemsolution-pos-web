/**
 * lib/local/resolve-company.ts
 * ---------------------------------------------------------------------------
 * Resuelve a qué empresa pertenece una cuenta (auth_accounts.id) ya
 * verificada por su JWT de sesión. Es la única consulta del sistema sin
 * scope de empresa (ver db/schema.sql) — compartida entre
 * app/api/db/route.ts y app/api/realtime/route.ts para no duplicarla.
 * ---------------------------------------------------------------------------
 */
import { getPool } from "@/lib/local/pg-client"

export async function resolveCompanyId(accountId: string): Promise<string | null> {
  const { rows } = await getPool().query<{ company_id: string }>(
    `SELECT company_id FROM company_members WHERE auth_account_id = $1`,
    [accountId]
  )
  return rows[0]?.company_id ?? null
}
