/**
 * app/api/platform/companies/route.ts
 * ---------------------------------------------------------------------------
 * GET: todas las empresas del SaaS con cantidad de tiendas y de cuentas.
 *
 * POST: bootstrapea una empresa nueva completa en UNA transacción, con el
 * modelo de cuentas por nivel (ver docs/PLATFORM_OWNER.md):
 *   - cuenta de EMPRESA (Super Admin): ve todos los locales;
 *   - el primer LOCAL, con SU propia cuenta (la que usarán sus empleados:
 *     entran con ella y luego con su PIN);
 *   - un usuario operativo super_admin (PIN) para el Super Admin y un admin
 *     (PIN) para el local — PIN únicos, se devuelven una sola vez.
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import { getPool, withPlatformOwnerScope } from "@/lib/local/pg-client"
import { runOwnerRoute, HttpError } from "@/lib/local/platform-auth"
import {
  createAccount,
  createStoreWithAccount,
  generateUniquePin,
  genSuffix,
  slugify,
} from "@/lib/local/platform-helpers"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  return runOwnerRoute(req, "companies GET", async () => {
    const { rows: companies } = await getPool().query<{
      id: string
      name: string
      plan: string
      active: boolean
      created_at: string
    }>(`SELECT id, name, plan, active, created_at FROM companies ORDER BY created_at ASC`)

    const { rows: memberCounts } = await getPool().query<{ company_id: string; count: string }>(
      `SELECT company_id, COUNT(*) AS count FROM company_members GROUP BY company_id`
    )
    const memberCountByCompany = new Map(memberCounts.map((r) => [r.company_id, Number(r.count)]))

    const storeCounts = await withPlatformOwnerScope(async (client) => {
      const { rows } = await client.query<{ company_id: string; count: string }>(
        `SELECT company_id, COUNT(*) AS count FROM documents WHERE collection = 'stores' GROUP BY company_id`
      )
      return rows
    })
    const storeCountByCompany = new Map(storeCounts.map((r) => [r.company_id, Number(r.count)]))

    return NextResponse.json({
      companies: companies.map((c) => ({
        ...c,
        userCount: memberCountByCompany.get(c.id) || 0,
        storeCount: storeCountByCompany.get(c.id) || 0,
      })),
    })
  })
}

export async function POST(req: NextRequest) {
  return runOwnerRoute(req, "companies POST", async () => {
    const body = await req.json()
    const name = String(body.name ?? "").trim()
    const superAdmin = body.superAdmin || {}
    const store = body.store || {}
    if (!name) throw new HttpError(400, "El nombre de la empresa es requerido")

    const storeName = String(store.name ?? "").trim() || "Sede Principal"
    const storeCode =
      String(store.code ?? "").trim().toUpperCase() ||
      slugify(storeName).replace(/-/g, "").slice(0, 8).toUpperCase() ||
      "SEDE1"

    const companyId = `${slugify(name) || "empresa"}-${genSuffix()}`

    const result = await withPlatformOwnerScope(async (client) => {
      await client.query(`INSERT INTO companies (id, name, plan, active) VALUES ($1, $2, $3, true)`, [
        companyId,
        name,
        body.plan || "trial",
      ])

      // 1. Cuenta de EMPRESA — el Super Admin (ve todos los locales).
      const superAccount = await createAccount(client, {
        companyId,
        email: superAdmin.email,
        password: superAdmin.password,
        storeId: null,
      })

      // 2. Primer local + SU cuenta de acceso.
      const created = await createStoreWithAccount(client, {
        companyId,
        name: storeName,
        code: storeCode,
        accountEmail: store.accountEmail,
        accountPassword: store.accountPassword,
      })
      if (created.accountEmail === superAccount.email) {
        throw new HttpError(400, "La cuenta del local debe ser distinta a la del Super Admin")
      }

      // 3. Usuarios operativos (PIN) — el de Super Admin y el admin del local.
      const superPin = await generateUniquePin(client, companyId, { role: "super_admin" })
      const adminPin = await generateUniquePin(client, companyId, { role: "admin", storeId: created.storeId }, [superPin])
      await client.query(
        `INSERT INTO documents (collection, id, company_id, data) VALUES ('users', $1, $2, $3::jsonb)`,
        [`user_${genSuffix()}`, companyId, JSON.stringify({ name: "Super Administrador", pin: superPin, role: "super_admin", storeId: "", active: true })]
      )
      await client.query(
        `INSERT INTO documents (collection, id, company_id, data) VALUES ('users', $1, $2, $3::jsonb)`,
        [`user_${genSuffix()}`, companyId, JSON.stringify({ name: "Administrador", pin: adminPin, role: "admin", storeId: created.storeId, active: true })]
      )

      return {
        companyId,
        storeId: created.storeId,
        superAdmin: { email: superAccount.email, pin: superPin },
        store: { name: storeName, accountEmail: created.accountEmail, pin: adminPin },
      }
    })

    return NextResponse.json(result)
  })
}
