/**
 * scripts/setup-auth-accounts.mjs
 * ---------------------------------------------------------------------------
 * Migración única: reemplaza el esquema basado en Firebase UID por
 * auth_accounts (login propio). Corre contra la base REAL, preservando
 * `companies` y `documents` (no los toca) — solo recrea `company_members`
 * con la forma nueva y crea las cuentas de login para los 5 usuarios que ya
 * existían (con contraseñas NUEVAS generadas acá, ver el resultado impreso).
 *
 * Uso: node --env-file=.env.local scripts/setup-auth-accounts.mjs
 * ---------------------------------------------------------------------------
 */
import { scryptSync, randomBytes } from "node:crypto"
import pg from "pg"

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(password, salt, 64).toString("hex")
  return `${salt}:${hash}`
}

function genPassword() {
  // 12 caracteres, alfanumérico legible (sin 0/O/1/l para evitar confusión al transcribir).
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
}

const ACCOUNTS = [
  { id: "acc_admin", email: "admin@lifesystemsolution.com", companyId: "lifesystemsolution" },
  { id: "acc_johann", email: "johannsebastian789@gmail.com", companyId: "lifesystemsolution" },
  { id: "acc_local1", email: "local_1_demo@lifesystemsolution.com", companyId: "lifesystemsolution" },
  { id: "acc_local2", email: "local_2_demo@lifesystemsolution.com", companyId: "lifesystemsolution" },
  { id: "acc_local3", email: "local_3_demo@lifesystemsolution.com", companyId: "lifesystemsolution" },
]

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })

  console.log("1. Creando tabla auth_accounts...")
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_accounts (
      id             TEXT PRIMARY KEY,
      email          TEXT UNIQUE NOT NULL,
      password_hash  TEXT NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  console.log("2. Recreando company_members con la forma nueva (auth_account_id en vez de firebase_uid)...")
  await pool.query(`DROP TABLE IF EXISTS company_members`)
  await pool.query(`
    CREATE TABLE company_members (
      auth_account_id  TEXT PRIMARY KEY REFERENCES auth_accounts(id),
      company_id       TEXT NOT NULL REFERENCES companies(id),
      email            TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS company_members_company_idx ON company_members (company_id)`)

  console.log("3. Creando las 5 cuentas con contraseñas nuevas...\n")
  const credentials = []
  for (const acc of ACCOUNTS) {
    const password = genPassword()
    const passwordHash = hashPassword(password)
    await pool.query(
      `INSERT INTO auth_accounts (id, email, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [acc.id, acc.email, passwordHash]
    )
    await pool.query(
      `INSERT INTO company_members (auth_account_id, company_id, email) VALUES ($1, $2, $3)
       ON CONFLICT (auth_account_id) DO NOTHING`,
      [acc.id, acc.companyId, acc.email]
    )
    credentials.push({ email: acc.email, password })
  }

  console.log("=== CREDENCIALES NUEVAS (guárdalas, no se van a volver a mostrar) ===")
  for (const c of credentials) {
    console.log(`  ${c.email.padEnd(38)} ${c.password}`)
  }
  console.log("")

  await pool.end()
  console.log("Listo.")
}

main().catch((err) => {
  console.error("ERROR:", err)
  process.exit(1)
})
