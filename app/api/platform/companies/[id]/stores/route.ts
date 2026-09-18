/**
 * app/api/platform/companies/[id]/stores/route.ts
 * ---------------------------------------------------------------------------
 * Agrega una tienda nueva a una empresa YA existente. Crear tiendas es
 * exclusivo del dueño de la plataforma (ver app/api/db/route.ts, que
 * rechaza addDoc de "stores" para cualquiera que no sea isPlatformOwner) —
 * esta ruta es el único camino real para hacerlo.
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import { withPlatformOwnerScope } from "@/lib/local/pg-client"
import { getPlatformOwnerSession } from "@/lib/local/platform-auth"
import { seedNewStore } from "@/lib/local/platform-store-seed"

export const runtime = "nodejs"

function genSuffix() {
  return Math.random().toString(36).slice(2, 8)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!getPlatformOwnerSession(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }
  const { id: companyId } = await params

  try {
    const body = await req.json()
    const { name, code } = body
    if (!name?.trim() || !code?.trim()) {
      return NextResponse.json({ error: "name y code son requeridos" }, { status: 400 })
    }

    const storeId = `store_${genSuffix()}`

    await withPlatformOwnerScope(async (client) => {
      await client.query(
        `INSERT INTO documents (collection, id, company_id, data)
         VALUES ('stores', $1, $2, $3::jsonb)`,
        [
          storeId,
          companyId,
          JSON.stringify({
            name: name.trim(),
            code: code.trim().toUpperCase(),
            active: true,
            createdAt: new Date().toISOString(),
          }),
        ]
      )
      await seedNewStore(client, companyId, storeId)
    })

    return NextResponse.json({ storeId })
  } catch (err: any) {
    console.error("[api/platform/companies/[id]/stores POST] Error:", err)
    return NextResponse.json({ error: err?.message || "Error del servidor" }, { status: 500 })
  }
}
