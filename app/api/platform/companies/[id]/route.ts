/**
 * app/api/platform/companies/[id]/route.ts
 * ---------------------------------------------------------------------------
 * GET: detalle de una empresa para /plataforma/empresas/[id] — info, cuentas
 *      de acceso (de empresa y de local), tiendas, usuarios operativos (con
 *      su PIN: el dueño de la plataforma controla todo) y config SUNAT. Todo
 *      en un solo request para no encadenar varios round-trips en la UI.
 * PATCH: nombre / plan / activa / config SUNAT.
 * DELETE: elimina la empresa y TODO lo suyo (datos, cuentas de acceso).
 *      Exige `?confirm=<nombre exacto>` como segunda barrera. La cuenta del
 *      dueño de la plataforma nunca se borra, solo se le quita la membresía.
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import { getPool, withPlatformOwnerScope } from "@/lib/local/pg-client"
import { runOwnerRoute, HttpError } from "@/lib/local/platform-auth"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  return runOwnerRoute(req, "companies/[id] GET", async () => {
    const { id } = await params

    const { rows: companyRows } = await getPool().query(
      `SELECT id, name, plan, active, sunat_settings, created_at FROM companies WHERE id = $1`,
      [id]
    )
    const company = companyRows[0]
    if (!company) throw new HttpError(404, "Empresa no encontrada")

    const { rows: members } = await getPool().query(
      `SELECT a.id, a.email, a.active, a.is_platform_owner, a.created_at, cm.store_id
       FROM company_members cm
       JOIN auth_accounts a ON a.id = cm.auth_account_id
       WHERE cm.company_id = $1
       ORDER BY (cm.store_id IS NOT NULL), a.created_at ASC`,
      [id]
    )

    const { stores, operationalUsers } = await withPlatformOwnerScope(async (client) => {
      const { rows: storeRows } = await client.query(
        `SELECT id, data FROM documents WHERE collection = 'stores' AND company_id = $1 ORDER BY created_at`,
        [id]
      )
      const { rows: userRows } = await client.query(
        `SELECT id, data FROM documents WHERE collection = 'users' AND company_id = $1 ORDER BY created_at`,
        [id]
      )
      return { stores: storeRows, operationalUsers: userRows }
    })

    return NextResponse.json({
      company: { ...company, sunatConfigured: !!company.sunat_settings?.configured },
      members: members.map((m) => ({
        id: m.id,
        email: m.email,
        active: m.active,
        isPlatformOwner: m.is_platform_owner,
        storeId: m.store_id,
        created_at: m.created_at,
      })),
      stores: stores.map((s) => ({
        id: s.id,
        name: s.data?.name,
        code: s.data?.code,
        active: s.data?.active !== false,
      })),
      operationalUsers: operationalUsers.map((u) => ({
        id: u.id,
        name: u.data?.name,
        role: u.data?.role,
        storeId: u.data?.storeId || null,
        assignedStores: u.data?.assignedStores || [],
        pin: u.data?.pin,
        active: u.data?.active !== false,
      })),
    })
  })
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return runOwnerRoute(req, "companies/[id] PATCH", async () => {
    const { id } = await params
    const { name, plan, active, sunatSettings } = await req.json()

    const sets: string[] = []
    const values: any[] = []
    if (name !== undefined) {
      if (!String(name).trim()) throw new HttpError(400, "El nombre no puede quedar vacío")
      values.push(String(name).trim())
      sets.push(`name = $${values.length}`)
    }
    if (plan !== undefined) {
      values.push(plan)
      sets.push(`plan = $${values.length}`)
    }
    if (active !== undefined) {
      values.push(!!active)
      sets.push(`active = $${values.length}`)
    }
    if (sunatSettings !== undefined) {
      values.push(JSON.stringify(sunatSettings))
      sets.push(`sunat_settings = $${values.length}::jsonb`)
    }
    if (sets.length === 0) throw new HttpError(400, "Nada que actualizar")

    values.push(id)
    const { rowCount } = await getPool().query(
      `UPDATE companies SET ${sets.join(", ")} WHERE id = $${values.length}`,
      values
    )
    if (!rowCount) throw new HttpError(404, "Empresa no encontrada")
    return NextResponse.json({ ok: true })
  })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return runOwnerRoute(req, "companies/[id] DELETE", async () => {
    const { id } = await params
    const confirm = new URL(req.url).searchParams.get("confirm")

    const summary = await withPlatformOwnerScope(async (client) => {
      const { rows } = await client.query(`SELECT name FROM companies WHERE id = $1`, [id])
      if (!rows[0]) throw new HttpError(404, "Empresa no encontrada")
      if (!confirm || confirm.trim() !== rows[0].name) {
        throw new HttpError(400, "Para eliminar la empresa hay que escribir su nombre exacto")
      }

      const { rows: members } = await client.query<{ auth_account_id: string; is_platform_owner: boolean }>(
        `SELECT cm.auth_account_id, a.is_platform_owner
         FROM company_members cm JOIN auth_accounts a ON a.id = cm.auth_account_id
         WHERE cm.company_id = $1`,
        [id]
      )
      const removableAccountIds = members.filter((m) => !m.is_platform_owner).map((m) => m.auth_account_id)

      const docs = await client.query(`DELETE FROM documents WHERE company_id = $1`, [id])
      await client.query(`DELETE FROM company_members WHERE company_id = $1`, [id])
      if (removableAccountIds.length > 0) {
        await client.query(`DELETE FROM auth_accounts WHERE id = ANY($1::text[])`, [removableAccountIds])
      }
      await client.query(`DELETE FROM companies WHERE id = $1`, [id])

      return { deletedDocuments: docs.rowCount ?? 0, deletedAccounts: removableAccountIds.length }
    })

    return NextResponse.json({ ok: true, ...summary })
  })
}
