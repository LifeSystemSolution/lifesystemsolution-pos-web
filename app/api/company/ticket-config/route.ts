/**
 * app/api/company/ticket-config/route.ts
 * ---------------------------------------------------------------------------
 * GET: formato de impresión de la empresa de la sesión (solo lectura; lo
 * edita el dueño de la plataforma en /api/platform/companies/[id]). Siempre
 * devuelve una config completa: si la empresa no configuró nada, o la cuenta
 * no pertenece a ninguna (dueño de la plataforma), los valores por defecto.
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import { getPool } from "@/lib/local/pg-client"
import { verifySessionToken } from "@/lib/local/auth"
import { normalizeTicketConfig } from "@/lib/print/ticket-config"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null
  const session = token ? verifySessionToken(token) : null
  if (!session) {
    return NextResponse.json({ error: "Token inválido o expirado" }, { status: 401 })
  }

  try {
    const { rows } = await getPool().query<{ ticket_settings: unknown }>(
      `SELECT c.ticket_settings
       FROM company_members cm
       JOIN companies c ON c.id = cm.company_id
       WHERE cm.auth_account_id = $1`,
      [session.accountId]
    )
    return NextResponse.json(normalizeTicketConfig(rows[0]?.ticket_settings))
  } catch (err) {
    console.error("[api/company/ticket-config] Error:", err)
    return NextResponse.json({ error: "No se pudo leer la configuración de impresión" }, { status: 500 })
  }
}
