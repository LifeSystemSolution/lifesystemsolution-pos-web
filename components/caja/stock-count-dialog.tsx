"use client"
/**
 * components/caja/stock-count-dialog.tsx
 * ---------------------------------------------------------------------------
 * Conteo de stock al cerrar caja (rubros con features.closingStockCount, p. ej.
 * comida rápida): checklist de todos los productos activos del local — una
 * línea por presentación (variante) y las masas de pizza si el local vende
 * pizza —, con la cantidad actual precargada para corregir solo lo que cambió
 * y una casilla "Comprar". Al guardar:
 *   - inventory_items.currentStock = lo contado (es el stock del local),
 *   - un registro en stock_counts (historial del conteo),
 *   - opcional: ticket con el stock y la lista POR COMPRAR para el día siguiente.
 * ---------------------------------------------------------------------------
 */
import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { ClipboardCheck, Printer, Search } from "lucide-react"
import {
  collections,
  getInventoryItemId,
  PIZZA_INVENTORY_CODES,
  PIZZA_MASS_TYPES,
  PIZZA_SIZE_LABELS,
  type Product,
} from "@/lib/firebase/firestore"
import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from "@/lib/local/firebase-shim/firestore"
import { db } from "@/lib/local/db-placeholder"
import { printHTML, renderStockCountHTML, type StockCountLine } from "@/lib/print/ticket-render"
import type { TicketConfig } from "@/lib/print/ticket-config"

type Row = {
  key: string // id del inventory_item
  category: string
  name: string
  productId: string
  variantId?: string
  productName: string
  variantName?: string
  previous: number
  extra?: Record<string, unknown> // campos para crear la fila de inventario si no existía
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  storeId: string
  storeName?: string
  userId?: string
  userName?: string
  cashRegisterId?: string
  ticketConfig: TicketConfig
}

export function StockCountDialog({ open, onOpenChange, storeId, storeName, userId, userName, cashRegisterId, ticketConfig }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [toBuy, setToBuy] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!open) return
    setRows(null)
    setError(null)
    setDone(false)
    setFilter("")
    ;(async () => {
      try {
        const [prodSnap, invSnap] = await Promise.all([
          getDocs(query(collection(db, collections.products), where("storeId", "==", storeId))),
          getDocs(query(collection(db, collections.inventoryItems), where("storeId", "==", storeId))),
        ])
        const stock = new Map(invSnap.docs.map((d) => [d.id, Number(d.data()?.currentStock) || 0]))
        const products = prodSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as Product)
          .filter((p) => p.active !== false)
        const list: Row[] = []
        for (const p of products) {
          if (p.category?.toLowerCase() === "pizzas") continue // los sabores no tienen stock propio: van las masas
          if (p.variants && p.variants.length > 0) {
            for (const v of p.variants) {
              const key = getInventoryItemId(storeId, { productId: p.id!, variantId: v.id, category: p.category })
              list.push({ key, category: p.category, name: `${p.name} - ${v.name}`, productId: p.id!, variantId: v.id, productName: p.name, variantName: v.name, previous: stock.get(key) ?? 0 })
            }
          } else {
            const key = getInventoryItemId(storeId, { productId: p.id!, category: p.category })
            list.push({ key, category: p.category, name: p.name, productId: p.id!, productName: p.name, previous: stock.get(key) ?? 0 })
          }
        }
        if (products.some((p) => p.category?.toLowerCase() === "pizzas")) {
          for (const mt of PIZZA_MASS_TYPES) {
            const key = `${storeId}_pizzamass_${mt}`
            list.push({
              key,
              category: "Masas de pizza",
              name: `Masa ${PIZZA_SIZE_LABELS[mt]}`,
              productId: PIZZA_INVENTORY_CODES[mt],
              variantId: mt,
              productName: `Masa ${PIZZA_SIZE_LABELS[mt]}`,
              variantName: PIZZA_SIZE_LABELS[mt],
              previous: stock.get(key) ?? 0,
              extra: { isPizzaMass: true, massType: mt, category: "pizzas" },
            })
          }
        }
        list.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
        setRows(list)
        setCounts(Object.fromEntries(list.map((r) => [r.key, String(r.previous)])))
        setToBuy(Object.fromEntries(list.map((r) => [r.key, r.previous <= 0])))
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudieron cargar los productos")
      }
    })()
  }, [open, storeId])

  const visible = useMemo(() => {
    if (!rows) return []
    const f = filter.trim().toLowerCase()
    return f ? rows.filter((r) => r.name.toLowerCase().includes(f) || r.category.toLowerCase().includes(f)) : rows
  }, [rows, filter])

  const countOf = (key: string) => Math.max(0, Math.floor(Number(counts[key]) || 0))

  const setCount = (key: string, value: string) => {
    setCounts((c) => ({ ...c, [key]: value.replace(/[^\d]/g, "") }))
    // Llegar a 0 marca "Comprar" solo; subirlo no lo desmarca (puede faltar igual).
    if ((Number(value) || 0) <= 0) setToBuy((t) => ({ ...t, [key]: true }))
  }

  const save = async (print: boolean) => {
    if (!rows) return
    // La ventana se abre en el click (antes del await): si no, el navegador la bloquea.
    const printWindow = print ? window.open("", "_blank") : null
    setSaving(true)
    setError(null)
    try {
      const now = new Date()
      const batch = writeBatch(db)
      for (const r of rows) {
        batch.set(
          doc(db, collections.inventoryItems, r.key),
          {
            storeId,
            productId: r.productId,
            ...(r.variantId ? { variantId: r.variantId } : {}),
            productName: r.productName,
            ...(r.variantName ? { variantName: r.variantName } : {}),
            ...(r.extra || {}),
            currentStock: countOf(r.key),
            lastUpdated: serverTimestamp(),
            lastCountAt: serverTimestamp(),
          },
          { merge: true }
        )
      }
      batch.set(doc(collection(db, collections.stockCounts)), {
        storeId,
        cashRegisterId: cashRegisterId || null,
        userId: userId || null,
        userName: userName || null,
        createdAt: serverTimestamp(),
        items: rows.map((r) => ({
          inventoryId: r.key,
          category: r.category,
          name: r.name,
          previous: r.previous,
          counted: countOf(r.key),
          toBuy: !!toBuy[r.key],
        })),
      })
      await batch.commit()
      if (print) {
        const lines: StockCountLine[] = rows.map((r) => ({
          category: r.category,
          name: r.name,
          counted: countOf(r.key),
          toBuy: !!toBuy[r.key],
        }))
        printHTML(renderStockCountHTML(lines, { storeName, countedBy: userName, date: now }, ticketConfig), printWindow)
      }
      setDone(true)
    } catch (err) {
      printWindow?.close()
      setError(err instanceof Error ? err.message : "No se pudo guardar el conteo")
    } finally {
      setSaving(false)
    }
  }

  const buyCount = rows ? rows.filter((r) => toBuy[r.key]).length : 0
  let lastCategory = ""

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-2xl max-h-[92vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary" />
            Conteo de stock del cierre
          </DialogTitle>
          <DialogDescription>
            Revisa cuánto queda de cada producto. Ya está cargado lo último registrado: cambia solo lo que no coincide y
            marca lo que hay que comprar mañana.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="rounded-md border border-green-600/40 bg-green-600/10 p-4 text-sm">
            Conteo guardado. {buyCount > 0 ? `${buyCount} producto(s) marcados para comprar.` : "Nada marcado para comprar."}
          </div>
        ) : !rows ? (
          <div className="flex items-center justify-center py-10">
            {error ? <p className="text-sm text-destructive">{error}</p> : <Spinner className="h-8 w-8 text-primary" />}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Este local todavía no tiene productos.</p>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Buscar producto…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <div className="flex-1 overflow-y-auto -mx-1 px-1">
              <div className="grid grid-cols-[1fr_6rem_5.5rem] items-center gap-x-3 text-xs font-medium text-muted-foreground px-2 pb-1 sticky top-0 bg-background">
                <span>Producto</span>
                <span className="text-center">Hay</span>
                <span className="text-center">Comprar</span>
              </div>
              {visible.map((r) => {
                const header = r.category !== lastCategory
                lastCategory = r.category
                const zero = countOf(r.key) <= 0
                return (
                  <div key={r.key}>
                    {header && (
                      <p className="mt-3 mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-primary">{r.category}</p>
                    )}
                    <div className="grid grid-cols-[1fr_6rem_5.5rem] items-center gap-x-3 rounded-md px-2 py-1.5 odd:bg-muted/40">
                      <span className={`text-sm ${zero ? "font-semibold text-destructive" : ""}`}>{r.name}</span>
                      <Input
                        inputMode="numeric"
                        className="h-8 text-center"
                        value={counts[r.key] ?? ""}
                        onChange={(e) => setCount(r.key, e.target.value)}
                        onFocus={(e) => e.target.select()}
                      />
                      <div className="flex justify-center">
                        <Checkbox
                          checked={!!toBuy[r.key]}
                          onCheckedChange={(v) => setToBuy((t) => ({ ...t, [r.key]: v === true }))}
                          aria-label={`Comprar ${r.name}`}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {done ? (
            <Button onClick={() => onOpenChange(false)}>Listo</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                Ahora no
              </Button>
              <Button variant="outline" onClick={() => void save(false)} disabled={saving || !rows?.length}>
                Guardar
              </Button>
              <Button onClick={() => void save(true)} disabled={saving || !rows?.length}>
                <Printer className="h-4 w-4 mr-1" />
                {saving ? "Guardando…" : `Guardar e imprimir${buyCount ? ` (${buyCount} por comprar)` : ""}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
