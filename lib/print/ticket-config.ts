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
  "58mm": "Térmica 58 mm (imprime 48 mm)",
  "80mm": "Térmica 80 mm (imprime 72 mm)",
  A5: "A5 (media hoja)",
  A4: "A4",
  carta: "Carta",
}

/**
 * thermal: formato de ticket angosto; si no, documento con tabla.
 * printMm: ancho que la impresora térmica realmente imprime — el cabezal no
 * llega al borde del rollo (58 mm → 48 mm, 80 mm → 72 mm). Si el contenido
 * ocupa el rollo entero, los bordes salen cortados.
 */
export const PAPER_SPECS: Record<PaperSize, { thermal: boolean; widthMm: number; printMm: number; page: string }> = {
  "58mm": { thermal: true, widthMm: 58, printMm: 48, page: "58mm auto" },
  "80mm": { thermal: true, widthMm: 80, printMm: 72, page: "80mm auto" },
  A5: { thermal: false, widthMm: 148, printMm: 124, page: "A5" },
  A4: { thermal: false, widthMm: 210, printMm: 186, page: "A4" },
  carta: { thermal: false, widthMm: 216, printMm: 192, page: "letter" },
}

export const FONT_SCALES = ["small", "normal", "large"] as const
export type FontScale = (typeof FONT_SCALES)[number]
export const FONT_SCALE_LABELS: Record<FontScale, string> = { small: "Pequeña", normal: "Normal", large: "Grande" }
export const FONT_SCALE_FACTOR: Record<FontScale, number> = { small: 0.88, normal: 1, large: 1.15 }

export const FONT_FAMILIES = ["sans", "mono"] as const
export type FontFamily = (typeof FONT_FAMILIES)[number]
export const FONT_FAMILY_LABELS: Record<FontFamily, string> = {
  sans: "Moderna (Arial)",
  mono: "Clásica de ticket (monoespaciada)",
}

export const LOGO_SIZES = ["small", "medium", "large"] as const
export type LogoSize = (typeof LOGO_SIZES)[number]
export const LOGO_SIZE_LABELS: Record<LogoSize, string> = { small: "Pequeño", medium: "Mediano", large: "Grande" }
/** Ancho del logo como % del ancho imprimible (en hojas se limita a 45 mm). */
export const LOGO_SIZE_PERCENT: Record<LogoSize, number> = { small: 35, medium: 55, large: 80 }

/** El logo se guarda como data URL dentro del JSON (ya reducido y en escala de grises al subirlo). */
export const LOGO_MAX_CHARS = 350_000
const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/

export interface TicketConfig {
  /** Cabecera común a todos los documentos. Vacío = no se imprime esa línea. */
  business: {
    name: string // nombre comercial; vacío = nombre del local
    ruc: string
    address: string
    phone: string
    extraLines: string // una por línea: redes, web, eslogan...
    logo: string // data URL (png/jpeg/webp) o vacío
    logoSize: LogoSize
  }
  receipt: {
    paper: PaperSize
    fontScale: FontScale
    fontFamily: FontFamily
    title: string
    showLogo: boolean
    showStoreName: boolean
    showOrderNumber: boolean
    showTable: boolean
    showDateTime: boolean
    showWaiter: boolean
    showNotes: boolean
    showSubtotals: boolean
    showAmountInWords: boolean
    showPaymentMethod: boolean
    showEstimatedTime: boolean
    estimatedTimeText: string
    footerText: string // una por línea
    qrEnabled: boolean
    qrTitle: string
    qrUrl: string // lo que codifica el QR: web, Instagram, WhatsApp, carta digital...
    qrShowUrl: boolean
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
  business: { name: "", ruc: "", address: "", phone: "", extraLines: "", logo: "", logoSize: "medium" },
  receipt: {
    paper: "80mm",
    fontScale: "normal",
    fontFamily: "sans",
    title: "NOTA DE VENTA",
    showLogo: true,
    showStoreName: true,
    showOrderNumber: true,
    showTable: true,
    showDateTime: true,
    showWaiter: true,
    showNotes: true,
    showSubtotals: true,
    showAmountInWords: true,
    showPaymentMethod: true,
    showEstimatedTime: false,
    estimatedTimeText: "15 - 20 minutos",
    footerText: "¡Gracias por su compra!",
    qrEnabled: false,
    qrTitle: "Conoce más sobre mí",
    qrUrl: "",
    qrShowUrl: true,
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
const logo = (v: unknown) => (typeof v === "string" && v.length <= LOGO_MAX_CHARS && LOGO_RE.test(v) ? v : "")

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
      logo: logo(b.logo),
      logoSize: oneOf(b.logoSize, LOGO_SIZES, d.business.logoSize),
    },
    receipt: {
      paper: oneOf(r.paper, PAPER_SIZES, d.receipt.paper),
      fontScale: oneOf(r.fontScale, FONT_SCALES, d.receipt.fontScale),
      fontFamily: oneOf(r.fontFamily, FONT_FAMILIES, d.receipt.fontFamily),
      title: str(r.title, d.receipt.title, 60),
      showLogo: bool(r.showLogo, d.receipt.showLogo),
      showStoreName: bool(r.showStoreName, d.receipt.showStoreName),
      showOrderNumber: bool(r.showOrderNumber, d.receipt.showOrderNumber),
      showTable: bool(r.showTable, d.receipt.showTable),
      showDateTime: bool(r.showDateTime, d.receipt.showDateTime),
      showWaiter: bool(r.showWaiter, d.receipt.showWaiter),
      showNotes: bool(r.showNotes, d.receipt.showNotes),
      showSubtotals: bool(r.showSubtotals, d.receipt.showSubtotals),
      showAmountInWords: bool(r.showAmountInWords, d.receipt.showAmountInWords),
      showPaymentMethod: bool(r.showPaymentMethod, d.receipt.showPaymentMethod),
      showEstimatedTime: bool(r.showEstimatedTime, d.receipt.showEstimatedTime),
      estimatedTimeText: str(r.estimatedTimeText, d.receipt.estimatedTimeText, 60),
      footerText: str(r.footerText, d.receipt.footerText, 500),
      qrEnabled: bool(r.qrEnabled, d.receipt.qrEnabled),
      qrTitle: str(r.qrTitle, d.receipt.qrTitle, 60),
      qrUrl: str(r.qrUrl, d.receipt.qrUrl, 300),
      qrShowUrl: bool(r.qrShowUrl, d.receipt.qrShowUrl),
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
