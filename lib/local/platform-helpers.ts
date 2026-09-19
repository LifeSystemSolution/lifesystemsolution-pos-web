/**
 * lib/local/platform-helpers.ts
 * ---------------------------------------------------------------------------
 * Piezas compartidas por las rutas app/api/platform/*. Todo lo que recibe un
 * PoolClient corre DENTRO de una transacción ya abierta por
 * withPlatformOwnerScope() (que además setea app.is_platform_owner, sin lo
 * cual RLS no dejaría escribir en `documents` de otra empresa).
 * ---------------------------------------------------------------------------
 */
import type { PoolClient } from "pg"
import { hashPassword } from "@/lib/local/auth"
import { HttpError } from "@/lib/local/platform-auth"
import { seedNewStore } from "@/lib/local/platform-store-seed"

export const VALID_ROLES = ["super_admin", "admin_global", "admin", "cajero", "mesero", "cocina"] as const
export const CROSS_STORE_ROLES = new Set<string>(["super_admin", "admin_global"])
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function genSuffix() {
  return Math.random().toString(36).slice(2, 8)
}

export function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
}

export function normalizeEmail(email: unknown): string {
  const value = String(email ?? "").toLowerCase().trim()
  if (!EMAIL_RE.test(value)) throw new HttpError(400, `Correo inválido: "${value}"`)
  return value
}

export function assertPassword(password: unknown): string {
  const value = String(password ?? "")
  if (value.length < 8) throw new HttpError(400, "La contraseña debe tener al menos 8 caracteres")
  return value
}

export function assertPinFormat(pin: unknown): string {
  const value = String(pin ?? "").trim()
  if (!/^\d{4,6}$/.test(value)) throw new HttpError(400, "El PIN debe tener entre 4 y 6 dígitos")
  return value
}

export function assertRole(role: unknown): string {
  if (!VALID_ROLES.includes(role as any)) throw new HttpError(400, "Rol inválido")
  return role as string
}

/** Verifica que todos los ids de tienda existan en la empresa. */
export async function assertStoresBelong(client: PoolClient, companyId: string, storeIds: string[]) {
  if (storeIds.length === 0) return
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM documents WHERE collection = 'stores' AND company_id = $1 AND id = ANY($2::text[])`,
    [companyId, storeIds]
  )
  if (rows.length !== new Set(storeIds).size) {
    throw new HttpError(400, "Algún local indicado no pertenece a esta empresa")
  }
}

type UserRow = { id: string; pin?: string; role?: string; storeId?: string }

async function loadCompanyUsers(client: PoolClient, companyId: string): Promise<UserRow[]> {
  const { rows } = await client.query<{ id: string; data: any }>(
    `SELECT id, data FROM documents WHERE collection = 'users' AND company_id = $1`,
    [companyId]
  )
  return rows.map((r) => ({ id: r.id, pin: r.data?.pin, role: r.data?.role, storeId: r.data?.storeId }))
}

/**
 * ¿Este PIN puede usarse sin chocar con otro? El login por PIN toma el primer
 * usuario que coincide, así que dos usuarios con el mismo PIN hacen que uno
 * entre al perfil del otro. Reglas:
 *  - dentro de un mismo local, el PIN es único;
 *  - los roles que cruzan locales (super_admin/admin_global) buscan por PIN en
 *    TODA la empresa, así que su PIN es único en toda la empresa.
 */
function pinConflicts(users: UserRow[], pin: string, role: string, storeId: string | undefined, excludeId?: string) {
  const cross = CROSS_STORE_ROLES.has(role)
  return users.some((u) => {
    if (u.id === excludeId || u.pin !== pin) return false
    const otherCross = CROSS_STORE_ROLES.has(u.role || "")
    return cross || otherCross || (u.storeId || "") === (storeId || "")
  })
}

export async function assertPinAvailable(
  client: PoolClient,
  companyId: string,
  pin: string,
  opts: { role: string; storeId?: string; excludeUserId?: string }
) {
  const users = await loadCompanyUsers(client, companyId)
  if (pinConflicts(users, pin, opts.role, opts.storeId, opts.excludeUserId)) {
    throw new HttpError(409, "Ese PIN ya lo usa otro usuario del mismo local (o un administrador de la empresa)")
  }
}

export async function generateUniquePin(
  client: PoolClient,
  companyId: string,
  opts: { role: string; storeId?: string; excludeUserId?: string },
  reservedPins: string[] = []
): Promise<string> {
  const users = await loadCompanyUsers(client, companyId)
  for (let i = 0; i < 200; i++) {
    const pin = String(Math.floor(1000 + Math.random() * 9000))
    if (reservedPins.includes(pin)) continue
    if (!pinConflicts(users, pin, opts.role, opts.storeId, opts.excludeUserId)) return pin
  }
  throw new HttpError(500, "No se pudo generar un PIN libre")
}

/** Crea una cuenta de login. storeId null = cuenta de empresa (Super Admin). */
export async function createAccount(
  client: PoolClient,
  opts: { companyId: string; email: string; password: string; storeId: string | null }
): Promise<{ accountId: string; email: string }> {
  const email = normalizeEmail(opts.email)
  const password = assertPassword(opts.password)
  const { rows } = await client.query(`SELECT 1 FROM auth_accounts WHERE email = $1`, [email])
  if (rows.length > 0) throw new HttpError(409, `Ya existe una cuenta con el correo ${email}`)

  const accountId = `acc_${genSuffix()}`
  await client.query(`INSERT INTO auth_accounts (id, email, password_hash) VALUES ($1, $2, $3)`, [
    accountId,
    email,
    hashPassword(password),
  ])
  await client.query(
    `INSERT INTO company_members (auth_account_id, company_id, store_id, email) VALUES ($1, $2, $3, $4)`,
    [accountId, opts.companyId, opts.storeId, email]
  )
  return { accountId, email }
}

/**
 * Crea un local completo, atómicamente: la tienda, sus 10 mesas + inventario
 * base, y SU cuenta de acceso (la que usarán sus empleados: entran con ella y
 * luego con su PIN). Un local nunca queda sin cuenta — ese es el modelo.
 */
export async function createStoreWithAccount(
  client: PoolClient,
  opts: { companyId: string; name: string; code: string; accountEmail: string; accountPassword: string }
): Promise<{ storeId: string; accountId: string; accountEmail: string }> {
  const name = String(opts.name ?? "").trim()
  const code = String(opts.code ?? "").trim().toUpperCase()
  if (!name || !code) throw new HttpError(400, "El local necesita nombre y código")

  const storeId = `store_${genSuffix()}`
  await client.query(
    `INSERT INTO documents (collection, id, company_id, data) VALUES ('stores', $1, $2, $3::jsonb)`,
    [storeId, opts.companyId, JSON.stringify({ name, code, active: true, createdAt: new Date().toISOString() })]
  )
  await seedNewStore(client, opts.companyId, storeId)
  const account = await createAccount(client, {
    companyId: opts.companyId,
    email: opts.accountEmail,
    password: opts.accountPassword,
    storeId,
  })
  return { storeId, accountId: account.accountId, accountEmail: account.email }
}

/** Una cuenta que se va a modificar/borrar tiene que ser de esta empresa y no ser la del dueño de la plataforma. */
export async function loadManageableAccount(
  client: PoolClient,
  companyId: string,
  accountId: string,
  currentSessionAccountId: string
) {
  const { rows } = await client.query<{
    id: string
    email: string
    active: boolean
    is_platform_owner: boolean
    store_id: string | null
  }>(
    `SELECT a.id, a.email, a.active, a.is_platform_owner, cm.store_id
     FROM company_members cm JOIN auth_accounts a ON a.id = cm.auth_account_id
     WHERE cm.company_id = $1 AND a.id = $2`,
    [companyId, accountId]
  )
  const account = rows[0]
  if (!account) throw new HttpError(404, "Cuenta no encontrada en esta empresa")
  if (account.is_platform_owner) {
    throw new HttpError(403, "La cuenta del dueño de la plataforma no se puede modificar desde acá")
  }
  if (account.id === currentSessionAccountId) {
    throw new HttpError(403, "No puedes modificar tu propia cuenta")
  }
  return account
}
