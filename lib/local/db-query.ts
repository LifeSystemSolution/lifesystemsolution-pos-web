/**
 * lib/local/db-query.ts
 * ---------------------------------------------------------------------------
 * Lecturas de `documents` para app/api/db/route.ts (separado de la ruta para
 * poder probarlo: Next no deja exportar funciones sueltas desde route.ts).
 * Ver buildSqlFilter() para qué parte de cada query se resuelve en SQL.
 * ---------------------------------------------------------------------------
 */
import type { PoolClient } from "pg"
import type { CompanyScope } from "@/lib/local/pg-client"
import { rowVisible } from "@/lib/local/db-access-policy"

export function matchWhere(data: any, c: { field: string; op: string; value: any }): boolean {
  const v = data[c.field]
  switch (c.op) {
    case "==":
      return v === c.value
    case "!=":
      return v !== c.value
    case ">":
      return v > c.value
    case ">=":
      return v >= c.value
    case "<":
      return v < c.value
    case "<=":
      return v <= c.value
    case "in":
      return Array.isArray(c.value) && c.value.includes(v)
    case "not-in":
      return Array.isArray(c.value) && !c.value.includes(v)
    case "array-contains":
      return Array.isArray(v) && v.includes(c.value)
    case "array-contains-any":
      return Array.isArray(v) && Array.isArray(c.value) && c.value.some((x) => v.includes(x))
    default:
      return true
  }
}

export function applyQuery(rows: { id: string; data: any }[], body: any) {
  let items = rows
  const where: Array<{ field: string; op: string; value: any }> = body.where || []
  for (const c of where) items = items.filter((r) => matchWhere(r.data, c))
  const orderBy = body.orderBy as { field: string; direction: "asc" | "desc" } | undefined
  if (orderBy) {
    items = items.slice().sort((a, b) => {
      const av = a.data[orderBy.field]
      const bv = b.data[orderBy.field]
      const cmp = av > bv ? 1 : av < bv ? -1 : 0
      return orderBy.direction === "desc" ? -cmp : cmp
    })
  }
  if (typeof body.limit === "number") items = items.slice(0, body.limit)
  return items
}

const RANGE_OPS: Record<string, string> = { ">": ">", ">=": ">=", "<": "<", "<=": "<=" }

function isPrimitive(v: unknown): v is string | number | boolean | null {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean"
}

/**
 * Traduce a SQL la parte de la query que tiene equivalente EXACTO:
 *
 *  - `==` con valor primitivo → `data @> {"campo": valor}` (compara tipo y
 *    valor igual que `===`; usa el índice GIN documents_data_gin_idx).
 *  - `>`/`>=`/`<`/`<=` con valor string (fechas ISO, que es como el shim
 *    serializa Date) → comparación byte a byte (COLLATE "C"), la misma que
 *    hace JS entre strings, restringida a campos que sean string.
 *
 * Lo demás (!=, in, array-contains, valores objeto como Timestamp) se deja
 * para applyQuery() en JS. orderBy + limit solo se bajan a SQL cuando TODOS
 * los where quedaron en SQL y el filtro de local (rowVisible) no puede
 * descartar filas después del LIMIT — si no, podrían faltar resultados.
 */
export function buildSqlFilter(body: any, scope: CompanyScope, params: any[]) {
  const where: Array<{ field: string; op: string; value: any }> = body.where || []
  const clauses: string[] = []
  const eq: Record<string, unknown> = {}
  let allPushed = true

  for (const c of where) {
    if (typeof c?.field !== "string") {
      allPushed = false
      continue
    }
    if (c.op === "==" && isPrimitive(c.value)) {
      eq[c.field] = c.value
    } else if (RANGE_OPS[c.op] && typeof c.value === "string") {
      params.push(c.field)
      const f = `$${params.length}`
      params.push(c.value)
      clauses.push(
        `jsonb_typeof(data -> ${f}::text) = 'string' AND (data ->> ${f}::text) COLLATE "C" ${RANGE_OPS[c.op]} $${params.length}::text COLLATE "C"`
      )
    } else {
      allPushed = false
    }
  }
  if (Object.keys(eq).length > 0) {
    params.push(JSON.stringify(eq))
    clauses.push(`data @> $${params.length}::jsonb`)
  }

  let orderLimit = ""
  const storeSafe = !scope.storeId || eq.storeId === scope.storeId
  const orderBy = body.orderBy as { field: string; direction: "asc" | "desc" } | undefined
  if (allPushed && storeSafe && typeof body.limit === "number" && body.limit >= 0) {
    if (orderBy && typeof orderBy.field === "string") {
      params.push(orderBy.field)
      const f = `$${params.length}::text`
      const dir = orderBy.direction === "desc" ? "DESC" : "ASC"
      orderLimit =
        ` ORDER BY (CASE WHEN jsonb_typeof(data -> ${f}) = 'number' THEN (data ->> ${f})::numeric END) ${dir} NULLS LAST,` +
        ` (CASE WHEN jsonb_typeof(data -> ${f}) = 'string' THEN data ->> ${f} END) COLLATE "C" ${dir} NULLS LAST`
    }
    params.push(Math.floor(body.limit))
    orderLimit += ` LIMIT $${params.length}`
  }

  return { sql: clauses.map((c) => ` AND ${c}`).join(""), orderLimit }
}

export async function runQuery(client: PoolClient, scope: CompanyScope, body: any) {
  const params: any[] = [body.collection, scope.companyId]
  const { sql, orderLimit } = buildSqlFilter(body, scope, params)
  const { rows } = await client.query(
    `SELECT id, data FROM documents WHERE collection = $1 AND company_id = $2${sql}${orderLimit}`,
    params
  )
  const visibleRows = rows.filter((r) => rowVisible(scope, body.collection, r.id, r.data))
  return applyQuery(visibleRows, body).map((r) => ({ id: r.id, data: r.data }))
}

export async function runGetDoc(client: PoolClient, scope: CompanyScope, collection: string, id: string) {
  const { rows } = await client.query(
    `SELECT data, extract(epoch from updated_at) AS v
     FROM documents WHERE collection = $1 AND id = $2 AND company_id = $3`,
    [collection, id, scope.companyId]
  )
  const visible = rows.length > 0 && rowVisible(scope, collection, id, rows[0].data)
  return {
    exists: visible,
    id,
    data: visible ? rows[0].data : null,
    version: visible ? rows[0].v : null,
  }
}
