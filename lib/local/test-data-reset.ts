/**
 * lib/local/test-data-reset.ts
 * ---------------------------------------------------------------------------
 * "Borrar datos de prueba" de /plataforma: elimina TODO lo que genera la
 * operación (ventas, cajas, movimientos, gastos, comprobantes, historial) de
 * una empresa o de un solo local, y deja intacta la configuración
 * (productos, mesas, usuarios, locales, inventario, cuentas, formatos).
 *
 * Además, por defecto devuelve al stock lo que esos pedidos descontaron (el
 * inventario se descuenta al crear el pedido — ver deductInventoryInTransaction
 * en lib/firebase/firestore.ts): así los ajustes manuales de stock se
 * conservan y solo se deshace el efecto de las ventas de prueba. Las mesas
 * que quedaron "ocupadas" por esos pedidos vuelven a "disponible".
 *
 * Solo se llama desde /api/platform/* (dueño de la plataforma), dentro de
 * withPlatformOwnerScope: una sola transacción, todo o nada.
 * ---------------------------------------------------------------------------
 */
import type { PoolClient } from "pg"

/** Colecciones que solo contienen datos de la operación diaria. */
export const TRANSACTIONAL_COLLECTIONS: Record<string, string> = {
  orders: "Pedidos / ventas",
  order_items: "Ítems de pedidos",
  order_audit_log: "Historial de pedidos",
  comprobantes: "Comprobantes (boletas, facturas, notas)",
  comprobante_counters: "Numeración de notas de venta",
  stock_counts: "Conteos de stock de cierre",
  cash_register: "Aperturas y cierres de caja",
  cash_box_balances: "Saldos de caja",
  financial_movements: "Movimientos de caja",
  financial_movements_archived: "Movimientos de caja (archivados)",
  expenses: "Gastos",
  expenses_archived: "Gastos (archivados)",
  expense_reports: "Reportes de gastos",
  daily_reports: "Reportes diarios",
  daily_financial_summary: "Resúmenes financieros diarios",
  cash_distributions: "Distribuciones de efectivo",
  safe_box: "Caja fuerte (saldo)",
  safe_box_movements: "Movimientos de caja fuerte",
  audit_logs: "Auditoría de gastos y caja",
}
const COLLECTION_NAMES = Object.keys(TRANSACTIONAL_COLLECTIONS)

/**
 * La caja fuerte se crea sola (con saldo 0) al abrir la pantalla de caja:
 * una en 0 no es "dato de prueba" — solo se cuenta y borra si tiene saldo.
 */
const SKIP_EMPTY_SAFE_BOX = `(collection <> 'safe_box' OR (jsonb_typeof(data->'currentBalance') = 'number' AND (data->'currentBalance')::numeric <> 0))`

type Scope = { companyId: string; storeId: string | null }

function scopeSql(scope: Scope, params: unknown[]) {
  params.push(scope.companyId)
  let sql = `company_id = $${params.length}`
  if (scope.storeId) {
    params.push(scope.storeId)
    sql += ` AND data->>'storeId' = $${params.length}`
  }
  return sql
}

/** Mismo cálculo que getInventoryItemId() en lib/firebase/firestore.ts (ese archivo es de navegador). */
function inventoryId(storeId: string, item: any): string | null {
  if (!item?.productId) return null
  const isPizza = String(item.category || "").toLowerCase() === "pizzas" || item.productType === "pizza"
  if (isPizza && item.massType) return `${storeId}_pizzamass_${item.massType}`
  if (item.variantId) return `${storeId}_${item.productId}_${item.variantId}`
  return `${storeId}_${item.productId}`
}

export type ResetSummary = {
  deleted: { collection: string; label: string; count: number }[]
  totalDeleted: number
  stock: { restoredUnits: number; inventoryItems: number; missingItems: number }
  tablesFreed: number
}

/** Cuánto se borraría (sin tocar nada). */
export async function previewTestData(client: PoolClient, scope: Scope) {
  const params: unknown[] = [COLLECTION_NAMES]
  const where = scopeSql(scope, params)
  const { rows } = await client.query<{ collection: string; n: number }>(
    `SELECT collection, count(*)::int AS n FROM documents
     WHERE collection = ANY($1::text[]) AND ${where} AND ${SKIP_EMPTY_SAFE_BOX}
     GROUP BY collection`,
    params
  )
  const deleted = rows
    .map((r) => ({ collection: r.collection, label: TRANSACTIONAL_COLLECTIONS[r.collection], count: r.n }))
    .sort((a, b) => b.count - a.count)
  return { deleted, totalDeleted: deleted.reduce((s, d) => s + d.count, 0) }
}

export async function resetTestData(
  client: PoolClient,
  scope: Scope,
  opts: { restoreStock: boolean }
): Promise<ResetSummary> {
  // 1. Devolver al stock lo que descontaron los pedidos (antes de borrarlos).
  const stock = { restoredUnits: 0, inventoryItems: 0, missingItems: 0 }
  if (opts.restoreStock) {
    const params: unknown[] = []
    const where = scopeSql(scope, params)
    const { rows: orders } = await client.query<{ store_id: string; items: any }>(
      `SELECT data->>'storeId' AS store_id, data->'items' AS items FROM documents
       WHERE collection = 'orders' AND ${where}`,
      params
    )
    const toRestore = new Map<string, number>()
    for (const o of orders) {
      if (!o.store_id || !Array.isArray(o.items)) continue
      for (const item of o.items) {
        const qty = Number(item?.quantity) || 0
        // Los ítems anulados ya devolvieron su stock al anularse.
        if (item?.cancelled || qty <= 0) continue
        const id = inventoryId(o.store_id, item)
        if (id) toRestore.set(id, (toRestore.get(id) || 0) + qty)
      }
    }
    for (const [id, qty] of toRestore) {
      const { rowCount } = await client.query(
        `UPDATE documents
         SET data = jsonb_set(data, '{currentStock}', to_jsonb(COALESCE((data->>'currentStock')::numeric, 0) + $3::numeric)),
             updated_at = now()
         WHERE company_id = $1 AND collection = 'inventory_items' AND id = $2`,
        [scope.companyId, id, qty]
      )
      if (rowCount) {
        stock.inventoryItems++
        stock.restoredUnits += qty
      } else {
        stock.missingItems++ // el producto/inventario se borró después: nada que devolver
      }
    }
  }

  // 2. Liberar mesas que quedaron apuntando a pedidos que se van a borrar.
  const tParams: unknown[] = []
  const tWhere = scopeSql(scope, tParams)
  const { rowCount: tablesFreed } = await client.query(
    `UPDATE documents
     SET data = (data - 'currentOrderId') ||
                CASE WHEN data->>'status' = 'occupied' THEN '{"status":"available"}'::jsonb ELSE '{}'::jsonb END,
         updated_at = now()
     WHERE collection = 'tables' AND ${tWhere}
       AND (data->>'status' = 'occupied' OR data ? 'currentOrderId')`,
    tParams
  )

  // 3. Borrar la operación.
  const dParams: unknown[] = [COLLECTION_NAMES]
  const dWhere = scopeSql(scope, dParams)
  const { rows } = await client.query<{ collection: string; n: number }>(
    `WITH gone AS (
       DELETE FROM documents WHERE collection = ANY($1::text[]) AND ${dWhere} AND ${SKIP_EMPTY_SAFE_BOX} RETURNING collection
     )
     SELECT collection, count(*)::int AS n FROM gone GROUP BY collection`,
    dParams
  )
  const deleted = rows
    .map((r) => ({ collection: r.collection, label: TRANSACTIONAL_COLLECTIONS[r.collection], count: r.n }))
    .sort((a, b) => b.count - a.count)

  return {
    deleted,
    totalDeleted: deleted.reduce((s, d) => s + d.count, 0),
    stock,
    tablesFreed: tablesFreed ?? 0,
  }
}
