/**
 * app/api/auth/login/route.ts
 * ---------------------------------------------------------------------------
 * Paso 1 del login (correo/contraseña) — reemplaza a Firebase Auth por
 * completo. Verifica contra auth_accounts (scrypt) y devuelve un JWT propio
 * que el navegador guarda y manda como Authorization: Bearer en cada
 * request a /api/db.
 *
 * Además de la contraseña, se rechaza el login si la cuenta o su empresa
 * fueron desactivadas desde /plataforma (el dueño de la plataforma nunca
 * queda afuera por esto). Y se devuelve a qué LOCAL está atada la cuenta
 * (null = cuenta de empresa / Super Admin) para que el login sepa si mostrar
 * la pantalla de PIN de un solo local o la de Super Admin.
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

  const { rows } = await getPool().query<{
    id: string
    email: string
    password_hash: string
    is_platform_owner: boolean
    account_active: boolean
    company_active: boolean | null
    store_id: string | null
  }>(
    `SELECT a.id, a.email, a.password_hash, a.is_platform_owner, a.active AS account_active,
            c.active AS company_active, cm.store_id
     FROM auth_accounts a
     LEFT JOIN company_members cm ON cm.auth_account_id = a.id
     LEFT JOIN companies c ON c.id = cm.company_id
     WHERE a.email = $1`,
    [String(email).toLowerCase().trim()]
  )
  const account = rows[0]

  // Mismo mensaje genérico exista o no la cuenta — no revelar cuál de los dos falló.
  if (!account || !verifyPassword(password, account.password_hash)) {
    return NextResponse.json({ error: "Correo o contraseña incorrectos" }, { status: 401 })
  }

  // Ya con la contraseña correcta, sí se puede decir por qué no entra.
  if (!account.is_platform_owner) {
    if (!account.account_active) {
      return NextResponse.json(
        { error: "Esta cuenta está desactivada. Contacta al administrador de la plataforma." },
        { status: 403 }
      )
    }
    if (account.company_active === false) {
      return NextResponse.json(
        { error: "Esta empresa está desactivada. Contacta al administrador de la plataforma." },
        { status: 403 }
      )
    }
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
    storeId: account.store_id,
  })
}
