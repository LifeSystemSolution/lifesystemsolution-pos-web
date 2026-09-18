/**
 * lib/local/auth.ts
 * ---------------------------------------------------------------------------
 * Hash de contraseñas (scrypt vía node:crypto, sin dependencias nativas) +
 * emisión/verificación de los tokens de sesión propios. Reemplaza a Firebase
 * Auth — mismo esquema de hash que usaba lifesystem-pos-desktop en
 * lib/local/pg-client.ts (hashPassword/verifyPassword).
 *
 * SOLO server-side (Route Handlers) — nunca importar desde "use client".
 * ---------------------------------------------------------------------------
 */
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto"
import jwt from "jsonwebtoken"

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(password, salt, 64).toString("hex")
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":")
  if (!salt || !hash) return false
  const hashBuffer = Buffer.from(hash, "hex")
  const candidate = scryptSync(password, salt, hashBuffer.length)
  return hashBuffer.length === candidate.length && timingSafeEqual(hashBuffer, candidate)
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 días

function getJwtSecret(): string {
  const secret = process.env.AUTH_JWT_SECRET
  if (!secret) throw new Error("Falta AUTH_JWT_SECRET en el entorno (ver .env.example)")
  return secret
}

export type SessionPayload = { accountId: string; email: string; isPlatformOwner?: boolean }

/** Emite el token de sesión que el navegador guarda y manda en cada request (Authorization: Bearer). */
export function issueSessionToken(payload: SessionPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: SESSION_TTL_SECONDS })
}

/** Verifica el token de sesión. Devuelve el payload o null si es inválido/expiró. */
export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret())
    if (typeof decoded === "string") return null
    return { accountId: decoded.accountId, email: decoded.email, isPlatformOwner: !!decoded.isPlatformOwner }
  } catch {
    return null
  }
}
