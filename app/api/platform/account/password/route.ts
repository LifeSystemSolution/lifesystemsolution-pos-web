/**
 * app/api/platform/account/password/route.ts
 * ---------------------------------------------------------------------------
 * POST { currentPassword, newPassword }: el dueño de la plataforma cambia SU
 * propia contraseña. Exige la actual (aunque haya sesión abierta: alguien que
 * encuentre la PC con la sesión iniciada no puede quedarse con la cuenta).
 * Solo actualiza la cuenta del token, nunca otra.
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import { getPool } from "@/lib/local/pg-client"
import { hashPassword, verifyPassword } from "@/lib/local/auth"
import { runOwnerRoute, HttpError } from "@/lib/local/platform-auth"
import { assertPassword } from "@/lib/local/platform-helpers"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  return runOwnerRoute(req, "account/password POST", async (session) => {
    const body = await req.json().catch(() => ({}))
    const currentPassword = String(body.currentPassword ?? "")
    const newPassword = assertPassword(body.newPassword)
    if (newPassword === currentPassword) {
      throw new HttpError(400, "La contraseña nueva tiene que ser distinta de la actual")
    }

    const { rows } = await getPool().query<{ password_hash: string }>(
      `SELECT password_hash FROM auth_accounts WHERE id = $1`,
      [session.accountId]
    )
    if (!rows[0] || !verifyPassword(currentPassword, rows[0].password_hash)) {
      throw new HttpError(400, "La contraseña actual no es correcta")
    }

    await getPool().query(`UPDATE auth_accounts SET password_hash = $2 WHERE id = $1`, [
      session.accountId,
      hashPassword(newPassword),
    ])
    return NextResponse.json({ ok: true })
  })
}
