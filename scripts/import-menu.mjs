/**
 * scripts/import-menu.mjs
 * ---------------------------------------------------------------------------
 * Carga una carta (JSON, ver scripts/menus/) en TODOS los locales activos de
 * una empresa, con el mismo formato que usa /admin al crear productos:
 *
 *   - category "pizzas": priceMap por tamaño; sin inventario propio (usa las
 *     5 masas del local, ver platform-store-seed.ts).
 *   - variants: un inventory_item por variante (`${storeId}_${productId}_${variantId}`).
 *   - price: un inventory_item por producto (`${storeId}_${productId}`).
 *   El inventario nuevo arranca en 0, igual que ensureInventoryItemsForProduct().
 *
 * No duplica: si el local ya tiene un producto con el mismo nombre (sin
 * importar mayúsculas), lo salta. Todo va en una sola transacción.
 *
 * Uso: node --env-file=.env.local scripts/import-menu.mjs "<empresa>" scripts/menus/x.json [--apply]
 *      <empresa> = nombre exacto o id. Sin --apply solo muestra lo que haría.
 * ---------------------------------------------------------------------------
 */
import { randomBytes, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import pg from "pg"

const [companyArg, menuPath, flag] = process.argv.slice(2)
const APPLY = flag === "--apply"
if (!companyArg || !menuPath) {
  console.error('Uso: node --env-file=.env.local scripts/import-menu.mjs "<empresa>" <carta.json> [--apply]')
  process.exit(1)
}

const MASS_TYPES = ["PERSONAL", "BIPERSONAL", "FAMILIAR", "GIGANTE", "SUPER_GIGANTE"]
const menu = JSON.parse(readFileSync(menuPath, "utf8")).products

// --- Validación de la carta ---------------------------------------------------
const errors = []
const seen = new Set()
for (const p of menu) {
  const key = p.name?.trim().toLocaleLowerCase()
  if (!key || !p.category) errors.push(`Producto sin nombre o categoría: ${JSON.stringify(p)}`)
  if (seen.has(key)) errors.push(`Nombre repetido en la carta: ${p.name}`)
  seen.add(key)
  const isPizza = p.category?.toLowerCase() === "pizzas"
  const kinds = [p.priceMap, p.variants, p.price].filter((x) => x !== undefined).length
  if (kinds !== 1) errors.push(`${p.name}: debe tener exactamente uno de priceMap / variants / price`)
  if (isPizza) {
    if (!p.priceMap) errors.push(`${p.name}: las pizzas usan priceMap`)
    for (const [k, v] of Object.entries(p.priceMap || {})) {
      if (!MASS_TYPES.includes(k)) errors.push(`${p.name}: tamaño desconocido ${k}`)
      if (!(v > 0)) errors.push(`${p.name}: precio inválido para ${k}`)
    }
  } else {
    if (p.priceMap) errors.push(`${p.name}: priceMap solo es para pizzas`)
    if (p.price !== undefined && !(p.price > 0)) errors.push(`${p.name}: precio inválido`)
    const vn = new Set()
    for (const v of p.variants || []) {
      if (!v.name || !(v.price > 0)) errors.push(`${p.name}: variante inválida ${JSON.stringify(v)}`)
      if (vn.has(v.name.toLocaleLowerCase())) errors.push(`${p.name}: variante repetida ${v.name}`)
      vn.add(v.name.toLocaleLowerCase())
    }
  }
}
if (errors.length) {
  console.error("La carta tiene errores, no se cargó nada:\n- " + errors.join("\n- "))
  process.exit(1)
}

const genId = () => `id_${Date.now().toString(36)}_${randomBytes(4).toString("hex").slice(0, 7)}`

// --- Carga ---------------------------------------------------------------------
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
const client = await pool.connect()
try {
  await client.query("BEGIN")
  // Mismo mecanismo que withPlatformOwnerScope(): este script lo corre el dueño de la plataforma.
  await client.query(`SELECT set_config('app.is_platform_owner', 'true', true)`)

  const { rows: companies } = await client.query(`SELECT id, name FROM companies WHERE id = $1 OR name = $1`, [companyArg])
  if (companies.length !== 1) throw new Error(`Empresa "${companyArg}": ${companies.length} coincidencias (usa el id)`)
  const company = companies[0]

  const { rows: stores } = await client.query(
    `SELECT id, data->>'name' AS name FROM documents
     WHERE company_id = $1 AND collection = 'stores' AND coalesce((data->>'active')::boolean, true)
     ORDER BY data->>'name'`,
    [company.id]
  )
  if (stores.length === 0) throw new Error(`${company.name} no tiene locales activos`)

  const now = new Date().toISOString()
  let totalProducts = 0
  let totalInventory = 0
  console.log(`${APPLY ? "Cargando" : "SIMULACIÓN (sin --apply no se escribe nada)"}: ${menu.length} productos en ${stores.length} locales de ${company.name}\n`)

  for (const store of stores) {
    const { rows: existing } = await client.query(
      `SELECT lower(data->>'name') AS name FROM documents WHERE company_id = $1 AND collection = 'products' AND data->>'storeId' = $2`,
      [company.id, store.id]
    )
    const existingNames = new Set(existing.map((r) => r.name))
    let added = 0
    let skipped = 0
    let inventory = 0

    for (const p of menu) {
      if (existingNames.has(p.name.trim().toLocaleLowerCase())) {
        skipped++
        continue
      }
      const productId = genId()
      const data = {
        name: p.name.trim(),
        category: p.category,
        storeId: store.id,
        available: true,
        active: true,
        createdAt: now,
      }
      if (p.description) data.description = p.description
      if (p.priceMap) data.priceMap = p.priceMap
      if (p.variants) data.variants = p.variants.map((v) => ({ id: randomUUID(), name: v.name, price: v.price }))
      if (p.price !== undefined) data.price = p.price

      const inv = []
      if (p.category.toLowerCase() !== "pizzas") {
        if (data.variants) {
          for (const v of data.variants) {
            inv.push([`${store.id}_${productId}_${v.id}`, {
              storeId: store.id, productId, variantId: v.id, productName: data.name, variantName: v.name,
              currentStock: 0, lastUpdated: now, createdAt: now,
            }])
          }
        } else {
          inv.push([`${store.id}_${productId}`, {
            storeId: store.id, productId, productName: data.name, currentStock: 0, lastUpdated: now, createdAt: now,
          }])
        }
      }

      if (APPLY) {
        await client.query(
          `INSERT INTO documents (collection, id, company_id, data) VALUES ('products', $1, $2, $3::jsonb)`,
          [productId, company.id, JSON.stringify(data)]
        )
        for (const [id, invData] of inv) {
          await client.query(
            `INSERT INTO documents (collection, id, company_id, data) VALUES ('inventory_items', $1, $2, $3::jsonb)
             ON CONFLICT (company_id, collection, id) DO NOTHING`,
            [id, company.id, JSON.stringify(invData)]
          )
        }
      }
      added++
      inventory += inv.length
    }
    totalProducts += added
    totalInventory += inventory
    console.log(`  ${store.name.padEnd(24)} +${added} productos, +${inventory} registros de inventario${skipped ? `, ${skipped} ya existían` : ""}`)
  }

  if (APPLY) await client.query("COMMIT")
  else await client.query("ROLLBACK")
  console.log(`\nTotal: ${totalProducts} productos y ${totalInventory} registros de inventario ${APPLY ? "cargados" : "por cargar"}.`)
} catch (err) {
  await client.query("ROLLBACK")
  console.error("Error, no se cargó nada:", err.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
