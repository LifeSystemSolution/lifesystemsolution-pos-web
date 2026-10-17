/**
 * app/api/company/settings/route.ts
 * ---------------------------------------------------------------------------
 * GET: rubro (business_type) de la empresa de la sesión, para que el POS sepa
 * qué funciones usar (lib/business/profiles.ts). Solo lectura: lo cambia el
 * dueño de la plataforma en /api/platform/companies/[id]. Sin empresa (dueño
 * de la plataforma) → rubro por defecto.
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import { getPool } from "@/lib/local/pg-client"
import { verifySessionToken } from "@/lib/local/auth"
import { featuresFor, normalizeBusinessType } from "@/lib/business/profiles"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null
  const session = token ? verifySessionToken(token) : null
  if (!session) {
    return NextResponse.json({ error: "Token inválido o expirado" }, { status: 401 })
  }
  try {
    const { rows } = await getPool().query<{ business_type: string | null }>(
      `SELECT c.business_type
       FROM company_members cm JOIN companies c ON c.id = cm.company_id
       WHERE cm.auth_account_id = $1`,
      [session.accountId]
    )
    const businessType = normalizeBusinessType(rows[0]?.business_type)
    // Boleta/factura solo se pueden emitir si la API de facturación está
    // configurada en el servidor (las mismas variables que usa /api/facturacion).
    const sunatConfigured = Boolean(
      process.env.SUNAT_API_BASE_URL && process.env.SUNAT_API_KEY && process.env.SUNAT_API_SECRET
    )
    return NextResponse.json({ businessType, features: featuresFor(businessType), sunatConfigured })
  } catch (err) {
    console.error("[api/company/settings] Error:", err)
    return NextResponse.json({ error: "No se pudo leer la configuración de la empresa" }, { status: 500 })
  }
}
