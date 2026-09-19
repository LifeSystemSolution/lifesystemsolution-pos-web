/**
 * app/api/platform/companies/[id]/stores/route.ts
 * ---------------------------------------------------------------------------
 * Agrega un LOCAL a una empresa ya existente — siempre junto con SU cuenta
 * de acceso (la que usarán los empleados del local: entran con ella y luego
 * con su PIN). Crear tiendas es exclusivo del dueño de la plataforma
 * (lib/local/db-access-policy.ts lo hace cumplir también en /api/db).
 * Editar/desactivar/eliminar: stores/[storeId]/route.ts.
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import { withPlatformOwnerScope } from "@/lib/local/pg-client"
import { runOwnerRoute, HttpError } from "@/lib/local/platform-auth"
import { createStoreWithAccount } from "@/lib/local/platform-helpers"

export const runtime = "nodejs"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return runOwnerRoute(req, "stores POST", async () => {
    const { id: companyId } = await params
    const { name, code, accountEmail, accountPassword } = await req.json()

    const created = await withPlatformOwnerScope(async (client) => {
      const { rows } = await client.query(`SELECT 1 FROM companies WHERE id = $1`, [companyId])
      if (rows.length === 0) throw new HttpError(404, "Empresa no encontrada")
      return createStoreWithAccount(client, { companyId, name, code, accountEmail, accountPassword })
    })

    return NextResponse.json(created)
  })
}
