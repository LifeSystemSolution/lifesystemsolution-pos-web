/**
 * lib/local/platform-auth.ts
 * ---------------------------------------------------------------------------
 * Verificación compartida para las rutas app/api/platform/* — todas exigen
 * una sesión válida CON isPlatformOwner === true en el JWT (emitido en
 * app/api/auth/login a partir de auth_accounts.is_platform_owner). Ningún
 * usuario normal de una empresa puede llegar a tener ese claim.
 * ---------------------------------------------------------------------------
 */
import { NextRequest } from "next/server"
import { verifySessionToken, type SessionPayload } from "@/lib/local/auth"

export function getPlatformOwnerSession(req: NextRequest): SessionPayload | null {
  const authHeader = req.headers.get("authorization") || ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null
  if (!token) return null

  const session = verifySessionToken(token)
  if (!session || !session.isPlatformOwner) return null

  return session
}
