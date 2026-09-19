/**
 * app/api/platform/companies/[id]/members/route.ts
 * ---------------------------------------------------------------------------
 * Alta de cuentas de acceso (correo/contraseña) para una empresa existente.
 *   - sin storeId  → cuenta de EMPRESA (un Super Admin más);
 *   - con storeId  → cuenta de LOCAL: solo ve ese local (lo hace cumplir
 *                    app/api/db/route.ts), la usan los empleados del local
 *                    para entrar y luego colocar su PIN.
 * Modificar/eliminar una cuenta existente: members/[accountId]/route.ts.
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import { withPlatformOwnerScope } from "@/lib/local/pg-client"
import { runOwnerRoute, HttpError } from "@/lib/local/platform-auth"
import { createAccount } from "@/lib/local/platform-helpers"

export const runtime = "nodejs"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return runOwnerRoute(req, "members POST", async () => {
    const { id: companyId } = await params
    const { email, password, storeId } = await req.json()

    const created = await withPlatformOwnerScope(async (client) => {
      const { rows } = await client.query(`SELECT 1 FROM companies WHERE id = $1`, [companyId])
      if (rows.length === 0) throw new HttpError(404, "Empresa no encontrada")

      if (storeId) {
        const { rows: storeRows } = await client.query(
          `SELECT 1 FROM documents WHERE collection = 'stores' AND id = $1 AND company_id = $2`,
          [storeId, companyId]
        )
        if (storeRows.length === 0) throw new HttpError(400, "El local indicado no pertenece a esta empresa")
      }
      return createAccount(client, { companyId, email, password, storeId: storeId || null })
    })

    return NextResponse.json(created)
  })
}
