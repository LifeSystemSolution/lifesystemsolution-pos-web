/**
 * lib/print/ticket-render.ts
 * ---------------------------------------------------------------------------
 * HTML de impresión del recibo de venta y de la comanda de cocina según la
 * config de la empresa (lib/print/ticket-config.ts):
 *
 *   - Papel térmico (58/80 mm): ticket angosto en monoespaciado.
 *   - Hoja (A5/A4/Carta): documento con cabecera, tabla de productos y totales.
 *
 * Todo texto que viene de datos (productos, notas, nombres) se escapa: se
 * escribe con document.write en una ventana nueva.
 * ---------------------------------------------------------------------------
 */
import type { Order, Store } from "@/lib/firebase/firestore"
import { formatPeruTime, formatReceiptDateTime, toPeruDate } from "@/lib/utils"
import {
  FONT_SCALE_FACTOR,
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

const money = (n: number) => `S/ ${(Number(n) || 0).toFixed(2)}`

const PAYMENT_LABELS: Record<string, string> = {
  cash: "EFECTIVO",
  card: "TARJETA",
  yape: "YAPE",
  plin: "PLIN",
  transfer: "TRANSFERENCIA",
  mixed: "MIXTO",
}

function orderNumber(order: Order) {
  return String(order.id || "").substring(0, 5).toUpperCase().padEnd(5, "0")
}

function tableLabel(order: Order) {
  return order.orderType === "takeout" || order.tableNumber == null
    ? "PARA LLEVAR"
    : `Mesa ${String(order.tableNumber).padStart(2, "0")}`
}

function itemLabel(item: Order["items"][number]) {
  return `${item.productName}${item.variantName ? ` ${item.variantName}` : ""}`
}

function documentShell(title: string, paper: PaperSize, fontScale: FontScale, css: string, body: string) {
  const spec = PAPER_SPECS[paper]
  const f = FONT_SCALE_FACTOR[fontScale]
  const width = spec.thermal ? `${spec.widthMm}mm` : "auto"
  const pageMargin = spec.thermal ? "0" : "12mm"
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root { --f: ${f}; }
  body { width: ${width}; margin: 0 auto; background: #fff; color: #000; line-height: 1.35;
         font-size: calc(${spec.thermal ? 11 : 12}px * var(--f)); }
  @page { size: ${spec.page}; margin: ${pageMargin}; }
  @media print { body { margin: 0; } }
  .center { text-align: center; } .right { text-align: right; } .bold { font-weight: bold; }
  ${css}
</style>
</head>
<body>${body}</body>
</html>`
}

function headerLines(cfg: TicketConfig, store?: StoreLike) {
  const b = cfg.business
  return {
    name: b.name.trim() || store?.name || "",
    details: [
      b.ruc.trim() && `RUC: ${b.ruc.trim()}`,
      b.address.trim(),
      b.phone.trim() && `Tel: ${b.phone.trim()}`,
      ...lines(b.extraLines),
    ].filter(Boolean) as string[],
  }
}

const THERMAL_CSS = `
  body { font-family: 'Courier New', monospace; }
  .ticket { padding: 4mm 3mm; }
  .big { font-size: calc(14px * var(--f)); font-weight: bold; }
  .huge { font-size: calc(18px * var(--f)); font-weight: bold; }
  .sep { border-top: 1px dashed #000; margin: 2mm 0; }
  .sep.solid { border-top: 1px solid #000; }
  .row { display: flex; justify-content: space-between; gap: 2mm; }
  .row > span:last-child { white-space: nowrap; }
  .item { margin: 1mm 0; }
  .note { padding-left: 3mm; font-style: italic; }
  .gap { height: 2mm; }
`

const PAGE_CSS = `
  body { font-family: Arial, Helvetica, sans-serif; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; margin-bottom: 6mm; }
  .biz-name { font-size: calc(20px * var(--f)); font-weight: bold; }
  .muted { color: #333; }
  .box { border: 1.5px solid #000; border-radius: 3px; padding: 3mm 5mm; text-align: center; min-width: 45mm; }
  .box .title { font-weight: bold; font-size: calc(14px * var(--f)); }
  .info { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1mm 8mm; margin-bottom: 5mm; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4mm; }
  th { text-align: left; border-bottom: 1.5px solid #000; padding: 1.5mm 1mm; font-size: calc(11px * var(--f)); }
  td { border-bottom: 1px solid #ccc; padding: 1.5mm 1mm; vertical-align: top; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .note { font-size: calc(10.5px * var(--f)); font-style: italic; color: #333; }
  .totals { margin-left: auto; width: 70mm; max-width: 60%; }
  .totals .row { display: flex; justify-content: space-between; padding: 1mm 0; }
  .totals .grand { border-top: 1.5px solid #000; font-weight: bold; font-size: calc(15px * var(--f)); margin-top: 1mm; padding-top: 2mm; }
  .footer { margin-top: 8mm; text-align: center; }
`

export function renderReceiptHTML(order: Order, store: StoreLike | undefined, cfg: TicketConfig): string {
  const r = cfg.receipt
  const items = order.items.filter((i) => !i.cancelled)
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0)
  const head = headerLines(cfg, store)
  const payment =
    PAYMENT_LABELS[order.paymentMethod || ""] ||
    (order.paymentMethod ? String(order.paymentMethod).toUpperCase() : "NO ESPECIFICADO")
  const notes = r.showNotes ? items.filter((i) => i.notes) : []
  const footer = lines(r.footerText)
  const estimated = r.showEstimatedTime && r.estimatedTimeText.trim()

  const info: [string, string][] = []
  if (r.showStoreName && store?.name && store.name !== head.name) info.push(["Local", store.name])
  if (r.showOrderNumber) info.push(["Pedido #", orderNumber(order)])
  if (r.showTable) info.push(["Mesa", tableLabel(order)])
  if (r.showDateTime) info.push(["Fecha", formatReceiptDateTime(order.createdAt)])
  if (r.showWaiter && order.userName) info.push(["Atendido por", order.userName])

  if (PAPER_SPECS[r.paper].thermal) {
    const itemsHtml = items
      .map((i) => {
        const unit = i.quantity > 1 ? `${esc(money(i.price))} c/u` : ""
        return `<div class="item"><div>${i.quantity}x ${esc(itemLabel(i))}</div><div class="row"><span>${unit}</span><span>${esc(money(i.price * i.quantity))}</span></div></div>`
      })
      .join("")
    const notesHtml = notes.length
      ? `<div class="sep"></div><div class="bold">OBSERVACIONES:</div>` +
        notes.map((i) => `<div class="note">* ${esc(i.productName)}: ${esc(i.notes)}</div>`).join("")
      : ""
    const body = [
      `<div class="ticket">`,
      head.name ? `<div class="center huge">${esc(head.name)}</div>` : "",
      head.details.map((l) => `<div class="center">${esc(l)}</div>`).join(""),
      `<div class="sep solid"></div>`,
      r.title.trim() ? `<div class="center big">${esc(r.title)}</div>` : "",
      info.map(([k, v]) => `<div>${esc(k)}: ${esc(v)}</div>`).join(""),
      `<div class="sep"></div>`,
      itemsHtml,
      notesHtml,
      `<div class="sep"></div>`,
      r.showSubtotals ? `<div class="row"><span>Subtotal</span><span>${money(subtotal)}</span></div>` : "",
      `<div class="row big"><span>TOTAL</span><span>${money(order.total)}</span></div>`,
      r.showPaymentMethod
        ? `<div class="gap"></div><div class="row"><span>Pago</span><span class="bold">${esc(payment)}</span></div>`
        : "",
      estimated ? `<div class="sep"></div><div class="center">Tiempo estimado: ${esc(r.estimatedTimeText)}</div>` : "",
      footer.length
        ? `<div class="sep solid"></div>` + footer.map((l) => `<div class="center bold">${esc(l)}</div>`).join("")
        : "",
      `</div>`,
    ].join("\n")
    return documentShell(r.title || "Recibo", r.paper, r.fontScale, THERMAL_CSS, body)
  }

  // Hoja: A5 / A4 / Carta
  const rows = items
    .map((i) => {
      const note = r.showNotes && i.notes ? `<div class="note">${esc(i.notes)}</div>` : ""
      return `<tr><td class="num">${i.quantity}</td><td>${esc(itemLabel(i))}${note}</td><td class="num">${money(i.price)}</td><td class="num">${money(i.price * i.quantity)}</td></tr>`
    })
    .join("")
  const body = [
    `<div class="doc"><div class="top"><div>`,
    head.name ? `<div class="biz-name">${esc(head.name)}</div>` : "",
    head.details.map((l) => `<div class="muted">${esc(l)}</div>`).join(""),
    `</div><div class="box">`,
    r.title.trim() ? `<div class="title">${esc(r.title)}</div>` : "",
    r.showOrderNumber ? `<div>N° ${esc(orderNumber(order))}</div>` : "",
    `</div></div>`,
    `<div class="info">`,
    info
      .filter(([k]) => k !== "Pedido #")
      .map(([k, v]) => `<div><span class="bold">${esc(k)}:</span> ${esc(v)}</div>`)
      .join(""),
    `</div>`,
    `<table><thead><tr><th class="num" style="width:14mm">Cant.</th><th>Descripción</th><th class="num" style="width:26mm">P. Unit.</th><th class="num" style="width:28mm">Importe</th></tr></thead><tbody>${rows}</tbody></table>`,
    `<div class="totals">`,
    r.showSubtotals ? `<div class="row"><span>Subtotal</span><span>${money(subtotal)}</span></div>` : "",
    `<div class="row grand"><span>TOTAL</span><span>${money(order.total)}</span></div>`,
    r.showPaymentMethod
      ? `<div class="row"><span>Forma de pago</span><span class="bold">${esc(payment)}</span></div>`
      : "",
    `</div>`,
    estimated ? `<div class="center" style="margin-top:4mm">Tiempo estimado: ${esc(r.estimatedTimeText)}</div>` : "",
    footer.length ? `<div class="footer">${footer.map((l) => `<div class="bold">${esc(l)}</div>`).join("")}</div>` : "",
    `</div>`,
  ].join("\n")
  return documentShell(r.title || "Recibo", r.paper, r.fontScale, PAGE_CSS, body)
}

export function renderKitchenHTML(order: Order, store: StoreLike | undefined, cfg: TicketConfig): string {
  const k = cfg.kitchen
  const thermal = PAPER_SPECS[k.paper].thermal
  const minutesOld = Math.floor((Date.now() - toPeruDate(order.createdAt).getTime()) / 60000)
  const css = `
  body { font-family: ${thermal ? "'Courier New', monospace" : "Arial, Helvetica, sans-serif"}; }
  .ticket { padding: ${thermal ? "4mm 3mm" : "0"}; }
  .title { font-size: calc(15px * var(--f)); font-weight: bold; text-align: center; }
  .table { font-size: calc(22px * var(--f)); font-weight: bold; text-align: center; margin: 2mm 0; }
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
    `<div class="table">${esc(tableLabel(order))}</div>`,
    k.showTime ? `<div class="center">Hora: ${esc(formatPeruTime(order.createdAt))}</div>` : "",
    k.showWaiter && order.userName ? `<div class="center">Mesero: ${esc(order.userName)}</div>` : "",
    `<div class="sep"></div>`,
    itemsHtml,
    k.showLateWarning && minutesOld > 10 ? `<div class="late">PEDIDO ATRASADO (${minutesOld} min)</div>` : "",
    `<div class="small">Impreso: ${esc(new Date().toLocaleTimeString("es-PE"))}</div>`,
    `</div>`,
  ].join("\n")
  return documentShell("Comanda", k.paper, k.fontScale, css, body)
}

/** Pedido de ejemplo para la vista previa del panel de plataforma. */
export function sampleOrder(): Order {
  return {
    id: "A1B2C3",
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
 * Escribe el HTML en una ventana y lanza el diálogo de impresión. `target`
 * permite pasar una ventana abierta antes (en el click del usuario) para que
 * el navegador no la bloquee como popup tras un await.
 */
export function printHTML(html: string, target?: Window | null) {
  const w = target ?? window.open("", "_blank")
  if (!w) return
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 300)
}
