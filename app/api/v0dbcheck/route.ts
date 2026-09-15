import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    return NextResponse.json({ ok: false, reason: "missing_env", hasUrl: !!url, hasServiceKey: !!serviceKey })
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
    if (error) {
      return NextResponse.json({ ok: false, reason: "auth_error", message: error.message })
    }

    const users = data.users.map((u) => ({
      email: u.email,
      confirmed: !!u.email_confirmed_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      created_at: u.created_at,
    }))

    return NextResponse.json({ ok: true, count: users.length, users })
  } catch (e) {
    return NextResponse.json({ ok: false, reason: "exception", message: (e as Error).message })
  }
}
