/**
 * app/api/platform/companies/[id]/route.ts
 * ---------------------------------------------------------------------------
 * Detalle de una empresa para /plataforma/empresas/[id]: info + tiendas +
 * cuentas de login (company_members) + usuarios operativos (PIN) + config
 * SUNAT. Todo en un solo GET para no encadenar varios round-trips en la UI.
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import { getPool, withPlatformOwnerScope } from "@/lib/local/pg-client"
import { getPlatformOwnerSession } from "@/lib/local/platform-auth"

export const runtime = "nodejs"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!getPlatformOwnerSession(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }
  const { id } = await params

  try {
    const { rows: companyRows } = await getPool().query(
      `SELECT id, name, plan, active, sunat_settings, created_at FROM companies WHERE id = $1`,
      [id]
    )
    const company = companyRows[0]
    if (!company) {
      return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 })
    }

    const { rows: members } = await getPool().query(
      `SELECT a.id, a.email, a.created_at
       FROM company_members cm
       JOIN auth_accounts a ON a.id = cm.auth_account_id
       WHERE cm.company_id = $1
       ORDER BY a.created_at ASC`,
      [id]
    )

    const { stores, operationalUsers } = await withPlatformOwnerScope(async (client) => {
      const { rows: storeRows } = await client.query(
        `SELECT id, data FROM documents WHERE collection = 'stores' AND company_id = $1 ORDER BY id`,
        [id]
      )
      const { rows: userRows } = await client.query(
        `SELECT id, data FROM documents WHERE collection = 'users' AND company_id = $1 ORDER BY id`,
        [id]
      )
      return { stores: storeRows, operationalUsers: userRows }
    })

    return NextResponse.json({
      company: {
        ...company,
        sunatConfigured: !!company.sunat_settings?.configured,
      },
      members,
      stores: stores.map((s) => ({ id: s.id, name: s.data?.name, code: s.data?.code, active: s.data?.active !== false })),
      operationalUsers: operationalUsers.map((u) => ({
        id: u.id,
        name: u.data?.name,
        role: u.data?.role,
        storeId: u.data?.storeId,
        active: u.data?.active !== false,
      })),
    })
  } catch (err: any) {
    console.error("[api/platform/companies/[id]] Error:", err)
    return NextResponse.json({ error: err?.message || "Error del servidor" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!getPlatformOwnerSession(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }
  const { id } = await params

  try {
    const body = await req.json()
    const { name, plan, active, sunatSettings } = body

    const sets: string[] = []
    const values: any[] = []
    if (name !== undefined) {
      values.push(name)
      sets.push(`name = $${values.length}`)
    }
    if (plan !== undefined) {
      values.push(plan)
      sets.push(`plan = $${values.length}`)
    }
    if (active !== undefined) {
      values.push(active)
      sets.push(`active = $${values.length}`)
    }
    if (sunatSettings !== undefined) {
      values.push(JSON.stringify(sunatSettings))
      sets.push(`sunat_settings = $${values.length}::jsonb`)
    }
    if (sets.length === 0) {
      return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 })
    }

    values.push(id)
    await getPool().query(`UPDATE companies SET ${sets.join(", ")} WHERE id = $${values.length}`, values)

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error("[api/platform/companies/[id] PATCH] Error:", err)
    return NextResponse.json({ error: err?.message || "Error del servidor" }, { status: 500 })
  }
}
