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
 *   2. Resuelve a qué empresa pertenece esa cuenta, a qué LOCAL está atada
 *      (si es cuenta de local) y si la cuenta/empresa siguen activas
 *      (tablas company_members/auth_accounts/companies — la única consulta
 *      sin scope, por diseño: ver db/schema.sql).
 *   3. Corre la operación dentro de withCompanyScope(uid, ...), que deja
 *      `app.company_id` seteado para esa transacción en la MISMA consulta —
 *      la política RLS de `documents` aísla entre empresas.
 *   4. Aplica lib/local/db-access-policy.ts: las cuentas de local solo ven y
 *      escriben su propio local, y crear/borrar tiendas o usuarios es
 *      exclusivo del dueño de la plataforma.
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
import { checkWrites, rowVisible, type WriteOp } from "@/lib/local/db-access-policy"

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

async function writeOne(client: PoolClient, companyId: string, op: WriteOp) {
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

function forbidden(message: string) {
  return NextResponse.json({ error: message }, { status: 403 })
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

  try {
    const outcome = await withCompanyScope(session.accountId, async (client, scope) => {
      const companyId = scope.companyId

      switch (body.op) {
        case "getDoc": {
          const { rows } = await client.query(
            `SELECT data, extract(epoch from updated_at) AS v
             FROM documents WHERE collection = $1 AND id = $2 AND company_id = $3`,
            [body.collection, body.id, companyId]
          )
          const visible = rows.length > 0 && rowVisible(scope, body.collection, body.id, rows[0].data)
          return NextResponse.json({
            exists: visible,
            id: body.id,
            data: visible ? rows[0].data : null,
            version: visible ? rows[0].v : null,
          })
        }

        case "getDocs": {
          const { rows } = await client.query(
            `SELECT id, data FROM documents WHERE collection = $1 AND company_id = $2`,
            [body.collection, companyId]
          )
          const visibleRows = rows.filter((r) => rowVisible(scope, body.collection, r.id, r.data))
          const filtered = applyQuery(visibleRows, body)
          return NextResponse.json({ docs: filtered.map((r) => ({ id: r.id, data: r.data })) })
        }

        case "setDoc": {
          const op: WriteOp = {
            type: "set",
            collection: body.collection,
            id: body.id,
            data: body.data,
            merge: !!body.merge,
          }
          const denied = await checkWrites(client, scope, [op])
          if (denied) return forbidden(denied)
          await writeOne(client, companyId, op)
          return NextResponse.json({ ok: true })
        }

        case "updateDoc": {
          const op: WriteOp = { type: "update", collection: body.collection, id: body.id, data: body.data }
          const denied = await checkWrites(client, scope, [op])
          if (denied) return forbidden(denied)
          await writeOne(client, companyId, op)
          return NextResponse.json({ ok: true })
        }

        case "deleteDoc": {
          const op: WriteOp = { type: "delete", collection: body.collection, id: body.id }
          const denied = await checkWrites(client, scope, [op])
          if (denied) return forbidden(denied)
          await writeOne(client, companyId, op)
          return NextResponse.json({ ok: true })
        }

        case "addDoc": {
          const id = genId()
          const op: WriteOp = { type: "set", collection: body.collection, id, data: body.data }
          const denied = await checkWrites(client, scope, [op])
          if (denied) return forbidden(denied)
          await writeOne(client, companyId, op)
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

          const ops: WriteOp[] = body.operations || []
          const denied = await checkWrites(client, scope, ops)
          if (denied) return forbidden(denied)
          for (const op of ops) {
            await writeOne(client, companyId, op)
          }
          return NextResponse.json({ ok: true })
        }

        default:
          return NextResponse.json({ error: `Operación desconocida: ${body.op}` }, { status: 400 })
      }
    })

    if (outcome.status === "no_company") {
      return forbidden("Este usuario no está asociado a ninguna empresa")
    }
    if (outcome.status === "disabled") {
      const message =
        outcome.reason === "account"
          ? "Esta cuenta fue desactivada. Contacta al administrador de la plataforma."
          : "Esta empresa fue desactivada. Contacta al administrador de la plataforma."
      return NextResponse.json({ error: message, code: `${outcome.reason}_disabled` }, { status: 403 })
    }
    return outcome.result
  } catch (err: any) {
    console.error("[api/db] Error:", err)
    return NextResponse.json({ error: err?.message || "Error de base de datos" }, { status: 500 })
  }
}
