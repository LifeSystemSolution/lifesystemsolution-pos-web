/**
 * lib/business/order-label.ts
 * ---------------------------------------------------------------------------
 * Cómo se nombra un pedido en pantallas y tickets: "Mesa 3", o para llevar
 * "Llevar: Juan" (nombre del cliente que pidió el mesero) / "Para Llevar".
 * ---------------------------------------------------------------------------
 */
import type { Order } from "@/lib/firebase/firestore"

type Labeled = Pick<Order, "orderType" | "tableNumber" | "customerName">

export function isTakeout(order: Labeled) {
  return order.orderType === "takeout" || order.tableNumber == null
}

export function orderPlaceLabel(order: Labeled) {
  if (!isTakeout(order)) return `Mesa ${order.tableNumber}`
  const name = order.customerName?.trim()
  return name ? `Llevar: ${name}` : "Para Llevar"
}
