/**
 * app/api/platform/companies/[id]/users/[userId]/route.ts
 * ---------------------------------------------------------------------------
 * PATCH: nombre, rol, local, PIN (manual o `regeneratePin: true`), activo,
 *        locales asignados (admin_global). Se revalida todo el estado
 *        resultante (rol ↔ local, PIN único) antes de guardar.
 * DELETE: elimina el usuario. Los pedidos que atendió conservan su
 *        userId/userName como historial.
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import { withPlatformOwnerScope } from "@/lib/local/pg-client"
import { runOwnerRoute, HttpError } from "@/lib/local/platform-auth"
import {
  CROSS_STORE_ROLES,
  assertPinAvailable,
  assertPinFormat,
  assertRole,
  assertStoresBelong,
  generateUniquePin,
} from "@/lib/local/platform-helpers"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string; userId: string }> }

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return runOwnerRoute(req, "users/[userId] PATCH", async () => {
    const { id: companyId, userId } = await params
    const body = await req.json()

    const result = await withPlatformOwnerScope(async (client) => {
      const { rows } = await client.query(
        `SELECT data FROM documents WHERE collection = 'users' AND id = $1 AND company_id = $2`,
        [userId, companyId]
      )
      if (!rows[0]) throw new HttpError(404, "Usuario no encontrado en esta empresa")
      const current = rows[0].data as {
        name: string
        pin: string
        role: string
        storeId?: string
        assignedStores?: string[]
        active?: boolean
      }

      // Estado resultante.
      const role = body.role !== undefined ? assertRole(body.role) : current.role
      const cross = CROSS_STORE_ROLES.has(role)
      const storeId = cross ? "" : body.storeId !== undefined ? body.storeId : current.storeId || ""
      if (!cross && !storeId) throw new HttpError(400, "Este rol requiere un local")
      const assignedStores =
        role === "admin_global"
          ? Array.isArray(body.assignedStores)
            ? body.assignedStores
            : current.assignedStores || []
          : undefined

      await assertStoresBelong(client, companyId, [...(storeId ? [storeId] : []), ...(assignedStores || [])])

      // PIN: nuevo manual, regenerado, o el actual — pero siempre revalidado
      // porque un cambio de rol/local puede volverlo conflictivo.
      let pin = current.pin
      let regenerated = false
      if (body.regeneratePin) {
        pin = await generateUniquePin(client, companyId, { role, storeId, excludeUserId: userId })
        regenerated = true
      } else if (body.pin !== undefined && body.pin !== "") {
        pin = assertPinFormat(body.pin)
      }
      await assertPinAvailable(client, companyId, pin, { role, storeId, excludeUserId: userId })

      const name = body.name !== undefined ? String(body.name).trim() : current.name
      if (!name) throw new HttpError(400, "El nombre no puede quedar vacío")

      const patch: Record<string, unknown> = {
        name,
        pin,
        role,
        storeId,
        active: body.active !== undefined ? !!body.active : current.active !== false,
      }
      if (assignedStores !== undefined) patch.assignedStores = assignedStores

      await client.query(
        `UPDATE documents SET data = data || $1::jsonb, updated_at = now()
         WHERE collection = 'users' AND id = $2 AND company_id = $3`,
        [JSON.stringify(patch), userId, companyId]
      )
      return { pin, regenerated }
    })

    return NextResponse.json({ ok: true, ...result })
  })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return runOwnerRoute(req, "users/[userId] DELETE", async () => {
    const { id: companyId, userId } = await params
    const removed = await withPlatformOwnerScope(async (client) => {
      const r = await client.query(
        `DELETE FROM documents WHERE collection = 'users' AND id = $1 AND company_id = $2`,
        [userId, companyId]
      )
      return r.rowCount ?? 0
    })
    if (!removed) throw new HttpError(404, "Usuario no encontrado en esta empresa")
    return NextResponse.json({ ok: true })
  })
}
