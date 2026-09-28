/**
 * scripts/create-platform-owner.mjs
 * ---------------------------------------------------------------------------
 * Arranque de una base NUEVA (Neon): crea la cuenta dueña de la plataforma,
 * la única que no se puede crear desde la app. Con ella se entra a
 * /plataforma y desde ahí se crean empresas, locales, cuentas y usuarios.
 *
 * Genera una contraseña aleatoria y la muestra UNA sola vez en esta
 * terminal (en la base solo queda el hash scrypt, mismo formato que
 * lib/local/auth.ts). Si el correo ya existe, no toca nada.
 *
 * Uso: node --env-file=.env.local scripts/create-platform-owner.mjs tu@correo.com
 * ---------------------------------------------------------------------------
 */
import { scryptSync, randomBytes, randomInt } from "node:crypto"
import pg from "pg"

const email = String(process.argv[2] || "").toLowerCase().trim()
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Uso: node --env-file=.env.local scripts/create-platform-owner.mjs tu@correo.com")
  process.exit(1)
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(password, salt, 64).toString("hex")
  return `${salt}:${hash}`
}

function genPassword() {
  // 16 caracteres legibles (sin 0/O/1/l/I para no confundirse al transcribir).
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
  return Array.from({ length: 16 }, () => chars[randomInt(chars.length)]).join("")
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
try {
  const password = genPassword()
  const { rowCount } = await pool.query(
    `INSERT INTO auth_accounts (id, email, password_hash, is_platform_owner, active)
     VALUES ($1, $2, $3, true, true)
     ON CONFLICT (email) DO NOTHING`,
    [`acc_owner_${randomBytes(4).toString("hex")}`, email, hashPassword(password)]
  )
  if (rowCount === 0) {
    console.error(`Ya existe una cuenta con el correo ${email}. No se cambió nada.`)
    process.exitCode = 1
  } else {
    console.log("")
    console.log("Cuenta dueña de la plataforma creada.")
    console.log(`  Correo:      ${email}`)
    console.log(`  Contraseña:  ${password}`)
    console.log("")
    console.log("Guárdala ahora en tu gestor de contraseñas: no se vuelve a mostrar.")
  }
} finally {
  await pool.end()
}
