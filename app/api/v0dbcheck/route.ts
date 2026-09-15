import { createClient } from "@supabase/supabase-js"
import { Pool } from "pg"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

function hostOf(v?: string) {
  if (!v) return null
  try {
    return new URL(v).host
  } catch {
    return "unparseable"
  }
}

export async function GET() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL

  const env = {
    SUPABASE_URL_host: hostOf(process.env.SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_URL_host: hostOf(process.env.NEXT_PUBLIC_SUPABASE_URL),
    hasServiceKey: !!serviceKey,
    hasDATABASE_URL: !!process.env.DATABASE_URL,
    hasPOSTGRES_URL: !!process.env.POSTGRES_URL,
    hasAUTH_JWT_SECRET: !!process.env.AUTH_JWT_SECRET,
    dbUrl_host: hostOf(dbUrl?.replace(/^postgres/, "http")),
  }

  const result: Record<string, unknown> = { env }

  // 1) Supabase Auth (listUsers) via service role
  if (url && serviceKey) {
    try {
      const admin = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
      if (error) {
        result.authUsers = { ok: false, message: error.message }
      } else {
        result.authUsers = {
          ok: true,
          count: data.users.length,
          emails: data.users.map((u) => u.email).sort(),
        }
      }
    } catch (e) {
      result.authUsers = { ok: false, message: (e as Error).message }
    }
  } else {
    result.authUsers = { ok: false, message: "missing url/serviceKey" }
  }

  // 2) Postgres direct — tablas de la app
  if (dbUrl) {
    const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, max: 2 })
    try {
      const tables = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`
      )
      const out: Record<string, unknown> = { ok: true, tables: tables.rows.map((r) => r.table_name) }
      for (const t of ["companies", "auth_accounts", "company_members", "documents"]) {
        try {
          const c = await pool.query(`SELECT count(*)::int AS n FROM ${t}`)
          out[t] = c.rows[0].n
        } catch (e) {
          out[t] = `error: ${(e as Error).message}`
        }
      }
      try {
        const accts = await pool.query<{ email: string }>(`SELECT email FROM auth_accounts ORDER BY email`)
        out.auth_accounts_emails = accts.rows.map((r) => r.email)
      } catch (e) {
        out.auth_accounts_emails = `error: ${(e as Error).message}`
      }
      result.postgres = out
    } catch (e) {
      result.postgres = { ok: false, message: (e as Error).message }
    } finally {
      await pool.end()
    }
  } else {
    result.postgres = { ok: false, message: "missing DATABASE_URL/POSTGRES_URL" }
  }

  return NextResponse.json(result)
}
