"use client"
/**
 * lib/hooks/use-ticket-config.ts
 * ---------------------------------------------------------------------------
 * Formato de impresión de la empresa de la sesión (GET /api/company/ticket-config).
 * Se pide una vez por sesión y se comparte entre pantallas; mientras carga (o
 * si falla) devuelve los valores por defecto, así imprimir nunca se bloquea.
 * Se vuelve a pedir al recuperar el foco de la pestaña, para tomar cambios
 * hechos desde /plataforma sin recargar.
 * ---------------------------------------------------------------------------
 */
import { useEffect, useState } from "react"
import { getStoredSession } from "@/lib/local/session"
import { DEFAULT_TICKET_CONFIG, normalizeTicketConfig, type TicketConfig } from "@/lib/print/ticket-config"

let cached: { token: string; config: TicketConfig } | null = null
let inFlight: { token: string; promise: Promise<TicketConfig> } | null = null
const REFRESH_MIN_MS = 60_000
let lastFetchAt = 0

function fetchConfig(token: string): Promise<TicketConfig> {
  if (inFlight?.token === token) return inFlight.promise
  const promise = fetch("/api/company/ticket-config", { headers: { Authorization: `Bearer ${token}` } })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((json) => {
      const config = normalizeTicketConfig(json)
      cached = { token, config }
      lastFetchAt = Date.now()
      return config
    })
    .finally(() => {
      if (inFlight?.promise === promise) inFlight = null
    })
  inFlight = { token, promise }
  return promise
}

export function useTicketConfig(): TicketConfig {
  const token = typeof window !== "undefined" ? getStoredSession()?.token ?? null : null
  const [config, setConfig] = useState<TicketConfig>(
    cached && cached.token === token ? cached.config : DEFAULT_TICKET_CONFIG
  )

  useEffect(() => {
    if (!token) return
    let alive = true
    const load = () => {
      fetchConfig(token)
        .then((c) => alive && setConfig(c))
        .catch((err) => console.warn("[ticket-config] Se usan valores por defecto:", err))
    }
    if (!cached || cached.token !== token) load()
    const onFocus = () => {
      if (Date.now() - lastFetchAt > REFRESH_MIN_MS) load()
    }
    window.addEventListener("focus", onFocus)
    return () => {
      alive = false
      window.removeEventListener("focus", onFocus)
    }
  }, [token])

  return config
}
