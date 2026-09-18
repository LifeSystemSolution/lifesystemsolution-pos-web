/**
 * lib/local/platform-store-seed.ts
 * ---------------------------------------------------------------------------
 * Inicializa una tienda recién creada (mesas + inventario base de pizza) —
 * mismo shape exacto que initializeStoreData()/initializePizzaInventory() en
 * lib/firebase/firestore.ts, para que una tienda creada desde /plataforma
 * quede indistinguible de una creada por el camino viejo. Usado por
 * app/api/platform/companies/route.ts (POST, empresa nueva) y
 * app/api/platform/companies/[id]/stores/route.ts (POST, tienda adicional).
 * SOLO se llama dentro de una transacción que ya seteó
 * app.is_platform_owner — nunca standalone.
 * ---------------------------------------------------------------------------
 */
import type { PoolClient } from "pg"
import { PIZZA_MASS_TYPES, PIZZA_INVENTORY_CODES, PIZZA_SIZE_LABELS } from "@/lib/firebase/firestore"

function genSuffix() {
  return Math.random().toString(36).slice(2, 8)
}

export async function seedNewStore(client: PoolClient, companyId: string, storeId: string): Promise<void> {
  // 10 mesas por defecto.
  for (let i = 1; i <= 10; i++) {
    const tableId = `table_${genSuffix()}`
    await client.query(
      `INSERT INTO documents (collection, id, company_id, data) VALUES ('tables', $1, $2, $3::jsonb)`,
      [tableId, companyId, JSON.stringify({ storeId, number: i, status: "available", capacity: 4, active: true })]
    )
  }

  // Inventario base de pizza (5 productos operacionales fijos).
  const now = new Date().toISOString()
  for (const massType of PIZZA_MASS_TYPES) {
    const invCode = PIZZA_INVENTORY_CODES[massType]
    const invId = `${storeId}_pizzamass_${massType}`
    await client.query(
      `INSERT INTO documents (collection, id, company_id, data)
       VALUES ('inventory_items', $1, $2, $3::jsonb)
       ON CONFLICT (company_id, collection, id) DO NOTHING`,
      [
        invId,
        companyId,
        JSON.stringify({
          id: invId,
          storeId,
          productId: invCode,
          productName: `Masa ${PIZZA_SIZE_LABELS[massType]}`,
          variantId: massType,
          variantName: PIZZA_SIZE_LABELS[massType],
          category: "pizzas",
          currentStock: 15,
          minStock: 10,
          status: "normal",
          lastUpdated: now,
          isActive: true,
          isPizzaMass: true,
          massType,
          inventoryCode: invCode,
        }),
      ]
    )
  }
}
