/**
 * scripts/reset-password.mjs
 * ---------------------------------------------------------------------------
 * Genera una contraseña NUEVA para una cuenta de login existente (dueño de la
 * plataforma, cuenta de empresa o cuenta de local) cuando se olvidó.
 *
 * La contraseña se muestra UNA sola vez en esta terminal; en la base solo
 * queda el hash scrypt (mismo formato que lib/local/auth.ts). La anterior deja
 * de funcionar de inmediato. Las sesiones ya abiertas siguen válidas hasta
 * que venza su token (7 días).
 *
 * Uso: node --env-file=.env.local scripts/reset-password.mjs correo@ejemplo.com
 * ---------------------------------------------------------------------------
 */
import { scryptSync, randomBytes, randomInt } from "node:crypto"
import pg from "pg"

const email = String(process.argv[2] || "").toLowerCase().trim()
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Uso: node --env-file=.env.local scripts/reset-password.mjs correo@ejemplo.com")
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
  const { rows } = await pool.query(
    `UPDATE auth_accounts SET password_hash = $2 WHERE email = $1
     RETURNING is_platform_owner, active`,
    [email, hashPassword(password)]
  )
  if (rows.length === 0) {
    console.error(`No existe ninguna cuenta con el correo ${email}. No se cambió nada.`)
    process.exitCode = 1
  } else {
    const kind = rows[0].is_platform_owner ? "dueño de la plataforma" : "cuenta de empresa/local"
    console.log("")
    console.log(`Contraseña restablecida (${kind}).`)
    console.log(`  Correo:      ${email}`)
    console.log(`  Contraseña:  ${password}`)
    if (!rows[0].active) console.log("  Ojo: esta cuenta está DESACTIVADA; actívala en /plataforma para poder entrar.")
    console.log("")
    console.log("Guárdala ahora en tu gestor de contraseñas: no se vuelve a mostrar.")
  }
} finally {
  await pool.end()
}
