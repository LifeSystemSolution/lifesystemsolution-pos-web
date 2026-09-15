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
 *      el servidor necesita saber de qué EMPRESA son los datos que está
 *      pidiendo — ver resolveCompanyId en app/api/db/route.ts.
 *   2. onSnapshot usa Server-Sent Events contra app/api/realtime (relay de
 *      Supabase Realtime), no polling — ver la nota en esa función más abajo.
 * ---------------------------------------------------------------------------
 */
import { getStoredSession } from "@/lib/local/session"

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
// onSnapshot — Server-Sent Events contra /api/realtime (relay de Supabase
// Realtime, ver ese archivo). El evento SSE solo avisa "algo cambió en esta
// colección" (collection + id), no manda el documento — al recibirlo, se
// vuelve a pedir con getDoc/getDocs (mismo camino que una lectura normal,
// con el where/orderBy/limit ya aplicado del lado del servidor). Es menos
// "puro" que reconstruir el estado a mano desde el payload del evento, pero
// muchísimo más simple y sin duplicar lógica de filtrado en el navegador.
//
// EventSource reconecta solo si la conexión se corta (comportamiento nativo
// del navegador) — no hace falta manejarlo acá.
// ---------------------------------------------------------------------------
export function onSnapshot(ref: DocRef | CollectionRef | QueryRef, onNext: (snap: SnapshotLike) => void, onError?: (err: any) => void) {
  let cancelled = false
  let es: EventSource | undefined

  const refresh = async () => {
    try {
      const snap = ref.__kind === "doc" ? await getDoc(ref) : await getDocs(ref)
      if (!cancelled) onNext(snap)
    } catch (err) {
      if (!cancelled) onError?.(err)
    }
  }

  void (async () => {
    // Primer estado inmediato — SSE solo notifica cambios futuros, no el
    // estado actual al conectar.
    await refresh()
    if (cancelled) return

    try {
      const session = getStoredSession()
      if (!session) throw new Error("No hay sesión activa")
      const url = `/api/realtime?token=${encodeURIComponent(session.token)}&collection=${encodeURIComponent(ref.name)}`
      es = new EventSource(url)
      es.onmessage = () => {
        if (!cancelled) void refresh()
      }
      es.onerror = () => {
        // No se re-lanza como error de la app: EventSource reintenta la
        // conexión solo (el token de sesión dura 7 días — ver lib/local/auth.ts,
        // no hace falta refrescarlo en cada reconexión de la SSE).
      }
    } catch (err) {
      if (!cancelled) onError?.(err)
    }
  })()

  return () => {
    cancelled = true
    es?.close()
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
