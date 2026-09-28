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
 * Filtrado: los `where` que se pueden expresar exacto en SQL (igualdad con
 * valores primitivos, rangos sobre strings) van a Postgres — ver
 * lib/local/db-query.ts. Antes se traía la colección ENTERA de la empresa (todas
 * las tiendas, todo el historial) y se filtraba en JS: era la causa principal
 * de la lentitud. Los nombres de campo y valores viajan SIEMPRE como
 * parámetros ($n), nunca concatenados en el SQL. applyQuery() en JS se sigue
 * aplicando después sobre el resultado, así que la semántica final es la
 * misma de antes; SQL solo recorta filas que JS igual habría descartado.
 *
 * `multi`: varias lecturas en UN request y UNA transacción. Lo usa el
 * polling de onSnapshot del shim — antes cada suscripción era un request
 * aparte cada 3 s. Cada lectura trae un hash del resultado anterior; si no
 * cambió, se responde `unchanged` sin mandar los datos otra vez.
 * ---------------------------------------------------------------------------
 */
import { createHash } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import type { PoolClient } from "pg"
import { withCompanyScope } from "@/lib/local/pg-client"
import { runGetDoc, runQuery } from "@/lib/local/db-query"
import { verifySessionToken } from "@/lib/local/auth"
import { checkWrites, type WriteOp } from "@/lib/local/db-access-policy"

export const runtime = "nodejs"

function genId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

function hashOf(value: unknown) {
  return createHash("sha1").update(JSON.stringify(value)).digest("base64")
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
          return NextResponse.json(await runGetDoc(client, scope, body.collection, body.id))
        }

        case "getDocs": {
          return NextResponse.json({ docs: await runQuery(client, scope, body) })
        }

        case "multi": {
          // Lecturas en secuencia sobre la misma conexión (un PoolClient no
          // admite queries en paralelo) — igual es un solo viaje HTTP y una
          // sola transacción, en vez de N requests.
          const reads: any[] = Array.isArray(body.reads) ? body.reads.slice(0, 50) : []
          const results = []
          for (const r of reads) {
            const result =
              r.kind === "doc"
                ? await runGetDoc(client, scope, r.collection, r.id)
                : { docs: await runQuery(client, scope, r) }
            const hash = hashOf(result)
            results.push(hash === r.hash ? { unchanged: true } : { hash, ...result })
          }
          return NextResponse.json({ results })
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
      // Token válido pero la cuenta ya no pertenece a ninguna empresa (se
      // borró, o es una sesión de otra base de datos): el shim cierra sesión.
      return NextResponse.json(
        { error: "Este usuario no está asociado a ninguna empresa", code: "no_company" },
        { status: 403 }
      )
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
