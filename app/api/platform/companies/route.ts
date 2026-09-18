/**
 * app/api/platform/companies/route.ts
 * ---------------------------------------------------------------------------
 * Vista de plataforma: todas las empresas del SaaS, con cantidad de tiendas
 * y de usuarios. `companies`/`company_members` no tienen RLS (son de
 * servidor únicamente), así que un simple pool.query alcanza — no hace falta
 * withPlatformOwnerScope acá (esa función es para leer `documents`, que sí
 * tiene RLS). El conteo de tiendas sí lee `documents`, por eso usa
 * withPlatformOwnerScope para esa parte.
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
    const { rows: companies } = await getPool().query<{
      id: string
      name: string
      plan: string
      active: boolean
      created_at: string
    }>(`SELECT id, name, plan, active, created_at FROM companies ORDER BY created_at ASC`)

    const { rows: memberCounts } = await getPool().query<{ company_id: string; count: string }>(
      `SELECT company_id, COUNT(*) AS count FROM company_members GROUP BY company_id`
    )
    const memberCountByCompany = new Map(memberCounts.map((r) => [r.company_id, Number(r.count)]))

    const storeCounts = await withPlatformOwnerScope(async (client) => {
      const { rows } = await client.query<{ company_id: string; count: string }>(
        `SELECT company_id, COUNT(*) AS count FROM documents WHERE collection = 'stores' GROUP BY company_id`
      )
      return rows
    })
    const storeCountByCompany = new Map(storeCounts.map((r) => [r.company_id, Number(r.count)]))

    const result = companies.map((c) => ({
      ...c,
      userCount: memberCountByCompany.get(c.id) || 0,
      storeCount: storeCountByCompany.get(c.id) || 0,
    }))

    return NextResponse.json({ companies: result })
  } catch (err: any) {
    console.error("[api/platform/companies] Error:", err)
    return NextResponse.json({ error: err?.message || "Error del servidor" }, { status: 500 })
  }
}

// Actualiza plan/estado activo de una empresa.
export async function PATCH(req: NextRequest) {
  if (!getPlatformOwnerSession(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }

  try {
    const body = await req.json()
    const { id, plan, active } = body
    if (!id) {
      return NextResponse.json({ error: "Falta id de la empresa" }, { status: 400 })
    }

    const sets: string[] = []
    const values: any[] = []
    if (plan !== undefined) {
      values.push(plan)
      sets.push(`plan = $${values.length}`)
    }
    if (active !== undefined) {
      values.push(active)
      sets.push(`active = $${values.length}`)
    }
    if (sets.length === 0) {
      return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 })
    }

    values.push(id)
    await getPool().query(`UPDATE companies SET ${sets.join(", ")} WHERE id = $${values.length}`, values)

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error("[api/platform/companies PATCH] Error:", err)
    return NextResponse.json({ error: err?.message || "Error del servidor" }, { status: 500 })
  }
}
