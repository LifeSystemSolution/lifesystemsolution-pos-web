/**
 * app/api/platform/companies/[id]/members/route.ts
 * ---------------------------------------------------------------------------
 * Cuentas de login (correo/contraseña) adicionales para una empresa ya
 * existente — ej. un segundo admin, o el dueño de otra sede que necesita su
 * propio acceso. Una cuenta siempre pertenece a una sola empresa (ver
 * db/schema.sql, comentario en company_members).
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import { getPool } from "@/lib/local/pg-client"
import { getPlatformOwnerSession } from "@/lib/local/platform-auth"
import { hashPassword } from "@/lib/local/auth"

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
    const { email, password } = body
    if (!email?.trim() || !password?.trim()) {
      return NextResponse.json({ error: "email y password son requeridos" }, { status: 400 })
    }
    if (String(password).length < 8) {
      return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 })
    }

    const normalizedEmail = String(email).toLowerCase().trim()
    const { rows: companyRows } = await getPool().query(`SELECT id FROM companies WHERE id = $1`, [companyId])
    if (companyRows.length === 0) {
      return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 })
    }

    const { rows: existing } = await getPool().query(`SELECT id FROM auth_accounts WHERE email = $1`, [normalizedEmail])
    if (existing.length > 0) {
      return NextResponse.json({ error: "Ya existe una cuenta con ese correo" }, { status: 409 })
    }

    const accountId = `acc_${genSuffix()}`
    const passwordHash = hashPassword(password)

    const pool = getPool()
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      await client.query(`INSERT INTO auth_accounts (id, email, password_hash) VALUES ($1, $2, $3)`, [
        accountId,
        normalizedEmail,
        passwordHash,
      ])
      await client.query(
        `INSERT INTO company_members (auth_account_id, company_id, email) VALUES ($1, $2, $3)`,
        [accountId, companyId, normalizedEmail]
      )
      await client.query("COMMIT")
    } catch (err) {
      await client.query("ROLLBACK")
      throw err
    } finally {
      client.release()
    }

    return NextResponse.json({ accountId, email: normalizedEmail })
  } catch (err: any) {
    console.error("[api/platform/companies/[id]/members POST] Error:", err)
    return NextResponse.json({ error: err?.message || "Error del servidor" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!getPlatformOwnerSession(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }
  const { id: companyId } = await params

  try {
    const { searchParams } = new URL(req.url)
    const accountId = searchParams.get("accountId")
    if (!accountId) {
      return NextResponse.json({ error: "Falta accountId" }, { status: 400 })
    }

    const pool = getPool()
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      await client.query(
        `DELETE FROM company_members WHERE auth_account_id = $1 AND company_id = $2`,
        [accountId, companyId]
      )
      await client.query(`DELETE FROM auth_accounts WHERE id = $1`, [accountId])
      await client.query("COMMIT")
    } catch (err) {
      await client.query("ROLLBACK")
      throw err
    } finally {
      client.release()
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error("[api/platform/companies/[id]/members DELETE] Error:", err)
    return NextResponse.json({ error: err?.message || "Error del servidor" }, { status: 500 })
  }
}
