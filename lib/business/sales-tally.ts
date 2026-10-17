/**
 * lib/business/sales-tally.ts
 * ---------------------------------------------------------------------------
 * "Vendido hoy" (rubros con features.dailySalesTally, p. ej. comida rápida):
 * cuánto se vendió de cada producto y por cuánto, a partir de los pedidos
 * COBRADOS de la caja abierta. No es inventario: no descuenta nada, y como
 * sale de la sesión de caja, empieza en 0 cada vez que se abre caja.
 * ---------------------------------------------------------------------------
 */
import type { Order } from "@/lib/firebase/firestore"

export type SalesTallyLine = { name: string; quantity: number; total: number }
export type SalesTally = { lines: SalesTallyLine[]; totalAmount: number; totalUnits: number; ordersCount: number }

/** Nombre con su presentación, sin repetirla si ya viene en el nombre (pizzas). */
function lineName(item: Order["items"][number]): string {
  const v = (item.variantName || "").trim()
  if (!v || item.productName.toLocaleLowerCase().includes(v.toLocaleLowerCase())) return item.productName
  return `${item.productName} - ${v}`
}

export function summarizeSales(orders: Order[]): SalesTally {
  const byName = new Map<string, SalesTallyLine>()
  let ordersCount = 0
  for (const order of orders) {
    if (order.paymentStatus !== "paid" || order.cancelled || order.deleted) continue
    ordersCount++
    for (const item of order.items || []) {
      if (item.cancelled || !item.quantity) continue
      const name = lineName(item)
      const line = byName.get(name) || { name, quantity: 0, total: 0 }
      line.quantity += item.quantity
      line.total += item.quantity * item.price
      byName.set(name, line)
    }
  }
  const lines = Array.from(byName.values()).sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name))
  return {
    lines,
    totalAmount: lines.reduce((s, l) => s + l.total, 0),
    totalUnits: lines.reduce((s, l) => s + l.quantity, 0),
    ordersCount,
  }
}
