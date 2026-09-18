/**
 * lib/local/platform-client.ts
 * ---------------------------------------------------------------------------
 * Helper de fetch para las páginas de /plataforma — mismo patrón de
 * Authorization: Bearer que el shim de Firestore (lib/local/firebase-shim),
 * pero apuntando a /api/platform/* en vez de /api/db.
 * ---------------------------------------------------------------------------
 */
import { getStoredSession } from "@/lib/local/session"

export async function platformFetch(path: string, options: RequestInit = {}) {
  const session = getStoredSession()
  if (!session) throw new Error("No hay sesión activa")

  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
      ...(options.headers || {}),
    },
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(json.error || `Error del servidor (${res.status})`)
  }
  return json
}
