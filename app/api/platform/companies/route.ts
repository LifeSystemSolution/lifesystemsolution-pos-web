/**
 * app/api/platform/companies/route.ts
 * ---------------------------------------------------------------------------
 * Vista de plataforma: todas las empresas del SaaS, con cantidad de tiendas
 * y de usuarios. `companies`/`company_members` no tienen RLS (son de
 * servidor únicamente), así que un simple pool.query alcanza — no hace falta
 * withPlatformOwnerScope acá (esa función es para leer `documents`, que sí
 * tiene RLS). El conteo de tiendas sí lee `documents`, por eso usa
 * withPlatformOwnerScope para esa parte.
 *
 * POST bootstrapea una empresa nueva completa en una sola transacción:
 * companies + la primera cuenta de login (auth_accounts/company_members) +
 * una tienda inicial + un usuario operativo admin (PIN) — para que la
 * empresa quede utilizable de inmediato, sin pasos manuales en SQL.
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import { getPool, withPlatformOwnerScope } from "@/lib/local/pg-client"
import { getPlatformOwnerSession } from "@/lib/local/platform-auth"
import { hashPassword } from "@/lib/local/auth"

export const runtime = "nodejs"

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
}

function genSuffix() {
  return Math.random().toString(36).slice(2, 8)
}

function genPin() {
  return String(Math.floor(1000 + Math.random() * 9000))
}

export async function GET(req: NextRequest) {
  if (!getPlatformOwnerSession(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }

  try {
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

    const result = companies.map((c) => ({
      ...c,
      userCount: memberCountByCompany.get(c.id) || 0,
      storeCount: storeCountByCompany.get(c.id) || 0,
    }))

    return NextResponse.json({ companies: result })
  } catch (err: any) {
    console.error("[api/platform/companies] Error:", err)
    return NextResponse.json({ error: err?.message || "Error del servidor" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!getPlatformOwnerSession(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }

  try {
    const body = await req.json()
    const { name, plan, storeName, adminEmail, adminPassword } = body

    if (!name?.trim() || !adminEmail?.trim() || !adminPassword?.trim()) {
      return NextResponse.json(
        { error: "name, adminEmail y adminPassword son requeridos" },
        { status: 400 }
      )
    }
    if (String(adminPassword).length < 8) {
      return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 })
    }

    const email = String(adminEmail).toLowerCase().trim()
    const { rows: existing } = await getPool().query(`SELECT id FROM auth_accounts WHERE email = $1`, [email])
    if (existing.length > 0) {
      return NextResponse.json({ error: "Ya existe una cuenta con ese correo" }, { status: 409 })
    }

    const companyId = `${slugify(name)}-${genSuffix()}`
    const accountId = `acc_${genSuffix()}`
    const storeId = `store_${genSuffix()}`
    const userId = `user_${genSuffix()}`
    const pin = genPin()
    const passwordHash = hashPassword(adminPassword)

    const pool = getPool()
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      // companies/auth_accounts/company_members no tienen RLS — sin
      // problema tocarlas en la misma transacción que documents (donde sí
      // hace falta app.is_platform_owner para pasar la política).
      await client.query(`SELECT set_config('app.is_platform_owner', 'true', true)`)

      await client.query(`INSERT INTO companies (id, name, plan, active) VALUES ($1, $2, $3, true)`, [
        companyId,
        name.trim(),
        plan || "trial",
      ])
      await client.query(
        `INSERT INTO auth_accounts (id, email, password_hash) VALUES ($1, $2, $3)`,
        [accountId, email, passwordHash]
      )
      await client.query(
        `INSERT INTO company_members (auth_account_id, company_id, email) VALUES ($1, $2, $3)`,
        [accountId, companyId, email]
      )
      await client.query(
        `INSERT INTO documents (collection, id, company_id, data)
         VALUES ('stores', $1, $2, $3::jsonb)`,
        [
          storeId,
          companyId,
          JSON.stringify({
            name: storeName?.trim() || "Sede Principal",
            code: slugify(storeName?.trim() || name).slice(0, 10).toUpperCase() || "SEDE1",
            active: true,
            createdAt: new Date().toISOString(),
          }),
        ]
      )
      await client.query(
        `INSERT INTO documents (collection, id, company_id, data)
         VALUES ('users', $1, $2, $3::jsonb)`,
        [
          userId,
          companyId,
          JSON.stringify({
            name: "Administrador",
            pin,
            role: "admin",
            storeId,
            active: true,
          }),
        ]
      )

      await client.query("COMMIT")
    } catch (err) {
      await client.query("ROLLBACK")
      throw err
    } finally {
      client.release()
    }

    return NextResponse.json({
      companyId,
      adminEmail: email,
      storeId,
      operationalPin: pin,
    })
  } catch (err: any) {
    console.error("[api/platform/companies POST] Error:", err)
    return NextResponse.json({ error: err?.message || "Error del servidor" }, { status: 500 })
  }
}
