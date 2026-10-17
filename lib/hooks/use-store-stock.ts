"use client"
/**
 * lib/hooks/use-store-stock.ts
 * ---------------------------------------------------------------------------
 * Stock en vivo de un local: Map<id de inventory_item, unidades>. null
 * mientras no cargó (no se debe marcar nada como agotado hasta saberlo).
 *
 * Varias pantallas pueden usarlo a la vez sin costo extra: el shim de
 * onSnapshot comparte una sola lectura por query (ver
 * lib/local/firebase-shim/firestore.ts).
 *
 * El servidor es quien hace cumplir el stock (deductInventoryInTransaction
 * rechaza "Stock insuficiente"); esto es para avisar y bloquear antes.
 * ---------------------------------------------------------------------------
 */
import { useEffect, useState } from "react"
import { getInventoryItemId, subscribeToStoreInventory, type OrderItem } from "@/lib/firebase/firestore"

export type StockMap = Map<string, number>

export function useStoreStock(storeId: string | null | undefined): StockMap | null {
  const [stock, setStock] = useState<StockMap | null>(null)
  useEffect(() => {
    setStock(null)
    if (!storeId) return
    return subscribeToStoreInventory(storeId, (items) => {
      setStock(new Map(items.map((i) => [i.id!, Number(i.currentStock) || 0])))
    })
  }, [storeId])
  return stock
}

type ItemRef = Pick<OrderItem, "productId" | "variantId" | "category" | "productType" | "massType">

/** Unidades del mismo inventario que suman los ítems dados (p. ej. el carrito). */
export function quantityByInventory(storeId: string, items: (ItemRef & { quantity: number })[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const item of items) {
    const id = getInventoryItemId(storeId, item)
    m.set(id, (m.get(id) || 0) + (Number(item.quantity) || 0))
  }
  return m
}

/** Unidades que todavía se pueden agregar; null si el stock aún no cargó. */
export function remainingFor(
  stock: StockMap | null,
  storeId: string,
  item: ItemRef,
  alreadyTaken: Map<string, number> = new Map()
): number | null {
  if (!stock) return null
  const id = getInventoryItemId(storeId, item)
  return (stock.get(id) ?? 0) - (alreadyTaken.get(id) || 0)
}
