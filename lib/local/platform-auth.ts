/**
 * lib/local/platform-auth.ts
 * ---------------------------------------------------------------------------
 * Verificación compartida para las rutas app/api/platform/* — todas exigen
 * una sesión válida CON isPlatformOwner === true en el JWT (emitido en
 * app/api/auth/login a partir de auth_accounts.is_platform_owner). Ningún
 * usuario normal de una empresa puede llegar a tener ese claim.
 *
 * runOwnerRoute() envuelve cada handler: verifica al dueño, y traduce los
 * errores esperados (HttpError, correo duplicado) a respuestas limpias en vez
 * de un 500 genérico.
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import { verifySessionToken, type SessionPayload } from "@/lib/local/auth"

export function getPlatformOwnerSession(req: NextRequest): SessionPayload | null {
  const authHeader = req.headers.get("authorization") || ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null
  if (!token) return null

  const session = verifySessionToken(token)
  if (!session || !session.isPlatformOwner) return null

  return session
}

/** Error con código HTTP para devolver un mensaje claro al panel de plataforma. */
export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function runOwnerRoute(
  req: NextRequest,
  tag: string,
  fn: (session: SessionPayload) => Promise<NextResponse>
): Promise<NextResponse> {
  const session = getPlatformOwnerSession(req)
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }
  try {
    return await fn(session)
  } catch (err: any) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    // Violación de UNIQUE en auth_accounts.email
    if (err?.code === "23505") {
      return NextResponse.json({ error: "Ya existe una cuenta con ese correo" }, { status: 409 })
    }
    console.error(`[api/platform ${tag}] Error:`, err)
    return NextResponse.json({ error: err?.message || "Error del servidor" }, { status: 500 })
  }
}
