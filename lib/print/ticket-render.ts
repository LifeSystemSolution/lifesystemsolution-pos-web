/**
 * lib/print/ticket-render.ts
 * ---------------------------------------------------------------------------
 * HTML de impresión de la nota de venta y de la comanda de cocina según la
 * config de la empresa (lib/print/ticket-config.ts):
 *
 *   - Papel térmico (58/80 mm): ticket con logo, recuadro del documento,
 *     tabla de productos, total destacado, importe en letras y QR.
 *   - Hoja (A5/A4/Carta): documento con cabecera, tabla y totales.
 *
 * El ancho del contenido es el ancho IMPRIMIBLE (48/72 mm), no el del rollo:
 * el cabezal térmico no llega a los bordes. Todo texto que viene de datos se
 * escapa (se escribe con document.write en una ventana nueva).
 * ---------------------------------------------------------------------------
 */
import qrcode from "qrcode-generator"
import type { Order, Store } from "@/lib/firebase/firestore"
import { formatPeruTime, formatReceiptDateTime, toPeruDate } from "@/lib/utils"
import { amountInWords } from "@/lib/print/amount-in-words"
import {
  FONT_SCALE_FACTOR,
  LOGO_SIZE_PERCENT,
  PAPER_SPECS,
  lines,
  type FontScale,
  type PaperSize,
  type TicketConfig,
} from "@/lib/print/ticket-config"

type StoreLike = Pick<Store, "name"> & Partial<Store>

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

const amount = (n: number) => (Number(n) || 0).toFixed(2)
const money = (n: number) => `S/ ${amount(n)}`

const PAYMENT_LABELS: Record<string, string> = {
  cash: "EFECTIVO",
  card: "TARJETA",
  yape: "YAPE",
  plin: "PLIN",
  transfer: "TRANSFERENCIA",
  mixed: "MIXTO",
}

/** N° legible y estable: los últimos 6 caracteres alfanuméricos del id. */
export function orderNumber(order: Order) {
  const clean = String(order.id || "").replace(/[^a-z0-9]/gi, "")
  return (clean.slice(-6) || "000000").toUpperCase().padStart(6, "0")
}

function serviceLabel(order: Order) {
  if (order.orderType === "takeout" || order.tableNumber == null) {
    const name = order.customerName?.trim()
    return name ? `Para llevar: ${name}` : "Para llevar"
  }
  return `Mesa ${String(order.tableNumber).padStart(2, "0")}`
}

/**
 * Variante a mostrar aparte del nombre. Las pizzas ya traen el tamaño en el
 * nombre ("A lo Multipizza - Bipersonal"): no se repite.
 */
function variantOf(item: Order["items"][number]) {
  const v = (item.variantName || "").trim()
  if (!v) return ""
  return item.productName.toLocaleLowerCase().includes(v.toLocaleLowerCase()) ? "" : v
}

function itemLabel(item: Order["items"][number]) {
  const v = variantOf(item)
  return `${item.productName}${v ? ` ${v}` : ""}`
}

/**
 * QR como SVG en línea (vectorial: sale nítido en cualquier impresora).
 * El texto se pasa ya convertido a bytes UTF-8 (un carácter por byte): el
 * build ESM de qrcode-generator —el que usa el navegador— no trae
 * stringToBytesFuncs["UTF-8"] y su conversión por defecto corta cada
 * carácter a 8 bits.
 */
function qrSvg(text: string): string {
  try {
    const utf8 = String.fromCharCode(...new TextEncoder().encode(text))
    const qr = qrcode(0, "M")
    qr.addData(utf8, "Byte")
    qr.make()
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true })
  } catch (err) {
    console.warn("[ticket] No se pudo generar el QR:", err)
    return ""
  }
}

/** Bloque del QR (generado desde el enlace o imagen subida), a `sizeMm` de lado. */
function qrBlock(r: TicketConfig["receipt"], sizeMm: number): string {
  if (!r.qrEnabled) return ""
  const size = `width:${sizeMm}mm;height:${sizeMm}mm`
  let code = ""
  if (r.qrMode === "image") {
    if (r.qrImage) code = `<img src="${esc(r.qrImage)}" alt="" style="${size};object-fit:contain;margin:0 auto;image-rendering:pixelated">`
  } else if (r.qrUrl.trim()) {
    const svg = qrSvg(r.qrUrl.trim())
    if (svg) code = `<div style="${size};margin:0 auto">${svg.replace("<svg ", `<svg style="${size}" `)}</div>`
  }
  if (!code) return ""
  const title = r.qrTitle.trim() ? `<div class="qr-t">${esc(r.qrTitle)}</div>` : ""
  const url = r.qrMode === "link" && r.qrShowUrl ? `<div class="qr-u">${esc(r.qrUrl.trim())}</div>` : ""
  return `<div class="qr">${title}${code}${url}</div>`
}

function documentShell(opts: {
  title: string
  paper: PaperSize
  fontScale: FontScale
  fontFamily: string
  css: string
  body: string
}) {
  const spec = PAPER_SPECS[opts.paper]
  const f = FONT_SCALE_FACTOR[opts.fontScale]
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${esc(opts.title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root { --f: ${f}; }
  html, body { background: #fff; }
  body { width: ${spec.thermal ? `${spec.printMm}mm` : "auto"}; margin: 0 auto; color: #000;
         font-family: ${opts.fontFamily}; line-height: 1.3;
         font-size: calc(${spec.thermal ? 11 : 12}px * var(--f));
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: ${spec.page}; margin: ${spec.thermal ? "0" : "12mm"}; }
  .center { text-align: center; } .right { text-align: right; } .bold { font-weight: bold; }
  img { display: block; }
  ${opts.css}
</style>
</head>
<body>${opts.body}</body>
</html>`
}

const SANS = "Arial, Helvetica, sans-serif"
const MONO = "'Courier New', Courier, monospace"

function header(cfg: TicketConfig, store?: StoreLike) {
  const b = cfg.business
  return {
    name: b.name.trim() || store?.name || "",
    details: [
      b.ruc.trim() && `RUC: ${b.ruc.trim()}`,
      b.address.trim(),
      b.phone.trim() && `Tel: ${b.phone.trim()}`,
      ...lines(b.extraLines),
    ].filter(Boolean) as string[],
    logo: cfg.receipt.showLogo && b.logo ? b.logo : "",
  }
}

// --- Nota de venta: papel térmico ---------------------------------------------------

const THERMAL_CSS = `
  .r { padding: 2mm 0 4mm; }
  .logo { margin: 0 auto 2mm; max-width: 100%; height: auto; image-rendering: -webkit-optimize-contrast; }
  .biz { text-align: center; font-weight: bold; font-size: calc(15px * var(--f)); letter-spacing: .02em; text-transform: uppercase; }
  .biz-d { text-align: center; font-size: calc(10px * var(--f)); }
  .doc { border: 1.5px solid #000; border-radius: 2px; text-align: center; margin: 2.5mm 0 2mm; padding: 1.2mm 1mm; }
  .doc-t { font-weight: bold; font-size: calc(13px * var(--f)); letter-spacing: .06em; }
  .doc-n { font-size: calc(11px * var(--f)); font-weight: bold; }
  table { width: 100%; border-collapse: collapse; }
  .kv td { padding: .3mm 0; vertical-align: top; font-size: calc(10.5px * var(--f)); }
  .kv td:first-child { width: 32%; font-weight: bold; white-space: nowrap; padding-right: 1.5mm; }
  .items { margin-top: 2mm; }
  .items th { font-size: calc(9px * var(--f)); font-weight: bold; letter-spacing: .04em; text-align: left;
              border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: .8mm 0; }
  .items td { vertical-align: top; padding: 1.2mm 0 0; }
  .items .q { width: 12%; text-align: left; font-weight: bold; padding-right: 1mm; }
  .items .a { width: 22%; text-align: right; white-space: nowrap; font-weight: bold; }
  .items .d { padding-right: 1mm; word-break: break-word; }
  .sub { font-size: calc(9.5px * var(--f)); color: #000; }
  .note { font-size: calc(9.5px * var(--f)); font-style: italic; }
  .end { border-top: 1px dashed #000; margin-top: 1.5mm; }
  .tot td { padding: .5mm 0; }
  .tot td:last-child { text-align: right; white-space: nowrap; }
  .grand td { border-top: 2px solid #000; border-bottom: 2px solid #000; font-weight: bold;
              font-size: calc(15px * var(--f)); padding: 1.2mm 0; }
  .words { font-size: calc(9.5px * var(--f)); margin-top: 1.5mm; }
  .pay { margin-top: 1.5mm; }
  .eta { text-align: center; margin-top: 2mm; font-size: calc(10px * var(--f)); }
  .foot { text-align: center; margin-top: 3mm; font-weight: bold; }
  .qr { text-align: center; margin-top: 3mm; padding-top: 2.5mm; border-top: 1px dashed #000; }
  .qr-t { font-weight: bold; font-size: calc(11px * var(--f)); margin-bottom: 1.5mm; text-transform: uppercase; letter-spacing: .03em; }
  .qr svg { display: block; margin: 0 auto; }
  .qr-u { font-size: calc(9px * var(--f)); margin-top: 1mm; word-break: break-all; }
`

function thermalReceipt(order: Order, store: StoreLike | undefined, cfg: TicketConfig) {
  const r = cfg.receipt
  const spec = PAPER_SPECS[r.paper]
  const items = order.items.filter((i) => !i.cancelled)
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0)
  const head = header(cfg, store)
  const payment =
    PAYMENT_LABELS[order.paymentMethod || ""] ||
    (order.paymentMethod ? String(order.paymentMethod).toUpperCase() : "NO ESPECIFICADO")
  const footer = lines(r.footerText)
  const qrMm = Math.round(spec.printMm * 0.5) // 36 mm en 80 mm, 24 mm en 58 mm: se escanea bien

  const kv: [string, string][] = []
  if (r.showDateTime) kv.push(["Fecha", formatReceiptDateTime(order.createdAt)])
  if (r.showStoreName && store?.name && store.name !== head.name) kv.push(["Local", store.name])
  if (r.showTable) kv.push(["Servicio", serviceLabel(order)])
  if (r.showWaiter && order.userName) kv.push(["Atendido por", order.userName])

  const rows = items
    .map((i) => {
      const sub = [variantOf(i), i.quantity > 1 ? `${money(i.price)} c/u` : ""].filter(Boolean).join(" · ")
      return `<tr><td class="q">${i.quantity}</td><td class="d">${esc(i.productName)}${
        sub ? `<div class="sub">${esc(sub)}</div>` : ""
      }${r.showNotes && i.notes ? `<div class="note">• ${esc(i.notes)}</div>` : ""}</td><td class="a">${amount(
        i.price * i.quantity
      )}</td></tr>`
    })
    .join("")

  const body = [
    `<div class="r">`,
    head.logo
      ? `<img class="logo" src="${esc(head.logo)}" alt="" style="width:${LOGO_SIZE_PERCENT[cfg.business.logoSize]}%">`
      : "",
    head.name ? `<div class="biz">${esc(head.name)}</div>` : "",
    head.details.map((l) => `<div class="biz-d">${esc(l)}</div>`).join(""),
    r.title.trim() || r.showOrderNumber
      ? `<div class="doc">${r.title.trim() ? `<div class="doc-t">${esc(r.title)}</div>` : ""}${
          r.showOrderNumber ? `<div class="doc-n">N° ${esc(order.documentNumber || orderNumber(order))}</div>` : ""
        }</div>`
      : "",
    kv.length ? `<table class="kv">${kv.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>` : "",
    `<table class="items"><thead><tr><th class="q">CANT</th><th class="d">DESCRIPCIÓN</th><th class="a">IMPORTE</th></tr></thead><tbody>${rows}</tbody></table>`,
    `<div class="end"></div>`,
    `<table class="tot">`,
    r.showSubtotals ? `<tr><td>Subtotal</td><td>${money(subtotal)}</td></tr>` : "",
    `<tr class="grand"><td>TOTAL</td><td>${money(order.total)}</td></tr>`,
    `</table>`,
    r.showAmountInWords ? `<div class="words">SON: ${esc(amountInWords(order.total))}</div>` : "",
    r.showPaymentMethod ? `<div class="pay"><span class="bold">Forma de pago:</span> ${esc(payment)}</div>` : "",
    r.showEstimatedTime && r.estimatedTimeText.trim()
      ? `<div class="eta">Tiempo estimado: <span class="bold">${esc(r.estimatedTimeText)}</span></div>`
      : "",
    footer.length ? `<div class="foot">${footer.map((l) => `<div>${esc(l)}</div>`).join("")}</div>` : "",
    qrBlock(r, qrMm),
    `</div>`,
  ].join("\n")

  return documentShell({
    title: r.title || "Nota de venta",
    paper: r.paper,
    fontScale: r.fontScale,
    fontFamily: r.fontFamily === "mono" ? MONO : SANS,
    css: THERMAL_CSS,
    body,
  })
}

// --- Nota de venta: hoja (A5 / A4 / Carta) -----------------------------------------------

const PAGE_CSS = `
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; margin-bottom: 6mm; }
  .brand { display: flex; gap: 4mm; align-items: flex-start; }
  .logo { max-height: 28mm; max-width: 45mm; object-fit: contain; }
  .biz-name { font-size: calc(19px * var(--f)); font-weight: bold; text-transform: uppercase; }
  .muted { color: #222; font-size: calc(11px * var(--f)); }
  .box { border: 1.5px solid #000; border-radius: 3px; padding: 3mm 6mm; text-align: center; min-width: 48mm; }
  .box .title { font-weight: bold; font-size: calc(14px * var(--f)); letter-spacing: .05em; }
  .box .num { font-weight: bold; margin-top: 1mm; }
  .info { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1mm 8mm; margin-bottom: 5mm;
          border: 1px solid #bbb; border-radius: 3px; padding: 2.5mm 4mm; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4mm; }
  th { text-align: left; background: #eee; border-top: 1.5px solid #000; border-bottom: 1.5px solid #000;
       padding: 1.8mm 1.5mm; font-size: calc(10.5px * var(--f)); letter-spacing: .03em; }
  td { border-bottom: 1px solid #ddd; padding: 1.8mm 1.5mm; vertical-align: top; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .note { font-size: calc(10.5px * var(--f)); font-style: italic; color: #333; }
  .bottom { display: flex; justify-content: space-between; gap: 8mm; align-items: flex-start; }
  .words { font-size: calc(11px * var(--f)); max-width: 55%; }
  .totals { width: 72mm; }
  .totals .row { display: flex; justify-content: space-between; padding: 1mm 0; }
  .totals .grand { border-top: 2px solid #000; border-bottom: 2px solid #000; font-weight: bold; font-size: calc(15px * var(--f)); margin-top: 1mm; padding: 2mm 0; }
  .footer { margin-top: 8mm; text-align: center; font-weight: bold; }
  .qr { margin-top: 6mm; display: flex; flex-direction: column; align-items: center; }
  .qr-t { font-weight: bold; text-transform: uppercase; margin-bottom: 2mm; letter-spacing: .03em; }
  .qr-u { font-size: calc(10px * var(--f)); margin-top: 1mm; }
`

function pageReceipt(order: Order, store: StoreLike | undefined, cfg: TicketConfig) {
  const r = cfg.receipt
  const items = order.items.filter((i) => !i.cancelled)
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0)
  const head = header(cfg, store)
  const payment =
    PAYMENT_LABELS[order.paymentMethod || ""] ||
    (order.paymentMethod ? String(order.paymentMethod).toUpperCase() : "NO ESPECIFICADO")
  const footer = lines(r.footerText)

  const info: [string, string][] = []
  if (r.showDateTime) info.push(["Fecha", formatReceiptDateTime(order.createdAt)])
  if (r.showStoreName && store?.name && store.name !== head.name) info.push(["Local", store.name])
  if (r.showTable) info.push(["Servicio", serviceLabel(order)])
  if (r.showWaiter && order.userName) info.push(["Atendido por", order.userName])
  if (r.showPaymentMethod) info.push(["Forma de pago", payment])

  const rows = items
    .map((i) => {
      const note = r.showNotes && i.notes ? `<div class="note">${esc(i.notes)}</div>` : ""
      return `<tr><td class="num">${i.quantity}</td><td>${esc(itemLabel(i))}${note}</td><td class="num">${money(i.price)}</td><td class="num">${money(i.price * i.quantity)}</td></tr>`
    })
    .join("")

  const body = [
    `<div class="top"><div class="brand">`,
    head.logo ? `<img class="logo" src="${esc(head.logo)}" alt="">` : "",
    `<div>`,
    head.name ? `<div class="biz-name">${esc(head.name)}</div>` : "",
    head.details.map((l) => `<div class="muted">${esc(l)}</div>`).join(""),
    `</div></div>`,
    r.title.trim() || r.showOrderNumber
      ? `<div class="box">${r.title.trim() ? `<div class="title">${esc(r.title)}</div>` : ""}${
          r.showOrderNumber ? `<div class="num">N° ${esc(order.documentNumber || orderNumber(order))}</div>` : ""
        }</div>`
      : "",
    `</div>`,
    info.length ? `<div class="info">${info.map(([k, v]) => `<div><span class="bold">${esc(k)}:</span> ${esc(v)}</div>`).join("")}</div>` : "",
    `<table><thead><tr><th class="num" style="width:14mm">CANT.</th><th>DESCRIPCIÓN</th><th class="num" style="width:28mm">P. UNIT.</th><th class="num" style="width:30mm">IMPORTE</th></tr></thead><tbody>${rows}</tbody></table>`,
    `<div class="bottom">`,
    `<div class="words">${r.showAmountInWords ? `<span class="bold">SON:</span> ${esc(amountInWords(order.total))}` : ""}</div>`,
    `<div class="totals">`,
    r.showSubtotals ? `<div class="row"><span>Subtotal</span><span>${money(subtotal)}</span></div>` : "",
    `<div class="row grand"><span>TOTAL</span><span>${money(order.total)}</span></div>`,
    `</div></div>`,
    r.showEstimatedTime && r.estimatedTimeText.trim()
      ? `<div class="center" style="margin-top:4mm">Tiempo estimado: ${esc(r.estimatedTimeText)}</div>`
      : "",
    footer.length ? `<div class="footer">${footer.map((l) => `<div>${esc(l)}</div>`).join("")}</div>` : "",
    qrBlock(r, 32),
  ].join("\n")

  return documentShell({
    title: r.title || "Nota de venta",
    paper: r.paper,
    fontScale: r.fontScale,
    fontFamily: r.fontFamily === "mono" ? MONO : SANS,
    css: PAGE_CSS,
    body,
  })
}

export function renderReceiptHTML(order: Order, store: StoreLike | undefined, cfg: TicketConfig): string {
  return PAPER_SPECS[cfg.receipt.paper].thermal ? thermalReceipt(order, store, cfg) : pageReceipt(order, store, cfg)
}

/**
 * Precuenta: lo que se le va a cobrar al cliente, ANTES del pago. Mismo diseño
 * que la nota de venta (logo, papel, QR — útil si es el de Yape), pero sin
 * número de comprobante ni forma de pago, y aclarando que no es comprobante.
 */
export function renderPrecuentaHTML(order: Order, store: StoreLike | undefined, cfg: TicketConfig): string {
  const notice = "Documento no válido como comprobante de pago"
  const precuentaCfg: TicketConfig = {
    ...cfg,
    receipt: {
      ...cfg.receipt,
      title: "PRECUENTA",
      showPaymentMethod: false,
      showEstimatedTime: false,
      footerText: [notice, cfg.receipt.footerText].filter((t) => t.trim()).join("\n"),
    },
  }
  // Fecha y hora de impresión (no la de creación del pedido) y sin el N° de la nota de venta.
  return renderReceiptHTML({ ...order, documentNumber: undefined, createdAt: new Date() as any }, store, precuentaCfg)
}

// --- Comanda de cocina -------------------------------------------------------------

export function renderKitchenHTML(order: Order, store: StoreLike | undefined, cfg: TicketConfig): string {
  const k = cfg.kitchen
  const thermal = PAPER_SPECS[k.paper].thermal
  const minutesOld = Math.floor((Date.now() - toPeruDate(order.createdAt).getTime()) / 60000)
  const css = `
  .ticket { padding: ${thermal ? "2mm 0 4mm" : "0"}; }
  .title { font-size: calc(14px * var(--f)); font-weight: bold; text-align: center; letter-spacing: .05em; }
  .table { font-size: calc(22px * var(--f)); font-weight: bold; text-align: center; margin: 2mm 0;
           border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 1mm 0; text-transform: uppercase; }
  .sep { border-top: 1px dashed #000; margin: 2mm 0; }
  .item { font-size: calc(15px * var(--f)); font-weight: bold; margin: 2mm 0 0; }
  .cancelled { text-decoration: line-through; }
  .note { font-size: calc(12px * var(--f)); padding-left: 4mm; }
  .late { border: 2px solid #000; text-align: center; font-weight: bold; padding: 1.5mm; margin-top: 3mm; }
  .small { font-size: calc(10px * var(--f)); text-align: center; margin-top: 3mm; }
  `
  const itemsHtml = order.items
    .map((i) => {
      const cls = i.cancelled ? "item cancelled" : "item"
      const note = k.showNotes && i.notes ? `<div class="note">&gt; ${esc(i.notes)}</div>` : ""
      return `<div class="${cls}">${i.quantity}x ${esc(itemLabel(i))}${i.cancelled ? " (ANULADO)" : ""}</div>${note}`
    })
    .join("")
  const body = [
    `<div class="ticket">`,
    `<div class="title">COMANDA DE COCINA</div>`,
    store?.name ? `<div class="center">${esc(store.name)}</div>` : "",
    `<div class="table">${esc(serviceLabel(order))}</div>`,
    `<div class="center">N° ${esc(orderNumber(order))}${k.showTime ? ` · ${esc(formatPeruTime(order.createdAt))}` : ""}</div>`,
    k.showWaiter && order.userName ? `<div class="center">Mesero: ${esc(order.userName)}</div>` : "",
    `<div class="sep"></div>`,
    itemsHtml,
    k.showLateWarning && minutesOld > 10 ? `<div class="late">PEDIDO ATRASADO (${minutesOld} min)</div>` : "",
    `<div class="small">Impreso: ${esc(new Date().toLocaleTimeString("es-PE"))}</div>`,
    `</div>`,
  ].join("\n")
  return documentShell({
    title: "Comanda",
    paper: k.paper,
    fontScale: k.fontScale,
    fontFamily: thermal ? MONO : SANS,
    css,
    body,
  })
}

// --- Conteo de stock al cierre y "vendido hoy" (comida rápida) -----------------------

export type StockCountLine = {
  category: string
  name: string
  counted: number
  toBuy: boolean
}

export type SalesTallyPrint = {
  lines: { name: string; quantity: number; total: number }[]
  totalAmount: number
  ordersCount: number
}

const TALLY_CSS = `
  .r { padding: 2mm 0 4mm; }
  .title { text-align: center; font-weight: bold; font-size: calc(15px * var(--f)); letter-spacing: .04em; }
  .sub { text-align: center; font-size: calc(10.5px * var(--f)); }
  .sep { border-top: 1px dashed #000; margin: 2mm 0; }
  .sec { text-align: center; font-weight: bold; font-size: calc(13px * var(--f)); border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 1mm 0; margin-top: 3mm; }
  .cat { font-weight: bold; text-transform: uppercase; margin-top: 2mm; font-size: calc(10.5px * var(--f)); }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: calc(9px * var(--f)); text-align: left; border-bottom: 1px dashed #000; padding: .6mm 0; }
  td { padding: .4mm 0; vertical-align: top; }
  td.q, th.q { text-align: right; white-space: nowrap; font-weight: bold; width: 14%; }
  td.m, th.m { text-align: right; white-space: nowrap; width: 24%; }
  .zero td { font-weight: bold; }
  .tot td { border-top: 1px solid #000; font-weight: bold; padding-top: 1mm; }
  .box { display: inline-block; width: 3.2mm; height: 3.2mm; border: 1px solid #000; margin-right: 1.5mm; vertical-align: -0.5mm; }
  .small { text-align: center; font-size: calc(9.5px * var(--f)); margin-top: 3mm; }
`

function salesSection(sales: SalesTallyPrint): string {
  if (!sales.lines.length) return `<div class="sec">VENDIDO HOY</div><div class="sub">Sin ventas cobradas</div>`
  const units = sales.lines.reduce((s, l) => s + l.quantity, 0)
  return [
    `<div class="sec">VENDIDO HOY</div>`,
    `<table><thead><tr><th>PRODUCTO</th><th class="q">CANT</th><th class="m">MONTO</th></tr></thead><tbody>`,
    sales.lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="q">${l.quantity}</td><td class="m">${amount(l.total)}</td></tr>`).join(""),
    `<tr class="tot"><td>TOTAL (${sales.ordersCount} pedidos)</td><td class="q">${units}</td><td class="m">${money(sales.totalAmount)}</td></tr>`,
    `</tbody></table>`,
  ].join("")
}

function tallyShell(title: string, body: string, cfg: TicketConfig) {
  const r = cfg.receipt
  return documentShell({
    title,
    paper: r.paper,
    fontScale: r.fontScale,
    fontFamily: r.fontFamily === "mono" ? MONO : SANS,
    css: TALLY_CSS,
    body,
  })
}

function tallyHeader(title: string, subtitle: string, meta: { storeName?: string; countedBy?: string; date: Date }) {
  return [
    `<div class="title">${esc(title)}</div>`,
    `<div class="sub">${esc(subtitle)}</div>`,
    meta.storeName ? `<div class="sub">${esc(meta.storeName)}</div>` : "",
    `<div class="sub">${esc(formatReceiptDateTime(meta.date))}</div>`,
    meta.countedBy ? `<div class="sub">${esc(meta.countedBy)}</div>` : "",
  ].join("")
}

/**
 * Ticket del cierre (comida rápida): lo vendido en el día, el conteo del
 * checklist y la lista POR COMPRAR con casillas para tachar al día siguiente.
 * Usa el papel y la letra de la nota de venta.
 */
export function renderStockCountHTML(
  lines: StockCountLine[],
  meta: { storeName?: string; countedBy?: string; date: Date },
  cfg: TicketConfig,
  sales?: SalesTallyPrint
): string {
  const byCategory = new Map<string, StockCountLine[]>()
  for (const l of lines) {
    const k = l.category || "OTROS"
    if (!byCategory.has(k)) byCategory.set(k, [])
    byCategory.get(k)!.push(l)
  }
  const toBuy = lines.filter((l) => l.toBuy)
  const count = Array.from(byCategory.entries())
    .map(
      ([cat, ls]) =>
        `<div class="cat">${esc(cat)}</div><table>${ls
          .map((l) => `<tr${l.counted <= 0 ? ' class="zero"' : ""}><td>${esc(l.name)}</td><td class="q">${l.counted}</td></tr>`)
          .join("")}</table>`
    )
    .join("")
  const buyList = toBuy.length
    ? `<div class="sec">POR COMPRAR (${toBuy.length})</div><table>${toBuy
        .map((l) => `<tr><td><span class="box"></span>${esc(l.name)}</td><td class="q">hay ${l.counted}</td></tr>`)
        .join("")}</table>`
    : `<div class="sec">NADA POR COMPRAR</div>`
  const body = [
    `<div class="r">`,
    tallyHeader("CIERRE DEL DÍA", "Ventas y conteo de stock", {
      ...meta,
      countedBy: meta.countedBy ? `Contó: ${meta.countedBy}` : undefined,
    }),
    sales ? salesSection(sales) : "",
    lines.length ? `<div class="sec">CONTEO DE STOCK</div>${count}` : "",
    lines.length ? buyList : "",
    lines.length ? `<div class="small">${lines.length} productos contados</div>` : "",
    `</div>`,
  ].join("\n")
  return tallyShell("Cierre del día", body, cfg)
}

/** Ticket solo con lo vendido hoy (se puede imprimir en cualquier momento del día). */
export function renderSalesTallyHTML(
  sales: SalesTallyPrint,
  meta: { storeName?: string; countedBy?: string; date: Date },
  cfg: TicketConfig
): string {
  const body = [`<div class="r">`, tallyHeader("VENDIDO HOY", "Desde la apertura de caja", meta), salesSection(sales), `</div>`].join("\n")
  return tallyShell("Vendido hoy", body, cfg)
}

// --- Vista previa y ventana de impresión ----------------------------------------

/** Pedido de ejemplo para la vista previa del panel de plataforma. */
export function sampleOrder(): Order {
  return {
    id: "id_mg8k2x_a1b2c3",
    storeId: "demo",
    orderType: "dine_in",
    tableNumber: 4,
    items: [
      { productId: "p1", productName: "Pizza Americana", variantName: "Familiar", quantity: 1, price: 27.9, cancelled: false, notes: "Sin orégano" },
      { productId: "p2", productName: "Gaseosa", variantName: "1 L", quantity: 2, price: 7, cancelled: false },
      { productId: "p3", productName: "Pan al ajo", variantName: "Especial", quantity: 1, price: 10.5, cancelled: false },
    ] as Order["items"],
    total: 52.4,
    status: "paid",
    paymentStatus: "paid",
    paymentMethod: "cash",
    createdAt: new Date() as unknown as Order["createdAt"],
    userName: "Carlos",
    cancelled: false,
  }
}

/**
 * Escribe el HTML en una ventana y lanza el diálogo de impresión cuando las
 * imágenes (logo) terminaron de cargar — si no, el logo puede salir en blanco.
 * `target` permite pasar una ventana abierta antes (en el click del usuario)
 * para que el navegador no la bloquee como popup tras un await.
 */
export function printHTML(html: string, target?: Window | null) {
  const w = target ?? window.open("", "_blank")
  if (!w) return
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.focus()
  const images = Array.from(w.document.images)
  const ready = Promise.all(
    images.map((img) =>
      img.complete ? Promise.resolve() : new Promise<void>((res) => { img.onload = img.onerror = () => res() })
    )
  )
  const timeout = new Promise<void>((res) => setTimeout(res, 2000))
  void Promise.race([ready, timeout]).then(() => setTimeout(() => w.print(), 150))
}
