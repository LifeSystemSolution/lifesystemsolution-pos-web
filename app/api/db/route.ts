/**
 * app/api/db/route.ts
 * ---------------------------------------------------------------------------
 * Único endpoint que habla con Postgres (Supabase). Lo consume
 * lib/local/firebase-shim/firestore.ts (que corre en el navegador) por
 * fetch(), igual que en lifesystem-pos-desktop — la diferencia acá es que
 * cada request:
 *
 *   1. Verifica el JWT de sesión propio del header Authorization (emitido
 *      por app/api/auth/login — sin Firebase).
 *   2. Resuelve a qué empresa pertenece esa cuenta (tabla company_members —
 *      la única consulta sin scope, por diseño: ver db/schema.sql).
 *   3. Corre la operación dentro de withCompanyScope(uid, ...), que resuelve
 *      la empresa Y deja `app.company_id` seteado para esa transacción en la
 *      MISMA consulta (para ahorrar un viaje de red) — la política RLS de
 *      `documents` hace el resto: aunque el filtrado de más arriba (acá o en
 *      lib/firebase/firestore.ts) se olvidara de una empresa, Postgres no
 *      devuelve ni acepta filas que no sean de esa empresa.
 *
 * El filtrado de where/orderBy/limit se sigue haciendo en JS sobre las filas
 * ya traídas (no se arma SQL dinámico con nombres de campo arbitrarios) —
 * igual que en el desktop.
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import type { PoolClient } from "pg"
import { withCompanyScope } from "@/lib/local/pg-client"
import { verifySessionToken } from "@/lib/local/auth"

export const runtime = "nodejs"

function genId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

function matchWhere(data: any, c: { field: string; op: string; value: any }): boolean {
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

function applyQuery(rows: { id: string; data: any }[], body: any) {
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

async function writeOne(
  client: PoolClient,
  companyId: string,
  op: { type: "set" | "update" | "delete"; collection: string; id: string; data?: any; merge?: boolean }
) {
  if (op.type === "delete") {
    await client.query(`DELETE FROM documents WHERE collection = $1 AND id = $2 AND company_id = $3`, [op.collection, op.id, companyId])
    return
  }
  if (op.type === "update") {
    // company_id no se toca en un update — un doc no cambia de empresa.
    await client.query(
      `UPDATE documents SET data = data || $3::jsonb, updated_at = now()
       WHERE collection = $1 AND id = $2 AND company_id = $4`,
      [op.collection, op.id, JSON.stringify(op.data || {}), companyId]
    )
    return
  }
  // set
  if (op.merge) {
    await client.query(
      `INSERT INTO documents (collection, id, company_id, data, updated_at)
       VALUES ($1, $2, $4, $3::jsonb, now())
       ON CONFLICT (company_id, collection, id)
       DO UPDATE SET data = documents.data || EXCLUDED.data, updated_at = now()`,
      [op.collection, op.id, JSON.stringify(op.data || {}), companyId]
    )
  } else {
    await client.query(
      `INSERT INTO documents (collection, id, company_id, data, updated_at)
       VALUES ($1, $2, $4, $3::jsonb, now())
       ON CONFLICT (company_id, collection, id)
       DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [op.collection, op.id, JSON.stringify(op.data || {}), companyId]
    )
  }
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null
  if (!token) {
    return NextResponse.json({ error: "Falta el token de autenticación" }, { status: 401 })
  }

  const session = verifySessionToken(token)
  if (!session) {
    return NextResponse.json({ error: "Token inválido o expirado" }, { status: 401 })
  }

  const body = await req.json()

  // Crear tiendas o usuarios operativos nuevos es exclusivo del dueño de la
  // plataforma (ver /plataforma y docs/PLATFORM_OWNER.md) — ni admin ni
  // super_admin de una empresa pueden hacerlo, ni siquiera llamando este
  // endpoint directo (el botón ya no existe en /admin, pero esto es lo que
  // realmente lo impide). Editar/desactivar tiendas y usuarios existentes
  // sigue permitido — solo la CREACIÓN queda restringida.
  if (
    body.op === "addDoc" &&
    (body.collection === "users" || body.collection === "stores") &&
    !session.isPlatformOwner
  ) {
    return NextResponse.json(
      { error: "Solo el dueño de la plataforma puede crear tiendas o usuarios nuevos" },
      { status: 403 }
    )
  }

  try {
    const outcome = await withCompanyScope(session.accountId, async (client, companyId) => {
      switch (body.op) {
        case "getDoc": {
          const { rows } = await client.query(
            `SELECT data, extract(epoch from updated_at) AS v
             FROM documents WHERE collection = $1 AND id = $2 AND company_id = $3`,
            [body.collection, body.id, companyId]
          )
          return NextResponse.json({
            exists: rows.length > 0,
            id: body.id,
            data: rows[0]?.data ?? null,
            version: rows[0]?.v ?? null,
          })
        }

        case "getDocs": {
          const { rows } = await client.query(
            `SELECT id, data FROM documents WHERE collection = $1 AND company_id = $2`,
            [body.collection, companyId]
          )
          const filtered = applyQuery(rows, body)
          return NextResponse.json({ docs: filtered.map((r) => ({ id: r.id, data: r.data })) })
        }

        case "setDoc": {
          await writeOne(client, companyId, {
            type: "set",
            collection: body.collection,
            id: body.id,
            data: body.data,
            merge: !!body.merge,
          })
          return NextResponse.json({ ok: true })
        }

        case "updateDoc": {
          await writeOne(client, companyId, { type: "update", collection: body.collection, id: body.id, data: body.data })
          return NextResponse.json({ ok: true })
        }

        case "deleteDoc": {
          await writeOne(client, companyId, { type: "delete", collection: body.collection, id: body.id })
          return NextResponse.json({ ok: true })
        }

        case "addDoc": {
          const id = genId()
          await writeOne(client, companyId, { type: "set", collection: body.collection, id, data: body.data })
          return NextResponse.json({ id })
        }

        case "batch": {
          // Concurrencia optimista para runTransaction: si algún doc leído
          // con tx.get() cambió entre esa lectura y este commit, se aborta
          // con 409 y el shim reintenta desde cero (igual que el SDK real de
          // Firestore). Ver lib/local/firebase-shim/firestore.ts.
          const expectedVersions: Array<{ collection: string; id: string; version: number | null }> =
            body.expectedVersions || []
          for (const ev of expectedVersions) {
            const { rows } = await client.query(
              `SELECT extract(epoch from updated_at) AS v FROM documents
               WHERE collection = $1 AND id = $2 AND company_id = $3 FOR UPDATE`,
              [ev.collection, ev.id, companyId]
            )
            const currentVersion = rows[0]?.v ?? null
            const changed =
              (currentVersion === null) !== (ev.version === null) ||
              (currentVersion !== null && ev.version !== null && Math.abs(currentVersion - ev.version) > 0.0001)
            if (changed) {
              // Se devuelve 409 en vez de lanzar una excepción: withCompanyScope hace COMMIT
              // de todos modos, pero como todavía no se ejecutó ningún write en este intento,
              // no hay nada que confirmar o deshacer — el 409 es lo único que le importa al
              // shim, para que distinga "conflicto, reintentar" de un error real.
              return NextResponse.json(
                { error: "conflict", mensaje: "El documento cambió desde que se leyó — reintentando" },
                { status: 409 }
              )
            }
          }

          for (const op of body.operations || []) {
            await writeOne(client, companyId, op)
          }
          return NextResponse.json({ ok: true })
        }

        default:
          return NextResponse.json({ error: `Operación desconocida: ${body.op}` }, { status: 400 })
      }
    })

    if (outcome.companyId === null) {
      return NextResponse.json({ error: "Este usuario no está asociado a ninguna empresa" }, { status: 403 })
    }
    return outcome.result
  } catch (err: any) {
    console.error("[api/db] Error:", err)
    return NextResponse.json({ error: err?.message || "Error de base de datos" }, { status: 500 })
  }
}
