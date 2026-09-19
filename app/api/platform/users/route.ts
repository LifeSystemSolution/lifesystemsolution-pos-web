/**
 * app/api/platform/users/route.ts
 * ---------------------------------------------------------------------------
 * Vista de plataforma: cuentas de login (auth_accounts) de todas las
 * empresas, con su empresa, su nivel (empresa / local) y si están activas.
 * Solo expone email/fechas/flags — nunca password_hash. No confundir con los
 * `User` (PIN operativo) de cada tienda, que viven dentro de `documents` por
 * empresa y se ven/administran en /plataforma/empresas/[id].
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import { getPool, withPlatformOwnerScope } from "@/lib/local/pg-client"
import { runOwnerRoute } from "@/lib/local/platform-auth"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  return runOwnerRoute(req, "users GET", async () => {
    const { rows } = await getPool().query<{
      id: string
      email: string
      is_platform_owner: boolean
      active: boolean
      created_at: string
      company_id: string | null
      company_name: string | null
      store_id: string | null
    }>(`
      SELECT a.id, a.email, a.is_platform_owner, a.active, a.created_at,
             cm.company_id, c.name AS company_name, cm.store_id
      FROM auth_accounts a
      LEFT JOIN company_members cm ON cm.auth_account_id = a.id
      LEFT JOIN companies c ON c.id = cm.company_id
      ORDER BY a.created_at ASC
    `)

    const storeNames = await withPlatformOwnerScope(async (client) => {
      const { rows: stores } = await client.query<{ id: string; data: any }>(
        `SELECT id, data FROM documents WHERE collection = 'stores'`
      )
      return new Map(stores.map((s) => [s.id, s.data?.name as string]))
    })

    return NextResponse.json({
      users: rows.map((r) => ({
        id: r.id,
        email: r.email,
        isPlatformOwner: r.is_platform_owner,
        active: r.active,
        createdAt: r.created_at,
        companyId: r.company_id,
        companyName: r.company_name,
        storeId: r.store_id,
        storeName: r.store_id ? storeNames.get(r.store_id) || r.store_id : null,
      })),
    })
  })
}
