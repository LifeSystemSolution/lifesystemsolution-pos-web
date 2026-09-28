/**
 * lib/local/firebase-shim/firestore.ts
 * ---------------------------------------------------------------------------
 * Reemplazo de "firebase/firestore", respaldado por Postgres (Supabase) a
 * través de app/api/db/route.ts. Implementa el mismo subconjunto de la API
 * que usa lib/firebase/firestore.ts (doc, collection, query, where,
 * onSnapshot, runTransaction...) para que ese archivo de ~4500 líneas de
 * lógica de negocio no necesite cambios más allá de su import.
 *
 * Adaptado de lifesystem-pos-desktop/lib/local/firebase-shim/firestore.ts.
 * Dos diferencias respecto a esa versión (pensada para una sola PC en LAN):
 *
 *   1. Cada request lleva el token de sesión propio (Authorization: Bearer,
 *      emitido por app/api/auth/login — ver lib/local/session.ts), porque
 *      el servidor necesita saber de qué EMPRESA (y, si es cuenta de local,
 *      de qué LOCAL) son los datos que está pidiendo — ver
 *      app/api/db/route.ts y lib/local/db-access-policy.ts.
 *   2. onSnapshot hace polling cada 3s (ver la nota en esa función más abajo
 *      sobre por qué no es SSE/Realtime, a pesar de que se intentó).
 * ---------------------------------------------------------------------------
 */
import { getStoredSession, clearStoredSession } from "@/lib/local/session"

// Si el dueño de la plataforma desactiva una cuenta/empresa mientras hay
// una sesión abierta, el servidor responde 403 con este código en cada
// request: se cierra la sesión una sola vez y se vuelve al login. Lo mismo si
// la cuenta ya no existe (`no_company`: empresa borrada, o sesión guardada de
// otra base de datos), pero sin el aviso de "cuenta desactivada".
let disabledRedirectStarted = false
function handleDisabledSession(target = "/?disabled=1") {
  if (disabledRedirectStarted || typeof window === "undefined") return
  disabledRedirectStarted = true
  clearStoredSession()
  try {
    localStorage.removeItem("pos_operative_unlock")
  } catch {}
  window.location.href = target
}

class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConflictError"
  }
}

function getAuthHeader(): Record<string, string> {
  const session = getStoredSession()
  if (!session) throw new Error("No hay sesión activa")
  return { Authorization: `Bearer ${session.token}` }
}

async function callApi(body: Record<string, any>) {
  const authHeader = await getAuthHeader()
  const res = await fetch("/api/db", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    if (res.status === 409) throw new ConflictError(err.mensaje || "Conflicto de concurrencia")
    if (res.status === 403 && (err.code === "account_disabled" || err.code === "company_disabled")) {
      handleDisabledSession()
    }
    if (res.status === 403 && err.code === "no_company") handleDisabledSession("/")
    throw new Error(err.error || err.mensaje || `Error de base de datos (${res.status})`)
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Timestamp / serverTimestamp / arrayUnion
// ---------------------------------------------------------------------------
export class Timestamp {
  seconds: number
  nanoseconds: number
  constructor(seconds: number, nanoseconds = 0) {
    this.seconds = seconds
    this.nanoseconds = nanoseconds
  }
  toDate(): Date {
    return new Date(this.seconds * 1000)
  }
  toMillis(): number {
    return this.seconds * 1000
  }
  static now(): Timestamp {
    return new Timestamp(Math.floor(Date.now() / 1000), (Date.now() % 1000) * 1e6)
  }
  static fromDate(date: Date): Timestamp {
    return new Timestamp(Math.floor(date.getTime() / 1000))
  }
}

export function serverTimestamp() {
  return Timestamp.now()
}

const ARRAY_UNION = Symbol("arrayUnion")
export function arrayUnion(...items: any[]) {
  return { [ARRAY_UNION]: true, items }
}

function resolveWrite(data: Record<string, any>) {
  const out: Record<string, any> = {}
  for (const k in data) {
    const v = data[k]
    if (v instanceof Timestamp) out[k] = v.toDate().toISOString()
    else if (v && typeof v === "object" && v[ARRAY_UNION]) out[k] = v.items
    else out[k] = v
  }
  return out
}

// ---------------------------------------------------------------------------
// Referencias (doc / collection)
// ---------------------------------------------------------------------------
type CollectionRef = { __kind: "collection"; name: string }
type DocRef = { __kind: "doc"; name: string; id: string }
type QueryRef = { __kind: "query"; name: string; constraints: QueryConstraint[] }

function genId(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

export function collection(_db: any, name: string): CollectionRef {
  return { __kind: "collection", name }
}

export function doc(dbOrRef: any, ...rest: any[]): DocRef {
  if (dbOrRef && dbOrRef.__kind === "collection") {
    return { __kind: "doc", name: dbOrRef.name, id: rest[0] ?? genId() }
  }
  const [collectionName, id] = rest
  return { __kind: "doc", name: collectionName, id: id ?? genId() }
}

// ---------------------------------------------------------------------------
// Query constraints
// ---------------------------------------------------------------------------
export type QueryConstraint =
  | { __kind: "where"; field: string; op: string; value: any }
  | { __kind: "orderBy"; field: string; direction: "asc" | "desc" }
  | { __kind: "limit"; count: number }

export function where(field: string, op: string, value: any): QueryConstraint {
  return { __kind: "where", field, op, value }
}
export function orderBy(field: string, direction: "asc" | "desc" = "asc"): QueryConstraint {
  return { __kind: "orderBy", field, direction }
}
export function limit(count: number): QueryConstraint {
  return { __kind: "limit", count }
}
export function query(ref: CollectionRef, ...constraints: QueryConstraint[]): QueryRef {
  return { __kind: "query", name: ref.name, constraints }
}

function queryBody(ref: CollectionRef | QueryRef) {
  const constraints = ref.__kind === "query" ? ref.constraints : []
  const whereC = constraints.filter((c): c is Extract<QueryConstraint, { __kind: "where" }> => c.__kind === "where")
  const orderC = constraints.find((c): c is Extract<QueryConstraint, { __kind: "orderBy" }> => c.__kind === "orderBy")
  const limitC = constraints.find((c): c is Extract<QueryConstraint, { __kind: "limit" }> => c.__kind === "limit")
  return {
    collection: ref.name,
    where: whereC.map(({ field, op, value }) => ({ field, op, value })),
    orderBy: orderC ? { field: orderC.field, direction: orderC.direction } : undefined,
    limit: limitC ? limitC.count : undefined,
  }
}

// ---------------------------------------------------------------------------
// Revivir fechas — ver la nota equivalente en la versión desktop. El
// repositorio original espera Timestamps reales de Firestore (.toDate()/
// .toMillis()); acá se guardan como string ISO y se "reviven" al leer.
// ---------------------------------------------------------------------------
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

function reviveDates(value: any): any {
  if (value === null || value === undefined) return value
  if (typeof value === "string") {
    if (!ISO_DATE_RE.test(value)) return value
    const ms = Date.parse(value)
    if (Number.isNaN(ms)) return value
    // eslint-disable-next-line no-new-wrappers
    return Object.assign(new String(value), {
      toDate: () => new Date(ms),
      toMillis: () => ms,
      seconds: Math.floor(ms / 1000),
      nanoseconds: 0,
    })
  }
  if (Array.isArray(value)) return value.map(reviveDates)
  if (typeof value === "object") {
    const out: Record<string, any> = {}
    for (const k in value) out[k] = reviveDates(value[k])
    return out
  }
  return value
}

// ---------------------------------------------------------------------------
// Snapshots
//
// Un solo tipo cubre doc snapshot Y query snapshot a la vez (con las
// propiedades que no aplican en cada caso simplemente vacías/no usadas) — es
// menos "puro" que los dos tipos separados que tiene el SDK real, pero deja
// que TypeScript infiera `doc`/`a`/`b`/etc. en los `.docs.map(...)` de
// lib/firebase/firestore.ts sin tener que anotar esas ~4500 líneas a mano
// (con `onNext: (snap: any) => void` esa inferencia no fluye, y todo
// `snapshot.docs.map((doc) => ...)` queda como implicit-any bajo `strict`).
// ---------------------------------------------------------------------------
export interface SnapshotLike {
  id: string
  exists: () => boolean
  data: () => any
  docs: SnapshotLike[]
  empty: boolean
  size: number
  forEach: (cb: (d: SnapshotLike) => void) => void
  __version?: number | null
}

function makeDocSnapshot(id: string, exists: boolean, data: any, version: number | null = null): SnapshotLike {
  const revived = exists ? reviveDates(data) : undefined
  return {
    id,
    exists: () => exists,
    data: () => revived,
    __version: version,
    docs: [],
    empty: true,
    size: 0,
    forEach: () => {},
  }
}

function makeQuerySnapshot(docs: { id: string; data: any }[]): SnapshotLike {
  const wrapped = docs.map((d) => makeDocSnapshot(d.id, true, d.data))
  return {
    id: "",
    exists: () => false,
    data: () => undefined,
    docs: wrapped,
    empty: wrapped.length === 0,
    size: wrapped.length,
    forEach(cb) {
      wrapped.forEach(cb)
    },
  }
}

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------
export async function getDoc(ref: DocRef): Promise<SnapshotLike> {
  const res = await callApi({ op: "getDoc", collection: ref.name, id: ref.id })
  return makeDocSnapshot(ref.id, res.exists, res.data, res.version ?? null)
}

export async function getDocs(ref: CollectionRef | QueryRef): Promise<SnapshotLike> {
  const res = await callApi({ op: "getDocs", ...queryBody(ref) })
  return makeQuerySnapshot(res.docs)
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------
export async function setDoc(ref: DocRef, data: Record<string, any>, options?: { merge?: boolean }) {
  await callApi({ op: "setDoc", collection: ref.name, id: ref.id, data: resolveWrite(data), merge: !!options?.merge })
}

export async function updateDoc(ref: DocRef, data: Record<string, any>) {
  await callApi({ op: "updateDoc", collection: ref.name, id: ref.id, data: resolveWrite(data) })
}

export async function deleteDoc(ref: DocRef) {
  await callApi({ op: "deleteDoc", collection: ref.name, id: ref.id })
}

export async function addDoc(ref: CollectionRef, data: Record<string, any>) {
  const res = await callApi({ op: "addDoc", collection: ref.name, data: resolveWrite(data) })
  return { id: res.id, name: ref.name } as DocRef & { name: string }
}

// ---------------------------------------------------------------------------
// onSnapshot — polling, no SSE.
//
// Hubo una versión con relay SSE contra /api/realtime (Supabase Realtime).
// Funcionaba local, pero en Vercel las funciones serverless con runtime
// "nodejs" no sostienen un WebSocket saliente + una respuesta en streaming
// indefinida desde dentro de la función: en producción no llegaba ni la
// cabecera de la respuesta (probado con curl -N, 0 bytes en 8s). Es una
// limitación de la plataforma, no un bug de este archivo — para resolverlo
// de verdad haría falta Edge Runtime o un servicio de relay aparte, no
// serverless. Mientras tanto, polling: menos instantáneo, pero es un
// fetch corto y normal, funciona igual en local, Vercel, o cualquier otro
// hosting serverless. El relay (app/api/realtime/route.ts) se eliminó el
// 2026-09-19: era código muerto y, con cuentas atadas a un local, habría
// filtrado eventos de todos los locales de la empresa (ver
// docs/PLATFORM_OWNER.md). Si se retoma el relay, tiene que aplicar
// lib/local/db-access-policy.ts igual que /api/db.
// ---------------------------------------------------------------------------
//
// Todas las suscripciones activas de la pestaña se agrupan en UN solo
// request `multi` por ciclo (antes: un request por suscripción cada 3 s —
// ~6 por usuario solo en pos-context). Además:
//   - Dos suscripciones a la misma query comparten una sola lectura.
//   - El servidor devuelve `unchanged` si el hash del resultado no cambió,
//     así no viajan los mismos datos una y otra vez.
//   - Con la pestaña oculta se consulta cada 30 s en vez de cada 3 s; al
//     volver a la pestaña se consulta al tiro.
// ---------------------------------------------------------------------------
const POLL_INTERVAL_MS = 3000 // WAN, no LAN — más espaciado que los 2s del desktop
const HIDDEN_POLL_INTERVAL_MS = 30_000
const FIRST_READ_DELAY_MS = 30 // junta las suscripciones que se abren en el mismo render

type SnapshotListener = { onNext: (snap: SnapshotLike) => void; onError?: (err: any) => void }
type PollRead =
  | { kind: "doc"; collection: string; id: string }
  | ({ kind: "query" } & ReturnType<typeof queryBody>)
type PollEntry = {
  read: PollRead
  listeners: Set<SnapshotListener>
  hash?: string
  last?: { exists?: boolean; data?: any; version?: number | null; docs?: { id: string; data: any }[] }
}

const pollEntries = new Map<string, PollEntry>()
let pollTimer: ReturnType<typeof setTimeout> | undefined
let pollDueAt = Infinity
let pollInFlight = false
let pollAgainAfterFlight = false
let visibilityHooked = false

function snapshotFor(entry: PollEntry): SnapshotLike {
  const last = entry.last!
  return entry.read.kind === "doc"
    ? makeDocSnapshot(entry.read.id, !!last.exists, last.data, last.version ?? null)
    : makeQuerySnapshot(last.docs || [])
}

function isPageHidden() {
  return typeof document !== "undefined" && document.visibilityState === "hidden"
}

function schedulePoll(delay: number) {
  const due = Date.now() + delay
  if (pollTimer && pollDueAt <= due) return
  if (pollTimer) clearTimeout(pollTimer)
  pollDueAt = due
  pollTimer = setTimeout(runPoll, delay)
}

async function runPoll() {
  pollTimer = undefined
  pollDueAt = Infinity
  if (pollEntries.size === 0) return
  if (pollInFlight) {
    pollAgainAfterFlight = true
    return
  }
  pollInFlight = true
  const batch = Array.from(pollEntries.entries())
  try {
    const res = await callApi({
      op: "multi",
      reads: batch.map(([, e]) => ({ ...e.read, hash: e.hash })),
    })
    batch.forEach(([key, entry], i) => {
      const r = res.results?.[i]
      if (!r || r.unchanged || pollEntries.get(key) !== entry) return
      entry.hash = r.hash
      entry.last = r
      for (const l of Array.from(entry.listeners)) {
        try {
          l.onNext(snapshotFor(entry)) // snapshot propio por listener: nadie comparte objetos mutables
        } catch (err) {
          console.error("[onSnapshot] Error en el callback:", err)
        }
      }
    })
  } catch (err) {
    for (const [, entry] of batch) for (const l of Array.from(entry.listeners)) l.onError?.(err)
  } finally {
    pollInFlight = false
    if (pollEntries.size > 0) schedulePoll(pollAgainAfterFlight ? 0 : isPageHidden() ? HIDDEN_POLL_INTERVAL_MS : POLL_INTERVAL_MS)
    pollAgainAfterFlight = false
  }
}

function hookVisibility() {
  if (visibilityHooked || typeof document === "undefined") return
  visibilityHooked = true
  document.addEventListener("visibilitychange", () => {
    if (!isPageHidden() && pollEntries.size > 0) schedulePoll(0)
  })
}

export function onSnapshot(ref: DocRef | CollectionRef | QueryRef, onNext: (snap: SnapshotLike) => void, onError?: (err: any) => void) {
  hookVisibility()
  const read: PollRead =
    ref.__kind === "doc" ? { kind: "doc", collection: ref.name, id: ref.id } : { kind: "query", ...queryBody(ref) }
  const key = JSON.stringify(read)
  let entry = pollEntries.get(key)
  if (!entry) {
    entry = { read, listeners: new Set() }
    pollEntries.set(key, entry)
  }
  const listener: SnapshotListener = { onNext, onError }
  entry.listeners.add(listener)

  if (entry.last) {
    // Otra suscripción ya trajo estos datos: entregarlos sin esperar al próximo ciclo.
    const e = entry
    setTimeout(() => {
      if (e.listeners.has(listener)) listener.onNext(snapshotFor(e))
    }, 0)
  } else {
    schedulePoll(FIRST_READ_DELAY_MS)
  }

  return () => {
    const e = pollEntries.get(key)
    if (!e) return
    e.listeners.delete(listener)
    if (e.listeners.size === 0) pollEntries.delete(key)
  }
}

// ---------------------------------------------------------------------------
// writeBatch / runTransaction
// ---------------------------------------------------------------------------
type BatchOp = { type: "set" | "update" | "delete"; collection: string; id: string; data?: any; merge?: boolean }

export function writeBatch(_db: any) {
  const ops: BatchOp[] = []
  return {
    set(ref: DocRef, data: Record<string, any>, options?: { merge?: boolean }) {
      ops.push({ type: "set", collection: ref.name, id: ref.id, data: resolveWrite(data), merge: !!options?.merge })
      return this
    },
    update(ref: DocRef, data: Record<string, any>) {
      ops.push({ type: "update", collection: ref.name, id: ref.id, data: resolveWrite(data) })
      return this
    },
    delete(ref: DocRef) {
      ops.push({ type: "delete", collection: ref.name, id: ref.id })
      return this
    },
    async commit() {
      if (ops.length === 0) return
      await callApi({ op: "batch", operations: ops })
    },
  }
}

export type Transaction = {
  get: (ref: DocRef) => Promise<SnapshotLike>
  set: (ref: DocRef, data: Record<string, any>, options?: { merge?: boolean }) => void
  update: (ref: DocRef, data: Record<string, any>) => void
  delete: (ref: DocRef) => void
}

const MAX_TRANSACTION_RETRIES = 5

export async function runTransaction<T>(_db: any, updateFn: (tx: Transaction) => Promise<T> | T): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    const ops: BatchOp[] = []
    const readVersions = new Map<string, { collection: string; id: string; version: number | null }>()

    const tx: Transaction = {
      get: async (ref) => {
        const snap = await getDoc(ref)
        const key = `${ref.name}/${ref.id}`
        if (!readVersions.has(key)) {
          readVersions.set(key, { collection: ref.name, id: ref.id, version: (snap as any).__version ?? null })
        }
        return snap
      },
      set: (ref, data, options) => {
        ops.push({ type: "set", collection: ref.name, id: ref.id, data: resolveWrite(data), merge: !!options?.merge })
      },
      update: (ref, data) => {
        ops.push({ type: "update", collection: ref.name, id: ref.id, data: resolveWrite(data) })
      },
      delete: (ref) => {
        ops.push({ type: "delete", collection: ref.name, id: ref.id })
      },
    }

    const result = await updateFn(tx)

    if (ops.length === 0) return result

    try {
      await callApi({ op: "batch", operations: ops, expectedVersions: Array.from(readVersions.values()) })
      return result
    } catch (err) {
      if (err instanceof ConflictError && attempt < MAX_TRANSACTION_RETRIES) {
        await new Promise((r) => setTimeout(r, 50 + Math.random() * 150))
        continue
      }
      throw err
    }
  }
  throw new Error("No se pudo completar la operación: demasiados conflictos de concurrencia")
}

// ---------------------------------------------------------------------------
// Tipos usados solo como anotaciones en el repositorio original
// ---------------------------------------------------------------------------
export type DocumentData = Record<string, any>
export type DocumentSnapshot<T = DocumentData> = SnapshotLike
