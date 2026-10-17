"use client"
/**
 * lib/business/client.ts
 * ---------------------------------------------------------------------------
 * Rubro y funciones de la empresa de la sesión, en el navegador.
 *
 *  - getBusinessSettings(): promesa cacheada por sesión. La usan las
 *    transacciones (lib/firebase/firestore.ts) — esperan el dato real antes
 *    de decidir si descontar stock o exigir "entregado".
 *  - useBusinessFeatures(): para las pantallas. Mientras carga devuelve las
 *    funciones del rubro "completo" (el comportamiento de siempre).
 * ---------------------------------------------------------------------------
 */
import { useEffect, useState } from "react"
import { getStoredSession } from "@/lib/local/session"
import {
  DEFAULT_BUSINESS_TYPE,
  featuresFor,
  normalizeBusinessType,
  type BusinessFeatures,
  type BusinessType,
} from "@/lib/business/profiles"

export type BusinessSettings = { businessType: BusinessType; features: BusinessFeatures }

const DEFAULT_SETTINGS: BusinessSettings = {
  businessType: DEFAULT_BUSINESS_TYPE,
  features: featuresFor(DEFAULT_BUSINESS_TYPE),
}

let cache: { token: string; promise: Promise<BusinessSettings> } | null = null

export function getBusinessSettings(): Promise<BusinessSettings> {
  const token = typeof window !== "undefined" ? getStoredSession()?.token : undefined
  if (!token) return Promise.resolve(DEFAULT_SETTINGS)
  if (cache?.token === token) return cache.promise
  const promise = fetch("/api/company/settings", { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((json) => {
      const businessType = normalizeBusinessType(json?.businessType)
      return { businessType, features: featuresFor(businessType) }
    })
    .catch((err) => {
      console.warn("[business] No se pudo leer el rubro; se usa el completo:", err)
      if (cache?.promise === promise) cache = null // reintentar la próxima vez
      return DEFAULT_SETTINGS
    })
  cache = { token, promise }
  return promise
}

export function useBusinessSettings(): BusinessSettings & { loaded: boolean } {
  const [state, setState] = useState<BusinessSettings & { loaded: boolean }>({ ...DEFAULT_SETTINGS, loaded: false })
  const token = typeof window !== "undefined" ? getStoredSession()?.token ?? null : null
  useEffect(() => {
    let alive = true
    getBusinessSettings().then((s) => alive && setState({ ...s, loaded: true }))
    return () => {
      alive = false
    }
  }, [token])
  return state
}

export function useBusinessFeatures(): BusinessFeatures & { loaded: boolean } {
  const s = useBusinessSettings()
  return { ...s.features, loaded: s.loaded }
}
