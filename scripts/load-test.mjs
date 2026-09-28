/**
 * scripts/load-test.mjs
 * ---------------------------------------------------------------------------
 * Simula el uso real: una empresa DESECHABLE con N locales y M usuarios por
 * local. Cada usuario hace lo que hace el navegador: cada 3 s un request
 * `multi` con las suscripciones de pos-context; además un usuario por local
 * crea un pedido cada ~15 s y lo cobra (transacción) un rato después.
 * Cada local arranca con historial (pedidos pagados) para que las lecturas
 * no sean sobre tablas vacías. Al final borra todo.
 *
 * Uso: node --env-file=.env.local scripts/load-test.mjs [URL] [segundos] [locales] [usuarios_por_local] [historial_por_local]
 *      por defecto: http://localhost:3000 60 5 5 300
 * ---------------------------------------------------------------------------
 */
import pg from "pg"
import jwt from "jsonwebtoken"
import { randomBytes } from "node:crypto"
import { sqlCleanup } from "./lib/test-cleanup.mjs"

const [BASE_ARG, SECS = "60", STORES = "5", USERS = "5", HISTORY = "300"] = process.argv.slice(2)
const BASE = (BASE_ARG || "http://localhost:3000").replace(/\/$/, "")
const DURATION = Number(SECS) * 1000
const rnd = () => randomBytes(4).toString("hex")
const pw = () => randomBytes(15).toString("base64url")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
const owner = (await pool.query("select id, email from auth_accounts where is_platform_owner limit 1")).rows[0]
const ownerTok = jwt.sign({ accountId: owner.id, email: owner.email, isPlatformOwner: true }, process.env.AUTH_JWT_SECRET, { expiresIn: 3600 })

const stats = {}
function record(kind, ms, ok) {
  const s = (stats[kind] ||= { lat: [], errors: 0 })
  if (ok) s.lat.push(ms)
  else s.errors++
}
async function api(path, tok, body, method = "POST", kind) {
  const t0 = performance.now()
  let res, json
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: body ? JSON.stringify(body) : undefined,
    })
    json = await res.json().catch(() => ({}))
  } catch (e) {
    if (kind) record(kind, 0, false)
    return { status: 0, json: { error: String(e) } }
  }
  if (kind) record(kind, performance.now() - t0, res.ok || res.status === 409)
  return { status: res.status, json }
}

const NAME = `ZZ Prueba Carga ${rnd()}`
let companyId
try {
  console.log(`Preparando ${STORES} locales × ${USERS} usuarios contra ${BASE} ...`)
  const first = { email: `lt_l0_${rnd()}@test.invalid`, password: pw() }
  const c = await api("/api/platform/companies", ownerTok, {
    name: NAME,
    superAdmin: { email: `lt_sa_${rnd()}@test.invalid`, password: pw() },
    store: { name: "Carga 1", code: `C1${rnd().slice(0, 4).toUpperCase()}`, accountEmail: first.email, accountPassword: first.password },
  })
  if (c.status !== 200) throw new Error(`No se pudo crear la empresa: ${c.json.error}`)
  companyId = c.json.companyId
  const stores = [{ id: c.json.storeId, creds: first }]
  for (let i = 1; i < Number(STORES); i++) {
    const creds = { email: `lt_l${i}_${rnd()}@test.invalid`, password: pw() }
    const s = await api(`/api/platform/companies/${companyId}/stores`, ownerTok, {
      name: `Carga ${i + 1}`, code: `C${i + 1}${rnd().slice(0, 4).toUpperCase()}`, accountEmail: creds.email, accountPassword: creds.password,
    })
    if (s.status !== 200) throw new Error(`No se pudo crear el local ${i + 1}: ${s.json.error}`)
    stores.push({ id: s.json.storeId, creds })
  }
  for (const s of stores) s.token = (await api("/api/auth/login", "", s.creds)).json.token

  // Datos: productos, mesas, caja abierta y historial de pedidos pagados.
  for (const s of stores) {
    const cashRegisterId = `cr_${rnd()}`
    s.cashRegisterId = cashRegisterId
    const ops = [
      { type: "set", collection: "cashRegister", id: cashRegisterId, data: { storeId: s.id, status: "open", openedAt: new Date().toISOString() } },
      { type: "set", collection: "cashBoxBalances", id: `${s.id}_operational`, data: { storeId: s.id, balance: 100 } },
    ]
    for (let i = 0; i < 30; i++) ops.push({ type: "set", collection: "products", id: `p_${s.id}_${i}`, data: { storeId: s.id, name: `Producto ${i}`, price: 10 + i, available: true, active: true } })
    for (let i = 0; i < 15; i++) ops.push({ type: "set", collection: "tables", id: `t_${s.id}_${i}`, data: { storeId: s.id, number: i + 1, active: true, status: "available" } })
    for (let i = 0; i < Number(HISTORY); i++) {
      ops.push({ type: "set", collection: "orders", id: `h_${s.id}_${i}`, data: {
        storeId: s.id, paymentStatus: "paid", status: "closed", cashRegisterId: i < 20 ? cashRegisterId : "cr_viejo",
        createdAt: new Date(Date.now() - i * 600_000).toISOString(), total: 25,
        items: Array.from({ length: 4 }, (_, k) => ({ productId: `p_${s.id}_${k}`, name: `Producto ${k}`, qty: 1, price: 10 + k })),
      } })
    }
    for (let i = 0; i < ops.length; i += 100) {
      const r = await api("/api/db", s.token, { op: "batch", operations: ops.slice(i, i + 100) })
      if (r.status !== 200) throw new Error(`Carga de datos falló: ${r.json.error}`)
    }
  }
  console.log(`Datos listos (${Number(HISTORY)} pedidos de historial por local). Corriendo ${SECS} s ...`)

  const end = Date.now() + DURATION
  const reads = (s) => [
    { kind: "query", collection: "orders", where: [{ field: "storeId", op: "==", value: s.id }, { field: "paymentStatus", op: "==", value: "pending" }] },
    { kind: "query", collection: "tables", where: [{ field: "storeId", op: "==", value: s.id }] },
    { kind: "query", collection: "products", where: [{ field: "storeId", op: "==", value: s.id }, { field: "available", op: "==", value: true }] },
    { kind: "query", collection: "cashRegister", where: [{ field: "storeId", op: "==", value: s.id }, { field: "status", op: "==", value: "open" }] },
    { kind: "doc", collection: "cashBoxBalances", id: `${s.id}_operational` },
    { kind: "query", collection: "orders", where: [{ field: "storeId", op: "==", value: s.id }, { field: "paymentStatus", op: "==", value: "paid" }, { field: "cashRegisterId", op: "==", value: s.cashRegisterId }] },
  ]

  async function poller(s) {
    await sleep(Math.random() * 3000)
    const r = reads(s)
    const hashes = []
    while (Date.now() < end) {
      const t0 = Date.now()
      const res = await api("/api/db", s.token, { op: "multi", reads: r.map((x, i) => ({ ...x, hash: hashes[i] })) }, "POST", "lectura (multi)")
      res.json.results?.forEach((x, i) => { if (!x.unchanged) hashes[i] = x.hash })
      await sleep(Math.max(0, 3000 - (Date.now() - t0)))
    }
  }
  async function cashier(s) {
    await sleep(Math.random() * 5000)
    while (Date.now() < end) {
      const created = await api("/api/db", s.token, { op: "addDoc", collection: "orders", data: {
        storeId: s.id, paymentStatus: "pending", status: "open", createdAt: new Date().toISOString(), total: 30,
        items: [{ productId: `p_${s.id}_1`, name: "Producto 1", qty: 2, price: 15 }],
      } }, "POST", "crear pedido")
      await sleep(5000 + Math.random() * 5000)
      if (created.json.id) {
        const g = await api("/api/db", s.token, { op: "getDoc", collection: "orders", id: created.json.id }, "POST", "leer pedido")
        await api("/api/db", s.token, {
          op: "batch",
          operations: [
            { type: "update", collection: "orders", id: created.json.id, data: { paymentStatus: "paid", cashRegisterId: s.cashRegisterId } },
            { type: "update", collection: "cashBoxBalances", id: `${s.id}_operational`, data: { balance: 130 } },
          ],
          expectedVersions: [{ collection: "orders", id: created.json.id, version: g.json.version }],
        }, "POST", "cobrar (transacción)")
      }
      await sleep(3000 + Math.random() * 4000)
    }
  }

  const tasks = []
  for (const s of stores) {
    for (let u = 0; u < Number(USERS); u++) tasks.push(poller(s))
    tasks.push(cashier(s))
  }
  const t0 = Date.now()
  await Promise.all(tasks)
  const elapsed = (Date.now() - t0) / 1000

  const pct = (a, p) => (a.length ? Math.round(a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]) : 0)
  let total = 0
  console.log("")
  console.log("operación               | requests | errores | p50 ms | p95 ms | máx ms")
  console.log("------------------------|----------|---------|--------|--------|-------")
  for (const [k, s] of Object.entries(stats)) {
    total += s.lat.length + s.errors
    console.log(`${k.padEnd(24)}| ${String(s.lat.length + s.errors).padStart(8)} | ${String(s.errors).padStart(7)} | ${String(pct(s.lat, 0.5)).padStart(6)} | ${String(pct(s.lat, 0.95)).padStart(6)} | ${String(pct(s.lat, 1)).padStart(6)}`)
  }
  console.log(`\n${Number(STORES) * Number(USERS)} usuarios, ${total} requests en ${elapsed.toFixed(0)} s = ${(total / elapsed).toFixed(1)} requests/s`)
} finally {
  if (companyId) {
    const d = await api(`/api/platform/companies/${companyId}?confirm=${encodeURIComponent(NAME)}`, ownerTok, null, "DELETE")
    console.log(d.status === 200 ? `Empresa de prueba eliminada (${d.json.deletedDocuments} docs).` : `Borrado por API falló (${d.status}); se usa el respaldo SQL.`)
  }
  await sqlCleanup(pool)
  const left = (await pool.query("select (select count(*) from documents) d, (select count(*) from companies) c, (select count(*) from auth_accounts) a")).rows[0]
  console.log("base después de limpiar:", left)
  await pool.end()
}
