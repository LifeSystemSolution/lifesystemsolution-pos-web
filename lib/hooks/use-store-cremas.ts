"use client"
/**
 * lib/hooks/use-store-cremas.ts
 * ---------------------------------------------------------------------------
 * Lista de cremas del local (store_settings/{storeId}_cremas), en vivo. Si el
 * local no la configuró todavía, la lista por defecto (DEFAULT_CREMAS).
 * ---------------------------------------------------------------------------
 */
import { useCallback, useEffect, useState } from "react"
import { collections } from "@/lib/firebase/firestore"
import { doc, onSnapshot, setDoc } from "@/lib/local/firebase-shim/firestore"
import { db } from "@/lib/local/db-placeholder"
import { DEFAULT_CREMAS, cremasDocId, normalizeCremas } from "@/lib/business/cremas"

export function useStoreCremas(storeId: string | null | undefined) {
  const [cremas, setCremas] = useState<string[]>(DEFAULT_CREMAS)
  const [configured, setConfigured] = useState(false)

  useEffect(() => {
    if (!storeId) return
    return onSnapshot(doc(db, collections.storeSettings, cremasDocId(storeId)), (snap) => {
      if (snap.exists()) {
        setCremas(normalizeCremas(snap.data()?.cremas))
        setConfigured(true)
      } else {
        setCremas(DEFAULT_CREMAS)
        setConfigured(false)
      }
    })
  }, [storeId])

  const save = useCallback(
    async (list: string[]) => {
      if (!storeId) return
      const clean = normalizeCremas(list)
      await setDoc(doc(db, collections.storeSettings, cremasDocId(storeId)), { storeId, cremas: clean }, { merge: true })
      setCremas(clean)
      setConfigured(true)
    },
    [storeId]
  )

  return { cremas, configured, save }
}
