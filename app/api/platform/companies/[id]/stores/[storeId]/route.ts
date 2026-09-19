/**
 * app/api/platform/companies/[id]/stores/[storeId]/route.ts
 * ---------------------------------------------------------------------------
 * PATCH: nombre / código / activo. Activar o desactivar un local arrastra a
 * sus cuentas de acceso (así el corte es inmediato: la cuenta desactivada no
 * pasa el chequeo por-request de /api/db ni el login).
 * DELETE: elimina el local con TODO lo suyo — pedidos, mesas, productos,
 *      inventario, cajas, usuarios, cuentas de acceso. Irreversible: exige
 *      `?confirm=<nombre exacto del local>`. Si querés conservar el
 *      historial, usá desactivar en vez de eliminar.
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import type { PoolClient } from "pg"
import { withPlatformOwnerScope } from "@/lib/local/pg-client"
import { runOwnerRoute, HttpError } from "@/lib/local/platform-auth"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string; storeId: string }> }

async function loadStore(client: PoolClient, companyId: string, storeId: string) {
  const { rows } = await client.query(
    `SELECT data FROM documents WHERE collection = 'stores' AND id = $1 AND company_id = $2`,
    [storeId, companyId]
  )
  if (!rows[0]) throw new HttpError(404, "Local no encontrado en esta empresa")
  return rows[0].data as { name: string; code: string; active?: boolean }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return runOwnerRoute(req, "stores/[storeId] PATCH", async () => {
    const { id: companyId, storeId } = await params
    const { name, code, active } = await req.json()

    await withPlatformOwnerScope(async (client) => {
      await loadStore(client, companyId, storeId)

      const patch: Record<string, unknown> = {}
      if (name !== undefined) {
        if (!String(name).trim()) throw new HttpError(400, "El nombre no puede quedar vacío")
        patch.name = String(name).trim()
      }
      if (code !== undefined) {
        if (!String(code).trim()) throw new HttpError(400, "El código no puede quedar vacío")
        patch.code = String(code).trim().toUpperCase()
      }
      if (active !== undefined) patch.active = !!active
      if (Object.keys(patch).length === 0) throw new HttpError(400, "Nada que actualizar")

      await client.query(
        `UPDATE documents SET data = data || $1::jsonb, updated_at = now()
         WHERE collection = 'stores' AND id = $2 AND company_id = $3`,
        [JSON.stringify(patch), storeId, companyId]
      )

      if (active !== undefined) {
        await client.query(
          `UPDATE auth_accounts SET active = $1
           WHERE is_platform_owner = false
             AND id IN (SELECT auth_account_id FROM company_members WHERE company_id = $2 AND store_id = $3)`,
          [!!active, companyId, storeId]
        )
      }
    })
    return NextResponse.json({ ok: true })
  })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return runOwnerRoute(req, "stores/[storeId] DELETE", async () => {
    const { id: companyId, storeId } = await params
    const confirm = new URL(req.url).searchParams.get("confirm")

    const summary = await withPlatformOwnerScope(async (client) => {
      const store = await loadStore(client, companyId, storeId)
      if (!confirm || confirm.trim() !== store.name) {
        throw new HttpError(400, "Para eliminar el local hay que escribir su nombre exacto")
      }

      // Cuentas de acceso del local (menos la del dueño de la plataforma, si
      // por algún motivo estuviera atada acá: solo se le suelta el local).
      const { rows: accounts } = await client.query<{ auth_account_id: string; is_platform_owner: boolean }>(
        `SELECT cm.auth_account_id, a.is_platform_owner
         FROM company_members cm JOIN auth_accounts a ON a.id = cm.auth_account_id
         WHERE cm.company_id = $1 AND cm.store_id = $2`,
        [companyId, storeId]
      )
      const removable = accounts.filter((a) => !a.is_platform_owner).map((a) => a.auth_account_id)

      // Todo documento del local: tiene data.storeId (pedidos, mesas,
      // productos, inventario, cajas, usuarios, clientes, comprobantes...) —
      // más el propio doc de la tienda, que no lo tiene.
      const docs = await client.query(
        `DELETE FROM documents
         WHERE company_id = $1 AND ((collection = 'stores' AND id = $2) OR data->>'storeId' = $2)`,
        [companyId, storeId]
      )

      // admin_global que tenían este local asignado: se les quita de la lista.
      await client.query(
        `UPDATE documents SET data = jsonb_set(data, '{assignedStores}', (data->'assignedStores') - $2::text), updated_at = now()
         WHERE company_id = $1 AND collection = 'users' AND data->'assignedStores' ? $2::text`,
        [companyId, storeId]
      )

      await client.query(`DELETE FROM company_members WHERE company_id = $1 AND store_id = $2 AND auth_account_id = ANY($3::text[])`, [
        companyId,
        storeId,
        removable,
      ])
      await client.query(`UPDATE company_members SET store_id = NULL WHERE company_id = $1 AND store_id = $2`, [companyId, storeId])
      if (removable.length > 0) {
        await client.query(`DELETE FROM auth_accounts WHERE id = ANY($1::text[])`, [removable])
      }

      return { deletedDocuments: docs.rowCount ?? 0, deletedAccounts: removable.length }
    })

    return NextResponse.json({ ok: true, ...summary })
  })
}
