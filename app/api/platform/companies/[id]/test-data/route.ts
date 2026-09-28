/**
 * app/api/platform/companies/[id]/test-data/route.ts
 * ---------------------------------------------------------------------------
 * "Borrar datos de prueba" (solo dueño de la plataforma). Ver
 * lib/local/test-data-reset.ts para qué se borra y qué se conserva.
 *
 * GET  ?storeId=<id>  → vista previa: cuántos registros se borrarían.
 *                       Sin storeId = toda la empresa.
 * POST { storeId?, confirm, restoreStock? } → ejecuta. `confirm` tiene que
 *      ser el nombre EXACTO del local (o de la empresa si no hay storeId):
 *      misma barrera que el borrado de empresa, verificada acá.
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import type { PoolClient } from "pg"
import { withPlatformOwnerScope } from "@/lib/local/pg-client"
import { runOwnerRoute, HttpError } from "@/lib/local/platform-auth"
import { previewTestData, resetTestData } from "@/lib/local/test-data-reset"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string }> }

/** Valida empresa (y local si viene) y devuelve el nombre que hay que escribir para confirmar. */
async function resolveScope(client: PoolClient, companyId: string, storeId: string | null) {
  const { rows } = await client.query<{ name: string }>(`SELECT name FROM companies WHERE id = $1`, [companyId])
  if (!rows[0]) throw new HttpError(404, "Empresa no encontrada")
  if (!storeId) return { confirmName: rows[0].name }
  const { rows: stores } = await client.query<{ name: string }>(
    `SELECT data->>'name' AS name FROM documents WHERE company_id = $1 AND collection = 'stores' AND id = $2`,
    [companyId, storeId]
  )
  if (!stores[0]) throw new HttpError(404, "El local no pertenece a esta empresa")
  return { confirmName: stores[0].name }
}

export async function GET(req: NextRequest, { params }: Ctx) {
  return runOwnerRoute(req, "test-data GET", async () => {
    const { id } = await params
    const storeId = new URL(req.url).searchParams.get("storeId") || null
    const result = await withPlatformOwnerScope(async (client) => {
      const { confirmName } = await resolveScope(client, id, storeId)
      return { confirmName, ...(await previewTestData(client, { companyId: id, storeId })) }
    })
    return NextResponse.json(result)
  })
}

export async function POST(req: NextRequest, { params }: Ctx) {
  return runOwnerRoute(req, "test-data POST", async () => {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const storeId = typeof body.storeId === "string" && body.storeId ? body.storeId : null
    const restoreStock = body.restoreStock !== false

    const summary = await withPlatformOwnerScope(async (client) => {
      const { confirmName } = await resolveScope(client, id, storeId)
      if (String(body.confirm ?? "").trim() !== confirmName) {
        throw new HttpError(400, `Para confirmar hay que escribir exactamente: ${confirmName}`)
      }
      return resetTestData(client, { companyId: id, storeId }, { restoreStock })
    })
    return NextResponse.json({ ok: true, ...summary })
  })
}
