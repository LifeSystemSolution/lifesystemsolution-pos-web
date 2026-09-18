/**
 * app/api/platform/users/route.ts
 * ---------------------------------------------------------------------------
 * Vista de plataforma: cuentas de login (auth_accounts) de todas las
 * empresas, con la empresa a la que pertenecen. Solo expone email/fecha/rol
 * de plataforma — nunca password_hash. No confundir con los `User` (PIN
 * operativo) de cada tienda, que viven dentro de `documents` por empresa;
 * esos se administran desde el /admin de cada empresa, no desde acá.
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import { getPool } from "@/lib/local/pg-client"
import { getPlatformOwnerSession } from "@/lib/local/platform-auth"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  if (!getPlatformOwnerSession(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }

  try {
    const { rows } = await getPool().query<{
      id: string
      email: string
      is_platform_owner: boolean
      created_at: string
      company_id: string | null
      company_name: string | null
    }>(`
      SELECT
        a.id,
        a.email,
        a.is_platform_owner,
        a.created_at,
        cm.company_id,
        c.name AS company_name
      FROM auth_accounts a
      LEFT JOIN company_members cm ON cm.auth_account_id = a.id
      LEFT JOIN companies c ON c.id = cm.company_id
      ORDER BY a.created_at ASC
    `)

    const users = rows.map((r) => ({
      id: r.id,
      email: r.email,
      isPlatformOwner: r.is_platform_owner,
      createdAt: r.created_at,
      companyId: r.company_id,
      companyName: r.company_name,
    }))

    return NextResponse.json({ users })
  } catch (err: any) {
    console.error("[api/platform/users] Error:", err)
    return NextResponse.json({ error: err?.message || "Error del servidor" }, { status: 500 })
  }
}
