/**
 * app/api/platform/companies/[id]/users/route.ts
 * ---------------------------------------------------------------------------
 * Alta de un usuario operativo (el perfil con PIN que ve cada empleado tras
 * entrar con la cuenta de su local). Crear usuarios es exclusivo del dueño de
 * la plataforma. El PIN se genera solo (o se elige uno) y es único dentro del
 * local — ver assertPinAvailable() en lib/local/platform-helpers.ts.
 * Editar/eliminar: users/[userId]/route.ts.
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import { withPlatformOwnerScope } from "@/lib/local/pg-client"
import { runOwnerRoute, HttpError } from "@/lib/local/platform-auth"
import {
  CROSS_STORE_ROLES,
  assertPinAvailable,
  assertPinFormat,
  assertStoresBelong,
  assertRole,
  generateUniquePin,
  genSuffix,
} from "@/lib/local/platform-helpers"

export const runtime = "nodejs"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return runOwnerRoute(req, "users POST", async () => {
    const { id: companyId } = await params
    const body = await req.json()

    const name = String(body.name ?? "").trim()
    if (!name) throw new HttpError(400, "El nombre es requerido")
    const role = assertRole(body.role)
    const cross = CROSS_STORE_ROLES.has(role)
    const storeId: string | undefined = cross ? undefined : body.storeId
    if (!cross && !storeId) throw new HttpError(400, "Este rol requiere un local")
    const assignedStores: string[] = role === "admin_global" && Array.isArray(body.assignedStores) ? body.assignedStores : []

    const created = await withPlatformOwnerScope(async (client) => {
      const { rows } = await client.query(`SELECT 1 FROM companies WHERE id = $1`, [companyId])
      if (rows.length === 0) throw new HttpError(404, "Empresa no encontrada")
      await assertStoresBelong(client, companyId, [...(storeId ? [storeId] : []), ...assignedStores])

      let pin: string
      if (body.pin !== undefined && body.pin !== "") {
        pin = assertPinFormat(body.pin)
        await assertPinAvailable(client, companyId, pin, { role, storeId })
      } else {
        pin = await generateUniquePin(client, companyId, { role, storeId })
      }

      const userId = `user_${genSuffix()}`
      await client.query(
        `INSERT INTO documents (collection, id, company_id, data) VALUES ('users', $1, $2, $3::jsonb)`,
        [
          userId,
          companyId,
          JSON.stringify({
            name,
            pin,
            role,
            // Convención existente: los roles que cruzan locales llevan storeId vacío.
            storeId: storeId ?? "",
            ...(role === "admin_global" ? { assignedStores } : {}),
            active: true,
          }),
        ]
      )
      return { userId, pin }
    })

    return NextResponse.json(created)
  })
}
