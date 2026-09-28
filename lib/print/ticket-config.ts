/**
 * lib/print/ticket-config.ts
 * ---------------------------------------------------------------------------
 * Formato de impresión POR EMPRESA (companies.ticket_settings), editable solo
 * por el dueño de la plataforma en /plataforma/empresas/[id]. Lo leen el
 * servidor (validar/normalizar antes de guardar, devolver al POS) y el
 * navegador (armar el HTML de impresión) — por eso no importa nada de Node.
 *
 * Reemplaza en la práctica a lib/print/print-settings.ts, que guardaba una
 * config por dispositivo en localStorage que ninguna pantalla usaba.
 * ---------------------------------------------------------------------------
 */

export const PAPER_SIZES = ["58mm", "80mm", "A5", "A4", "carta"] as const
export type PaperSize = (typeof PAPER_SIZES)[number]

export const PAPER_LABELS: Record<PaperSize, string> = {
  "58mm": "Térmica 58 mm",
  "80mm": "Térmica 80 mm",
  A5: "A5 (media hoja)",
  A4: "A4",
  carta: "Carta",
}

/** thermal: formato de ticket angosto; si no, formato de documento con tabla. */
export const PAPER_SPECS: Record<PaperSize, { thermal: boolean; widthMm: number; chars: number; page: string }> = {
  "58mm": { thermal: true, widthMm: 58, chars: 32, page: "58mm auto" },
  "80mm": { thermal: true, widthMm: 80, chars: 42, page: "80mm auto" },
  A5: { thermal: false, widthMm: 148, chars: 60, page: "A5" },
  A4: { thermal: false, widthMm: 210, chars: 80, page: "A4" },
  carta: { thermal: false, widthMm: 216, chars: 80, page: "letter" },
}

export const FONT_SCALES = ["small", "normal", "large"] as const
export type FontScale = (typeof FONT_SCALES)[number]
export const FONT_SCALE_LABELS: Record<FontScale, string> = { small: "Pequeña", normal: "Normal", large: "Grande" }
export const FONT_SCALE_FACTOR: Record<FontScale, number> = { small: 0.85, normal: 1, large: 1.2 }

export interface TicketConfig {
  /** Cabecera común a todos los documentos. Vacío = no se imprime esa línea. */
  business: {
    name: string // nombre comercial; vacío = nombre del local
    ruc: string
    address: string
    phone: string
    extraLines: string // una por línea: redes, web, eslogan...
  }
  receipt: {
    paper: PaperSize
    fontScale: FontScale
    title: string
    showStoreName: boolean
    showOrderNumber: boolean
    showTable: boolean
    showDateTime: boolean
    showWaiter: boolean
    showNotes: boolean
    showSubtotals: boolean
    showPaymentMethod: boolean
    showEstimatedTime: boolean
    estimatedTimeText: string
    footerText: string // una por línea
  }
  kitchen: {
    paper: PaperSize
    fontScale: FontScale
    showWaiter: boolean
    showTime: boolean
    showNotes: boolean
    showLateWarning: boolean
  }
}

export const DEFAULT_TICKET_CONFIG: TicketConfig = {
  business: { name: "", ruc: "", address: "", phone: "", extraLines: "" },
  receipt: {
    paper: "80mm",
    fontScale: "normal",
    title: "RECIBO DE VENTA",
    showStoreName: true,
    showOrderNumber: true,
    showTable: true,
    showDateTime: true,
    showWaiter: true,
    showNotes: true,
    showSubtotals: true,
    showPaymentMethod: true,
    showEstimatedTime: false,
    estimatedTimeText: "15 - 20 minutos",
    footerText: "¡Gracias por su compra!",
  },
  kitchen: {
    paper: "80mm",
    fontScale: "large",
    showWaiter: true,
    showTime: true,
    showNotes: true,
    showLateWarning: true,
  },
}

const str = (v: unknown, fallback: string, max: number) =>
  typeof v === "string" ? v.slice(0, max) : fallback
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback)
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {})

/**
 * Completa con valores por defecto y descarta todo lo que no sea del tipo
 * esperado. Se aplica al guardar (servidor) y al leer (servidor y cliente),
 * así un JSON viejo o incompleto nunca rompe la impresión.
 */
export function normalizeTicketConfig(raw: unknown): TicketConfig {
  const d = DEFAULT_TICKET_CONFIG
  const b = obj(obj(raw).business)
  const r = obj(obj(raw).receipt)
  const k = obj(obj(raw).kitchen)
  return {
    business: {
      name: str(b.name, d.business.name, 120),
      ruc: str(b.ruc, d.business.ruc, 20),
      address: str(b.address, d.business.address, 200),
      phone: str(b.phone, d.business.phone, 60),
      extraLines: str(b.extraLines, d.business.extraLines, 500),
    },
    receipt: {
      paper: oneOf(r.paper, PAPER_SIZES, d.receipt.paper),
      fontScale: oneOf(r.fontScale, FONT_SCALES, d.receipt.fontScale),
      title: str(r.title, d.receipt.title, 60),
      showStoreName: bool(r.showStoreName, d.receipt.showStoreName),
      showOrderNumber: bool(r.showOrderNumber, d.receipt.showOrderNumber),
      showTable: bool(r.showTable, d.receipt.showTable),
      showDateTime: bool(r.showDateTime, d.receipt.showDateTime),
      showWaiter: bool(r.showWaiter, d.receipt.showWaiter),
      showNotes: bool(r.showNotes, d.receipt.showNotes),
      showSubtotals: bool(r.showSubtotals, d.receipt.showSubtotals),
      showPaymentMethod: bool(r.showPaymentMethod, d.receipt.showPaymentMethod),
      showEstimatedTime: bool(r.showEstimatedTime, d.receipt.showEstimatedTime),
      estimatedTimeText: str(r.estimatedTimeText, d.receipt.estimatedTimeText, 60),
      footerText: str(r.footerText, d.receipt.footerText, 500),
    },
    kitchen: {
      paper: oneOf(k.paper, PAPER_SIZES, d.kitchen.paper),
      fontScale: oneOf(k.fontScale, FONT_SCALES, d.kitchen.fontScale),
      showWaiter: bool(k.showWaiter, d.kitchen.showWaiter),
      showTime: bool(k.showTime, d.kitchen.showTime),
      showNotes: bool(k.showNotes, d.kitchen.showNotes),
      showLateWarning: bool(k.showLateWarning, d.kitchen.showLateWarning),
    },
  }
}

/** Texto multilínea → líneas no vacías. */
export function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}
