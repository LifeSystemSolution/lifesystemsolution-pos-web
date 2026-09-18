/**
 * app/api/platform/stores/route.ts
 * ---------------------------------------------------------------------------
 * Vista de plataforma: todas las tiendas de todas las empresas ("las
 * conexiones" — qué tienda pertenece a qué empresa, si está activa). Lee
 * `documents` (collection "stores") a través de withPlatformOwnerScope, la
 * única forma de ver filas de más de una empresa a la vez.
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import { getPool, withPlatformOwnerScope } from "@/lib/local/pg-client"
import { getPlatformOwnerSession } from "@/lib/local/platform-auth"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  if (!getPlatformOwnerSession(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }

  try {
    const stores = await withPlatformOwnerScope(async (client) => {
      const { rows } = await client.query<{ id: string; company_id: string; data: any; updated_at: string }>(
        `SELECT id, company_id, data, updated_at FROM documents WHERE collection = 'stores' ORDER BY company_id, id`
      )
      return rows
    })

    const { rows: companies } = await getPool().query<{ id: string; name: string }>(
      `SELECT id, name FROM companies`
    )
    const companyNameById = new Map(companies.map((c) => [c.id, c.name]))

    const result = stores.map((s) => ({
      id: s.id,
      companyId: s.company_id,
      companyName: companyNameById.get(s.company_id) || s.company_id,
      name: s.data?.name || s.id,
      code: s.data?.code || null,
      active: s.data?.active !== false,
      updatedAt: s.updated_at,
    }))

    return NextResponse.json({ stores: result })
  } catch (err: any) {
    console.error("[api/platform/stores] Error:", err)
    return NextResponse.json({ error: err?.message || "Error del servidor" }, { status: 500 })
  }
}
