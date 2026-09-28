/**
 * scripts/smoke-test.mjs
 * ---------------------------------------------------------------------------
 * Prueba de punta a punta contra un servidor corriendo (local o Vercel):
 * crea una empresa DESECHABLE con 2 locales desde /plataforma, prueba login,
 * ventas, lecturas agrupadas (multi), transacciones, aislamiento entre
 * locales y permisos, y al final la elimina (con respaldo por SQL si la API
 * falla). No usa la contraseña del dueño: firma un token con AUTH_JWT_SECRET.
 *
 * Uso: node --env-file=.env.local scripts/smoke-test.mjs [URL]
 *      (URL por defecto http://localhost:3000)
 * ---------------------------------------------------------------------------
 */
import pg from "pg"
import jwt from "jsonwebtoken"
import { randomBytes } from "node:crypto"
import { sqlCleanup } from "./lib/test-cleanup.mjs"
const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "")
const ok = (c, m) => { console.log((c ? "ok: " : "FALLA: ") + m); if (!c) process.exitCode = 1 }
const rnd = () => randomBytes(4).toString("hex")
const pw = () => randomBytes(15).toString("base64url")
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
const owner = (await pool.query("select id, email from auth_accounts where is_platform_owner limit 1")).rows[0]
const ownerTok = jwt.sign({ accountId: owner.id, email: owner.email, isPlatformOwner: true }, process.env.AUTH_JWT_SECRET, { expiresIn: 600 })
const api = async (path, tok, body, method = "POST") => {
  const t0 = performance.now()
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` }, body: body ? JSON.stringify(body) : undefined })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json, ms: Math.round(performance.now() - t0) }
}
const db = (tok, body) => api("/api/db", tok, body)
const NAME = `ZZ Prueba Tecnica ${rnd()}`


let companyId
try {
  const h = await fetch(BASE + "/api/health/database").then(r => r.json())
  ok(h.ok === true, "health: base conectada")

  const creds = { sa: { email: `sa_${rnd()}@test.invalid`, password: pw() }, l1: { email: `l1_${rnd()}@test.invalid`, password: pw() }, l2: { email: `l2_${rnd()}@test.invalid`, password: pw() } }
  const c = await api("/api/platform/companies", ownerTok, { name: NAME, superAdmin: creds.sa, store: { name: "Local Prueba 1", accountEmail: creds.l1.email, accountPassword: creds.l1.password } })
  ok(c.status === 200 && c.json.companyId, `crear empresa desde plataforma (${c.status}) ${c.json.error || ""}`)
  companyId = c.json.companyId
  const s1 = c.json.storeId
  const s2r = await api(`/api/platform/companies/${companyId}/stores`, ownerTok, { name: "Local Prueba 2", code: `LP2${rnd().slice(0,3).toUpperCase()}`, accountEmail: creds.l2.email, accountPassword: creds.l2.password })
  ok(s2r.status === 200, `crear segundo local (${s2r.status}) ${s2r.json.error || ""}`)
  const s2 = s2r.json.storeId

  const login = async (cr) => (await api("/api/auth/login", "", cr)).json
  const L1 = await login(creds.l1), L2 = await login(creds.l2), SA = await login(creds.sa)
  ok(L1.token && L1.storeId === s1, "login cuenta de local 1 (atada a su local)")
  ok(SA.token && SA.storeId === null, "login cuenta de empresa (super admin)")

  // Datos de trabajo
  let r = await db(L1.token, { op: "setDoc", collection: "products", id: `p_${rnd()}`, data: { storeId: s1, name: "Pizza Test", available: true, active: true, price: 20 } })
  ok(r.status === 200, `local 1 crea producto (${r.status}) ${r.json.error || ""}`)
  r = await db(L1.token, { op: "addDoc", collection: "orders", data: { storeId: s1, paymentStatus: "pending", status: "open", createdAt: new Date().toISOString(), total: 20 } })
  ok(r.status === 200 && r.json.id, "local 1 crea pedido")
  const orderId = r.json.id
  r = await db(L2.token, { op: "addDoc", collection: "orders", data: { storeId: s2, paymentStatus: "pending", status: "open", createdAt: new Date().toISOString(), total: 99 } })
  ok(r.status === 200, "local 2 crea pedido")

  // Polling agrupado (lo que manda pos-context)
  const reads = [
    { kind: "query", collection: "orders", where: [{ field: "storeId", op: "==", value: s1 }, { field: "paymentStatus", op: "==", value: "pending" }] },
    { kind: "query", collection: "products", where: [{ field: "storeId", op: "==", value: s1 }, { field: "available", op: "==", value: true }] },
    { kind: "query", collection: "tables", where: [{ field: "storeId", op: "==", value: s1 }] },
    { kind: "doc", collection: "cashBoxBalances", id: `${s1}_operational` },
  ]
  const m1 = await db(L1.token, { op: "multi", reads })
  ok(m1.status === 200 && m1.json.results.length === 4, `multi: 4 lecturas en 1 request (${m1.ms} ms)`)
  ok(m1.json.results[0].docs.length === 1 && m1.json.results[0].docs[0].id === orderId, "multi: solo el pedido pendiente del local 1")
  const m2 = await db(L1.token, { op: "multi", reads: reads.map((x, i) => ({ ...x, hash: m1.json.results[i].hash })) })
  ok(m2.json.results.every((x) => x.unchanged), `multi con hash: todo "unchanged" (${m2.ms} ms, ${JSON.stringify(m2.json).length} bytes)`)

  // Aislamiento entre locales
  const spy = await db(L1.token, { op: "getDocs", collection: "orders", where: [{ field: "storeId", op: "==", value: s2 }] })
  ok(spy.status === 200 && spy.json.docs.length === 0, "local 1 NO ve pedidos del local 2 aunque los pida")
  const spyAll = await db(L1.token, { op: "getDocs", collection: "orders" })
  ok(spyAll.json.docs.every((d) => d.data.storeId === s1), "local 1 sin filtros solo ve su local")
  const w = await db(L1.token, { op: "setDoc", collection: "orders", id: "hack", data: { storeId: s2 } })
  ok(w.status === 403, `local 1 NO puede escribir en el local 2 (${w.status})`)
  const saAll = await db(SA.token, { op: "getDocs", collection: "orders" })
  ok(saAll.json.docs.length === 2, "super admin ve los pedidos de ambos locales")

  // Transacción optimista (runTransaction): versión correcta y versión vieja
  const g = await db(L1.token, { op: "getDoc", collection: "orders", id: orderId })
  const t1 = await db(L1.token, { op: "batch", operations: [{ type: "update", collection: "orders", id: orderId, data: { paymentStatus: "paid" } }], expectedVersions: [{ collection: "orders", id: orderId, version: g.json.version }] })
  ok(t1.status === 200, "transacción con versión vigente: se confirma")
  const t2 = await db(L1.token, { op: "batch", operations: [{ type: "update", collection: "orders", id: orderId, data: { total: 1 } }], expectedVersions: [{ collection: "orders", id: orderId, version: g.json.version }] })
  ok(t2.status === 409, `transacción con versión vieja: conflicto 409 (${t2.status})`)
  const m3 = await db(L1.token, { op: "multi", reads: reads.map((x, i) => ({ ...x, hash: m1.json.results[i].hash })) })
  ok(!m3.json.results[0].unchanged && m3.json.results[0].docs.length === 0, "multi detecta el cambio: el pedido pagado sale de pendientes")

  // Permisos estructurales
  const u = await db(SA.token, { op: "addDoc", collection: "stores", data: { name: "x" } })
  ok(u.status === 403, "super admin no puede crear locales por /api/db (solo plataforma)")
} finally {
  if (companyId) {
    const d = await api(`/api/platform/companies/${companyId}?confirm=${encodeURIComponent(NAME)}`, ownerTok, null, "DELETE")
    ok(d.status === 200, `empresa de prueba eliminada por la API (${d.json.deletedDocuments} docs, ${d.json.deletedAccounts} cuentas)`)
  }
  await sqlCleanup(pool)
  const left = (await pool.query("select (select count(*) from documents) d, (select count(*) from companies) c, (select count(*) from auth_accounts) a")).rows[0]
  console.log("base después de limpiar:", left)
  await pool.end()
}
