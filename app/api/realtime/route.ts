/**
 * app/api/realtime/route.ts
 * ---------------------------------------------------------------------------
 * Relay de Supabase Realtime → SSE. Reemplaza el polling de onSnapshot en
 * el shim (ver docs/SQL_MIGRATION_PLAN.md, sección "Reemplazo de
 * onSnapshot").
 *
 * El navegador NUNCA recibe una key de Supabase: este endpoint verifica el
 * JWT de sesión propio, resuelve la empresa, y abre su PROPIA suscripción a
 * Supabase Realtime (con la service role key, que se queda en el servidor)
 * filtrada por `company_id=eq.<esa empresa>` — así ni siquiera en tránsito
 * dentro del servidor se mezclan eventos de otra empresa. Cada evento se
 * reenvía al navegador por SSE.
 *
 * Simplificación consciente de esta primera versión: cada conexión SSE abre
 * su propia suscripción de Realtime (no se comparte una sola entre todos los
 * clientes conectados). Para el rango de sedes del que hablamos en el plan
 * (10-25) esto no es un problema; si más adelante se vuelve un cuello de
 * botella, se puede compartir una suscripción por empresa entre conexiones
 * sin cambiar el contrato con el navegador.
 *
 * EventSource no permite mandar headers custom, así que el token viaja como
 * query param (?token=...) en vez de Authorization — patrón común para SSE,
 * pero significa que puede quedar en logs de acceso. Nuestro JWT de sesión
 * dura 7 días (ver lib/local/auth.ts) — más que el ~1h de Firebase — así que
 * antes de producción con datos reales conviene reemplazar esto por un
 * "ticket" de un solo uso emitido por una ruta POST aparte, en vez del token
 * de sesión crudo.
 * ---------------------------------------------------------------------------
 */
import type { NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { verifySessionToken } from "@/lib/local/auth"
import { resolveCompanyId } from "@/lib/local/resolve-company"

export const runtime = "nodejs"

const HEARTBEAT_MS = 15_000 // mantiene viva la conexión a través de proxies/balanceadores

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")
  const collectionFilter = req.nextUrl.searchParams.get("collection") || undefined

  if (!token) {
    return new Response("Falta el token de autenticación", { status: 401 })
  }
  const session = verifySessionToken(token)
  if (!session) {
    return new Response("Token inválido o expirado", { status: 401 })
  }
  const companyId = await resolveCompanyId(session.accountId)
  if (!companyId) {
    return new Response("Este usuario no está asociado a ninguna empresa", { status: 403 })
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response("Falta configuración de Supabase en el servidor", { status: 500 })
  }

  const encoder = new TextEncoder()
  let heartbeat: ReturnType<typeof setInterval> | undefined

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }

      // Comentario SSE (":" al inicio se ignora como dato) — solo para que
      // intermediarios no corten la conexión por inactividad.
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(`: ping\n\n`)), HEARTBEAT_MS)

      const supabase = createClient(supabaseUrl, serviceRoleKey, {
        realtime: { params: { eventsPerSecond: 10 } },
      })

      const channel = supabase
        .channel(`documents-${companyId}-${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "documents", filter: `company_id=eq.${companyId}` },
          (payload) => {
            const row = (payload.new ?? payload.old) as { collection?: string; id?: string } | null
            if (!row?.collection) return
            if (collectionFilter && row.collection !== collectionFilter) return
            // No se manda el `data` del documento en el evento — el cliente
            // vuelve a pedirlo por /api/db (getDoc/getDocs), que ya aplica
            // el where/orderBy/limit correcto. Este evento es solo un "algo
            // cambió acá, refresca" (igual de simple que onSnapshot original
            // desde el punto de vista del que lo consume).
            send({ collection: row.collection, id: row.id, eventType: payload.eventType })
          }
        )
        .subscribe()

      const cleanup = () => {
        if (heartbeat) clearInterval(heartbeat)
        supabase.removeChannel(channel)
        try {
          controller.close()
        } catch {
          // ya estaba cerrado
        }
      }

      req.signal.addEventListener("abort", cleanup)
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat)
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
