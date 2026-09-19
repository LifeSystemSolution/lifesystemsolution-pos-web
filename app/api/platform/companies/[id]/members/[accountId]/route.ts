/**
 * app/api/platform/companies/[id]/members/[accountId]/route.ts
 * ---------------------------------------------------------------------------
 * PATCH: activar/desactivar la cuenta (corta el acceso de inmediato, se
 *        chequea en cada request), cambiar su contraseña, o re-asignarla a
 *        otro local / a nivel empresa (storeId: null).
 * DELETE: eliminar la cuenta de acceso.
 *
 * Nunca se puede tocar la cuenta del dueño de la plataforma ni la propia
 * (evita dejarse afuera por accidente).
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import { withPlatformOwnerScope } from "@/lib/local/pg-client"
import { runOwnerRoute, HttpError } from "@/lib/local/platform-auth"
import { hashPassword } from "@/lib/local/auth"
import { assertPassword, loadManageableAccount } from "@/lib/local/platform-helpers"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string; accountId: string }> }

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return runOwnerRoute(req, "members/[accountId] PATCH", async (session) => {
    const { id: companyId, accountId } = await params
    const body = await req.json()

    await withPlatformOwnerScope(async (client) => {
      await loadManageableAccount(client, companyId, accountId, session.accountId)

      if (body.active !== undefined) {
        await client.query(`UPDATE auth_accounts SET active = $1 WHERE id = $2`, [!!body.active, accountId])
      }
      if (body.password !== undefined) {
        await client.query(`UPDATE auth_accounts SET password_hash = $1 WHERE id = $2`, [
          hashPassword(assertPassword(body.password)),
          accountId,
        ])
      }
      if ("storeId" in body) {
        if (body.storeId) {
          const { rows } = await client.query(
            `SELECT 1 FROM documents WHERE collection = 'stores' AND id = $1 AND company_id = $2`,
            [body.storeId, companyId]
          )
          if (rows.length === 0) throw new HttpError(400, "El local indicado no pertenece a esta empresa")
        }
        await client.query(`UPDATE company_members SET store_id = $1 WHERE auth_account_id = $2`, [
          body.storeId || null,
          accountId,
        ])
      }
    })
    return NextResponse.json({ ok: true })
  })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return runOwnerRoute(req, "members/[accountId] DELETE", async (session) => {
    const { id: companyId, accountId } = await params

    await withPlatformOwnerScope(async (client) => {
      await loadManageableAccount(client, companyId, accountId, session.accountId)
      await client.query(`DELETE FROM company_members WHERE auth_account_id = $1 AND company_id = $2`, [
        accountId,
        companyId,
      ])
      await client.query(`DELETE FROM auth_accounts WHERE id = $1`, [accountId])
    })
    return NextResponse.json({ ok: true })
  })
}
