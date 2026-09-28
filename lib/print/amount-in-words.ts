/**
 * lib/print/amount-in-words.ts
 * ---------------------------------------------------------------------------
 * Importe en letras para comprobantes peruanos:
 *   52.4  → "CINCUENTA Y DOS CON 40/100 SOLES"
 *   1     → "UNO CON 00/100 SOLES"
 *   21000 → "VEINTIÚN MIL CON 00/100 SOLES"
 * Soporta hasta 999 999 999.99.
 * ---------------------------------------------------------------------------
 */

const UNITS = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"]
const UNDER_30 = [
  "", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
  "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve",
  "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve",
]
const TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"]
const HUNDREDS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
  "seiscientos", "setecientos", "ochocientos", "novecientos",
]

/** apocope: "uno" → "un" / "veintiuno" → "veintiún" (antes de "mil" o "millones"). */
function under100(n: number, apocope: boolean): string {
  if (n < 30) {
    if (apocope && n === 1) return "un"
    if (apocope && n === 21) return "veintiún"
    return UNDER_30[n]
  }
  const t = Math.floor(n / 10)
  const u = n % 10
  if (u === 0) return TENS[t]
  return `${TENS[t]} y ${apocope && u === 1 ? "un" : UNITS[u]}`
}

function under1000(n: number, apocope: boolean): string {
  if (n === 0) return ""
  if (n === 100) return "cien"
  const h = Math.floor(n / 100)
  const r = n % 100
  return [HUNDREDS[h], r ? under100(r, apocope) : ""].filter(Boolean).join(" ")
}

export function integerToWords(n: number): string {
  if (n === 0) return "cero"
  const millions = Math.floor(n / 1_000_000)
  const thousands = Math.floor((n % 1_000_000) / 1000)
  const rest = n % 1000
  const parts: string[] = []
  if (millions) parts.push(millions === 1 ? "un millón" : `${under1000(millions, true)} millones`)
  if (thousands) parts.push(thousands === 1 ? "mil" : `${under1000(thousands, true)} mil`)
  if (rest) parts.push(under1000(rest, false))
  return parts.join(" ")
}

export function amountInWords(amount: number, currency = "SOLES"): string {
  const cents = Math.round((Number(amount) || 0) * 100)
  const safe = Math.max(0, Math.min(cents, 99_999_999_999))
  const integer = Math.floor(safe / 100)
  const decimals = String(safe % 100).padStart(2, "0")
  return `${integerToWords(integer)} con ${decimals}/100 ${currency}`.toUpperCase()
}
