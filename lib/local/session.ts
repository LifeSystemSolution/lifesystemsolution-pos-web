/**
 * lib/local/session.ts
 * ---------------------------------------------------------------------------
 * Guarda el token de sesión (emitido por app/api/auth/login) en el
 * navegador. Reemplaza la persistencia que traía el SDK de Firebase Auth
 * (browserLocalPersistence) — mismo lugar, localStorage, mucho más simple
 * porque acá el token es nuestro.
 * ---------------------------------------------------------------------------
 */
const STORAGE_KEY = "lss_session"

export type StoredSession = {
  token: string
  accountId: string
  email: string
  isPlatformOwner?: boolean
  // Local al que está atada la cuenta (null/undefined = cuenta de empresa).
  // Solo es una pista para la UI — el servidor es quien realmente lo hace
  // cumplir en cada request (lib/local/db-access-policy.ts).
  storeId?: string | null
}

export function getStoredSession(): StoredSession | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    return null
  }
}

export function setStoredSession(session: StoredSession) {
  if (typeof window === "undefined") return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function clearStoredSession() {
  if (typeof window === "undefined") return
  localStorage.removeItem(STORAGE_KEY)
}
