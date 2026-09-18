/**
 * app/api/auth/login/route.ts
 * ---------------------------------------------------------------------------
 * Paso 1 del login (correo/contraseña) — reemplaza a Firebase Auth por
 * completo. Verifica contra auth_accounts (scrypt) y devuelve un JWT propio
 * que el navegador guarda y manda como Authorization: Bearer en cada
 * request a /api/db y /api/realtime.
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import { getPool } from "@/lib/local/pg-client"
import { verifyPassword, issueSessionToken } from "@/lib/local/auth"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()
  if (!email || !password) {
    return NextResponse.json({ error: "Faltan correo y/o contraseña" }, { status: 400 })
  }

  const { rows } = await getPool().query<{ id: string; email: string; password_hash: string; is_platform_owner: boolean }>(
    `SELECT id, email, password_hash, is_platform_owner FROM auth_accounts WHERE email = $1`,
    [String(email).toLowerCase().trim()]
  )
  const account = rows[0]

  // Mismo mensaje genérico exista o no la cuenta — no revelar cuál de los dos falló.
  if (!account || !verifyPassword(password, account.password_hash)) {
    return NextResponse.json({ error: "Correo o contraseña incorrectos" }, { status: 401 })
  }

  const token = issueSessionToken({
    accountId: account.id,
    email: account.email,
    isPlatformOwner: account.is_platform_owner,
  })
  return NextResponse.json({
    token,
    accountId: account.id,
    email: account.email,
    isPlatformOwner: account.is_platform_owner,
  })
}
