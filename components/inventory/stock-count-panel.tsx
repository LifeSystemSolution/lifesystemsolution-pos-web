"use client"
/**
 * components/inventory/stock-count-panel.tsx
 * ---------------------------------------------------------------------------
 * "Conteo de stock" (rubros sin inventario por producto, ej. comida rápida):
 * reemplaza a /inventario. Muestra lo que quedó en el último conteo de la
 * lista propia del local (stock_items), lo que hay que comprar, el historial
 * de conteos (stock_counts) con reimpresión, y permite contar a cualquier hora
 * con el mismo diálogo del cierre de caja.
 * ---------------------------------------------------------------------------
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { ClipboardCheck, Printer, Search, ShoppingCart } from "lucide-react"
import { collections } from "@/lib/firebase/firestore"
import { collection, getDocs, query, where } from "@/lib/local/firebase-shim/firestore"
import { db } from "@/lib/local/db-placeholder"
import { StockCountDialog } from "@/components/caja/stock-count-dialog"
import { useAuth } from "@/contexts/auth-context"
import { useTicketConfig } from "@/lib/hooks/use-ticket-config"
import { printHTML, renderStockCountHTML, type SalesTallyPrint } from "@/lib/print/ticket-render"
import { toPeruDate } from "@/lib/utils"

type Item = { id: string; name: string; category: string; order: number; lastCount: number; lastCountAt: Date | null }
type CountRecord = {
  id: string
  date: Date
  userName: string
  items: { category: string; name: string; counted: number; toBuy: boolean }[]
  sales?: SalesTallyPrint
}

const toDate = (v: any): Date | null => {
  if (!v) return null
  const d = typeof v?.toDate === "function" ? v.toDate() : new Date(v)
  return isNaN(d.getTime()) ? null : d
}

const fmt = (d: Date | null) =>
  d
    ? toPeruDate(d).toLocaleString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—"

export function StockCountPanel() {
  const { currentStoreId, currentStore, user } = useAuth()
  const ticketConfig = useTicketConfig()
  const [items, setItems] = useState<Item[] | null>(null)
  const [counts, setCounts] = useState<CountRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState("")
  const [onlyToBuy, setOnlyToBuy] = useState(false)
  const [showDialog, setShowDialog] = useState(false)

  const load = useCallback(async () => {
    if (!currentStoreId) return
    setError(null)
    try {
      const [itemSnap, countSnap] = await Promise.all([
        getDocs(query(collection(db, collections.stockItems), where("storeId", "==", currentStoreId))),
        getDocs(query(collection(db, collections.stockCounts), where("storeId", "==", currentStoreId))),
      ])
      setItems(
        itemSnap.docs
          .map((d) => {
            const x = d.data() || {}
            return {
              id: d.id,
              name: String(x.name || ""),
              category: String(x.category || "OTROS"),
              order: Number(x.order) || 0,
              lastCount: Number(x.lastCount) || 0,
              lastCountAt: toDate(x.lastCountAt),
            }
          })
          .filter((i) => i.name)
          .sort((a, b) => a.category.localeCompare(b.category) || a.order - b.order || a.name.localeCompare(b.name))
      )
      setCounts(
        countSnap.docs
          .map((d) => {
            const x = d.data() || {}
            return {
              id: d.id,
              date: toDate(x.createdAt) || new Date(0),
              userName: String(x.userName || ""),
              items: Array.isArray(x.items) ? x.items : [],
              sales: x.sales || undefined,
            }
          })
          .sort((a, b) => b.date.getTime() - a.date.getTime())
          .slice(0, 20)
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el conteo")
    }
  }, [currentStoreId])

  useEffect(() => {
    void load()
  }, [load])

  const toBuyIds = useMemo(() => {
    // "Por comprar" = lo marcado en el último conteo (o lo que quedó en 0 si aún no hay conteos).
    const last = counts[0]
    if (last) return new Set(last.items.filter((i) => i.toBuy).map((i) => i.name.toLowerCase()))
    return new Set((items || []).filter((i) => i.lastCount <= 0).map((i) => i.name.toLowerCase()))
  }, [counts, items])

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return (items || []).filter(
      (i) =>
        (!onlyToBuy || toBuyIds.has(i.name.toLowerCase())) &&
        (!f || i.name.toLowerCase().includes(f) || i.category.toLowerCase().includes(f))
    )
  }, [items, filter, onlyToBuy, toBuyIds])

  const reprint = (c: CountRecord) => {
    printHTML(
      renderStockCountHTML(c.items, { storeName: currentStore?.name, countedBy: c.userName, date: c.date }, ticketConfig, c.sales)
    )
  }

  if (!currentStoreId) return null
  let lastCategory = ""

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-primary" />
            Conteo de stock
          </h1>
          <p className="text-sm text-muted-foreground">
            En este local el stock no se descuenta por venta: se cuenta a mano, normalmente al cerrar caja.
          </p>
        </div>
        <Button onClick={() => setShowDialog(true)}>
          <ClipboardCheck className="h-4 w-4 mr-2" />
          Hacer conteo ahora
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
            <span>Lo que quedó en el último conteo</span>
            <span className="text-xs font-normal text-muted-foreground">
              {counts[0] ? `${fmt(counts[0].date)} · ${counts[0].userName || "—"}` : "Aún no hay conteos"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Buscar producto…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <Button variant={onlyToBuy ? "default" : "outline"} onClick={() => setOnlyToBuy((v) => !v)}>
              <ShoppingCart className="h-4 w-4 mr-2" />
              Por comprar ({toBuyIds.size})
            </Button>
          </div>

          {items === null ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-8 w-8" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              El local todavía no tiene lista de conteo. Toca <b>Hacer conteo ahora</b> para armarla (hay una lista sugerida).
            </p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Nada coincide con el filtro.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {visible.map((i) => {
                const header = i.category !== lastCategory
                lastCategory = i.category
                const buy = toBuyIds.has(i.name.toLowerCase())
                return (
                  <div key={i.id}>
                    {header && <p className="pt-3 pb-1 text-xs font-semibold text-primary uppercase tracking-wider">{i.category}</p>}
                    <div className="flex items-center justify-between py-2 text-sm">
                      <span className="flex items-center gap-2">
                        {i.name}
                        {buy && <Badge variant="destructive" className="text-[10px]">Comprar</Badge>}
                      </span>
                      <span className={buy ? "font-semibold text-destructive" : "font-semibold"}>{i.lastCount}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Historial de conteos</CardTitle>
        </CardHeader>
        <CardContent>
          {counts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Sin conteos registrados.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {counts.map((c) => {
                const buy = c.items.filter((i) => i.toBuy).length
                return (
                  <div key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">{fmt(c.date)}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {[c.userName, `${c.items.length} productos`, `${buy} por comprar`, c.sales ? `vendido S/ ${Number(c.sales.totalAmount || 0).toFixed(2)}` : "", c.sales ? "" : "fuera del cierre"]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => reprint(c)}>
                      <Printer className="h-4 w-4 mr-1" />
                      Reimprimir
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <StockCountDialog
        open={showDialog}
        onOpenChange={(open) => {
          setShowDialog(open)
          if (!open) void load()
        }}
        storeId={currentStoreId}
        storeName={currentStore?.name}
        userId={user?.id}
        userName={user?.name}
        ticketConfig={ticketConfig}
      />
    </div>
  )
}
