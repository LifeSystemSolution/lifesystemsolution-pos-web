/**
 * app/api/platform/companies/[id]/users/route.ts
 * ---------------------------------------------------------------------------
 * Agrega un usuario operativo (PIN) nuevo a una empresa existente. Crear
 * usuarios operativos es exclusivo del dueño de la plataforma — ver
 * app/api/db/route.ts, que rechaza addDoc de "users" para cualquiera que no
 * sea isPlatformOwner. Esta ruta es el único camino real para hacerlo; desde
 * el /admin de cada empresa solo se pueden editar/desactivar los existentes.
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import { withPlatformOwnerScope } from "@/lib/local/pg-client"
import { getPlatformOwnerSession } from "@/lib/local/platform-auth"

export const runtime = "nodejs"

function genSuffix() {
  return Math.random().toString(36).slice(2, 8)
}

function genPin() {
  return String(Math.floor(1000 + Math.random() * 9000))
}

const VALID_ROLES = ["super_admin", "admin", "admin_global", "cajero", "mesero", "cocina"]

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!getPlatformOwnerSession(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }
  const { id: companyId } = await params

  try {
    const body = await req.json()
    const { name, role, storeId } = body

    if (!name?.trim() || !role) {
      return NextResponse.json({ error: "name y role son requeridos" }, { status: 400 })
    }
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: "Rol inválido" }, { status: 400 })
    }
    if (role !== "super_admin" && role !== "admin_global" && !storeId) {
      return NextResponse.json({ error: "Este rol requiere una tienda" }, { status: 400 })
    }

    const userId = `user_${genSuffix()}`
    const pin = genPin()

    await withPlatformOwnerScope(async (client) => {
      // Si la tienda viene indicada, confirmar que es de esta empresa —
      // evita que una tienda de otra empresa quede referenciada por error.
      if (storeId) {
        const { rows } = await client.query(
          `SELECT id FROM documents WHERE collection = 'stores' AND id = $1 AND company_id = $2`,
          [storeId, companyId]
        )
        if (rows.length === 0) {
          throw new Error("La tienda indicada no pertenece a esta empresa")
        }
      }

      await client.query(
        `INSERT INTO documents (collection, id, company_id, data)
         VALUES ('users', $1, $2, $3::jsonb)`,
        [
          userId,
          companyId,
          JSON.stringify({
            name: name.trim(),
            pin,
            role,
            storeId: storeId || undefined,
            active: true,
          }),
        ]
      )
    })

    return NextResponse.json({ userId, pin })
  } catch (err: any) {
    console.error("[api/platform/companies/[id]/users POST] Error:", err)
    return NextResponse.json({ error: err?.message || "Error del servidor" }, { status: 500 })
  }
}
