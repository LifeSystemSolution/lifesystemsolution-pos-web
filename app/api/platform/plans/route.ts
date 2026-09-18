/**
 * app/api/platform/plans/route.ts
 * ---------------------------------------------------------------------------
 * CRUD de planes de suscripción (nombre, máximo de sedes, costo mensual).
 * Informativo por ahora — no hay cobro automático conectado todavía, es la
 * base para cuando se active la parte de facturación del SaaS.
 * ---------------------------------------------------------------------------
 */
import { NextRequest, NextResponse } from "next/server"
import { getPool } from "@/lib/local/pg-client"
import { getPlatformOwnerSession } from "@/lib/local/platform-auth"

export const runtime = "nodejs"

function genId() {
  return `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

export async function GET(req: NextRequest) {
  if (!getPlatformOwnerSession(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }
  try {
    const { rows } = await getPool().query(
      `SELECT id, name, max_stores, price_monthly, currency, active, description, created_at, updated_at
       FROM plans ORDER BY max_stores ASC, created_at ASC`
    )
    return NextResponse.json({ plans: rows })
  } catch (err: any) {
    console.error("[api/platform/plans GET] Error:", err)
    return NextResponse.json({ error: err?.message || "Error del servidor" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!getPlatformOwnerSession(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }
  try {
    const body = await req.json()
    const { name, maxStores, priceMonthly, currency, description } = body
    if (!name || !maxStores) {
      return NextResponse.json({ error: "name y maxStores son requeridos" }, { status: 400 })
    }
    const id = genId()
    await getPool().query(
      `INSERT INTO plans (id, name, max_stores, price_monthly, currency, description)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, name, maxStores, priceMonthly ?? null, currency || "PEN", description || null]
    )
    return NextResponse.json({ id })
  } catch (err: any) {
    console.error("[api/platform/plans POST] Error:", err)
    return NextResponse.json({ error: err?.message || "Error del servidor" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  if (!getPlatformOwnerSession(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }
  try {
    const body = await req.json()
    const { id, name, maxStores, priceMonthly, currency, active, description } = body
    if (!id) {
      return NextResponse.json({ error: "Falta id" }, { status: 400 })
    }

    const fields: Record<string, any> = {
      name,
      max_stores: maxStores,
      price_monthly: priceMonthly,
      currency,
      active,
      description,
    }
    const sets: string[] = []
    const values: any[] = []
    for (const [column, value] of Object.entries(fields)) {
      if (value === undefined) continue
      values.push(value)
      sets.push(`${column} = $${values.length}`)
    }
    if (sets.length === 0) {
      return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 })
    }
    sets.push(`updated_at = now()`)

    values.push(id)
    await getPool().query(`UPDATE plans SET ${sets.join(", ")} WHERE id = $${values.length}`, values)

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error("[api/platform/plans PATCH] Error:", err)
    return NextResponse.json({ error: err?.message || "Error del servidor" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  if (!getPlatformOwnerSession(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")
    if (!id) {
      return NextResponse.json({ error: "Falta id" }, { status: 400 })
    }
    await getPool().query(`DELETE FROM plans WHERE id = $1`, [id])
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error("[api/platform/plans DELETE] Error:", err)
    return NextResponse.json({ error: err?.message || "Error del servidor" }, { status: 500 })
  }
}
