/**
 * lib/business/movement-label.ts
 * ---------------------------------------------------------------------------
 * Cómo se muestra un movimiento financiero (financial_movements) en caja y en
 * /admin/finanzas: título en español, tipo, caja involucrada y si el dinero
 * entra, sale o solo se mueve entre cajas. Los movimientos viejos guardaban
 * descripciones en inglés ("Distribution to strongbox"): se traducen al vuelo.
 * ---------------------------------------------------------------------------
 */

export type MovementLike = {
  type?: string
  movementType?: string
  category?: string
  amount: number
  description?: string
  origin?: string
  source?: string
  fromBox?: string
  toBox?: string
}

/** in = entra dinero, out = sale, move = pasa de una caja a otra (no cambia el total). */
export type MovementDirection = "in" | "out" | "move"

const BOX_NAMES: Record<string, string> = {
  caja_operativa: "Caja operativa",
  cash_register: "Caja operativa",
  operational: "Caja operativa",
  caja_fuerte: "Caja fuerte",
  safe_box: "Caja fuerte",
  strongbox: "Caja fuerte",
  principal: "Caja principal",
}

const CATEGORY_LABELS: Record<string, string> = {
  dinero_dueno: "Dinero del dueño",
  fondo_sencillo: "Fondo de sencillo",
  reposicion: "Reposición",
  propina_tienda: "Propina del local",
  propina_mozo: "Propina del mozo",
  pago_proveedor: "Pago a proveedor",
  retiro_dueno: "Retiro del dueño",
  ajuste_arqueo: "Ajuste de arqueo",
  otro: "Otro",
  otros: "Otros",
  mantenimiento: "Mantenimiento",
  suministros: "Suministros",
  servicios: "Servicios",
  personal: "Personal",
  marketing: "Marketing",
}

const TYPE_LABELS: Record<string, string> = {
  sale: "Venta",
  expense: "Gasto",
  provider_payment: "Pago a proveedor",
  cash_transfer: "Transferencia",
  cash_distribution: "Cierre de caja",
  cash_adjustment: "Ajuste de caja",
  adjustment: "Ajuste",
  deposit: "Depósito",
  withdrawal: "Retiro",
  opening: "Apertura",
}

export function boxName(box?: string) {
  return box ? BOX_NAMES[box] || box : ""
}

const shortBox = (box?: string) => boxName(box).replace(/^Caja /, "").replace(/^./, (c) => c.toUpperCase())

/** Traduce las descripciones automáticas viejas (en inglés). */
function translateDescription(text: string) {
  const t = text.trim()
  if (t === "Distribution to strongbox") return "Guardado en caja fuerte"
  if (t === "Distribution to principal cash box") return "Guardado en caja principal"
  let m = t.match(/^Transfer from (\w+) to (\w+): ?(.*)$/)
  if (m) return `Transferencia ${shortBox(m[1])} → ${shortBox(m[2])}${m[3] ? `: ${m[3]}` : ""}`
  m = t.match(/^Cash adjustment: (.*)$/)
  if (m) return `Ajuste de caja: ${m[1]}`
  m = t.match(/^Cash movement: (.*)$/)
  if (m) return CATEGORY_LABELS[m[1]] || m[1]
  m = t.match(/^Payment to provider: (.*)$/)
  if (m) return `Pago a proveedor: ${m[1]}`
  m = t.match(/^Reversal of: (.*)$/)
  if (m) return `Anulación: ${m[1]}`
  return t
}

export function movementDirection(m: MovementLike): MovementDirection {
  if (m.movementType === "entrada") return "in"
  if (m.movementType === "salida") return "out"
  switch (m.type) {
    case "cash_distribution":
    case "cash_transfer":
      return "move"
    case "sale":
    case "deposit":
    case "opening":
      return "in"
    case "expense":
    case "provider_payment":
    case "withdrawal":
      return m.amount < 0 ? "in" : "out" // monto negativo = anulación de un gasto
    default:
      return m.amount < 0 ? "out" : "in"
  }
}

export function describeMovement(m: MovementLike) {
  const direction = movementDirection(m)
  const kind =
    m.type === "cash_movement" || !m.type
      ? CATEGORY_LABELS[m.category || ""] || (m.movementType === "salida" ? "Salida" : "Entrada")
      : (m.type === "expense" && m.amount < 0 ? "Anulación de gasto" : TYPE_LABELS[m.type] || m.type)

  const from = m.fromBox || m.origin || m.source
  const box =
    direction === "move" && m.fromBox && m.toBox
      ? `${shortBox(m.fromBox)} → ${shortBox(m.toBox)}`
      : boxName(direction === "in" ? m.toBox || m.origin || m.source || m.fromBox : from)

  const description = m.description?.trim() ? translateDescription(m.description) : ""
  const title = description || kind
  // Si el título ya es el tipo, no se repite abajo.
  const detail = [title === kind ? "" : kind, box].filter(Boolean).join(" · ")

  return { title, detail, kind, box, direction, amount: Math.abs(m.amount) }
}

/** "+S/ 10.00", "-S/ 10.00" o "S/ 10.00" (traspaso entre cajas). */
export function movementAmountText(m: MovementLike) {
  const { direction, amount } = describeMovement(m)
  const sign = direction === "in" ? "+" : direction === "out" ? "-" : ""
  return `${sign}S/ ${amount.toFixed(2)}`
}
