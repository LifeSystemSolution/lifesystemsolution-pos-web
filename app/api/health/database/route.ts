import { NextResponse } from "next/server"
import { getPool } from "@/lib/local/pg-client"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Comprobación segura para el despliegue: no revela URLs, usuarios ni errores
 * de Postgres. Vercel puede consultar esta ruta después de configurar las
 * variables para verificar que la función realmente llega a Supabase.
 */
export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ ok: false, database: "not_configured" }, { status: 503 })
  }

  try {
    await getPool().query("SELECT 1")
    return NextResponse.json({ ok: true, database: "connected" })
  } catch (error) {
    console.error("[health/database] Database connectivity check failed", error)
    return NextResponse.json({ ok: false, database: "unavailable" }, { status: 503 })
  }
}
