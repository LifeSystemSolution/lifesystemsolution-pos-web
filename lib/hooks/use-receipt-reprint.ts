"use client"
/**
 * lib/hooks/use-receipt-reprint.ts
 * ---------------------------------------------------------------------------
 * Reimprimir una venta con EXACTAMENTE el mismo formato que al cobrar:
 * mismo generador (renderReceiptHTML), mismo formato de la empresa
 * (useTicketConfig) y el mismo N° de comprobante (p. ej. NV01-00000012), que
 * se busca en "comprobantes" por orderId. Lo usan todos los botones de
 * reimpresión (ventas del día, ventas de un cierre).
 * ---------------------------------------------------------------------------
 */
import { useCallback } from "react"
import { useAuth } from "@/contexts/auth-context"
import { collections, type Order } from "@/lib/firebase/firestore"
import { collection, getDocs, query, where } from "@/lib/local/firebase-shim/firestore"
import { db } from "@/lib/local/db-placeholder"
import { useTicketConfig } from "@/lib/hooks/use-ticket-config"
import { printHTML, renderReceiptHTML } from "@/lib/print/ticket-render"

async function findDocumentNumber(orderId: string): Promise<string | undefined> {
  try {
    const snap = await getDocs(query(collection(db, collections.comprobantes), where("orderId", "==", orderId)))
    const withNumber = snap.docs
      .map((d) => d.data() as { numeroCompleto?: string; createdAt?: { toMillis?: () => number } })
      .filter((c) => c.numeroCompleto)
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
    return withNumber[0]?.numeroCompleto
  } catch (err) {
    console.warn("[reimprimir] No se pudo leer el comprobante; se imprime con el N° de pedido:", err)
    return undefined
  }
}

export function useReceiptReprint() {
  const ticketConfig = useTicketConfig()
  const { currentStore } = useAuth()
  return useCallback(
    async (order: Order) => {
      // La ventana se abre en el click (antes del await): si no, el navegador la bloquea.
      const target = window.open("", "_blank")
      const documentNumber = order.documentNumber || (order.id ? await findDocumentNumber(order.id) : undefined)
      printHTML(renderReceiptHTML({ ...order, documentNumber }, currentStore || undefined, ticketConfig), target)
    },
    [ticketConfig, currentStore]
  )
}
