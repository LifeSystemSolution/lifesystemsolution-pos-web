"use client"
/**
 * components/caja/stock-count-dialog.tsx
 * ---------------------------------------------------------------------------
 * Cierre del día de los rubros con features.closingStockCount (comida rápida):
 *
 *  - Checklist de conteo sobre la LISTA PROPIA del local (colección
 *    stock_items): lo que realmente se cuenta (pan, carne, papas, gaseosas…),
 *    no los platos de la carta. Se configura una vez ("Editar lista") y queda
 *    como predeterminada; hay una lista sugerida para empezar rápido.
 *  - Cada producto trae la última cantidad contada; se corrige lo que cambió
 *    y se marca "Comprar".
 *  - Al guardar: lastCount en cada stock_item + registro en stock_counts (con
 *    lo vendido del día) y, opcional, el ticket del cierre: VENDIDO HOY +
 *    CONTEO + POR COMPRAR.
 *
 * No toca inventory_items: en este rubro el stock no se descuenta por venta.
 * ---------------------------------------------------------------------------
 */
import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { ClipboardCheck, Pencil, Plus, Printer, Search, Trash2, ListChecks } from "lucide-react"
import { collections } from "@/lib/firebase/firestore"
import { collection, deleteDoc, doc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from "@/lib/local/firebase-shim/firestore"
import { db } from "@/lib/local/db-placeholder"
import { printHTML, renderStockCountHTML, type SalesTallyPrint, type StockCountLine } from "@/lib/print/ticket-render"
import type { TicketConfig } from "@/lib/print/ticket-config"

type StockItem = { id: string; name: string; category: string; order: number; lastCount: number }

/** Lista sugerida para un local de comida rápida (se edita libremente). */
const SUGGESTED: { category: string; names: string[] }[] = [
  { category: "PANES", names: ["Pan de hamburguesa", "Pan para hot dog", "Pan francés", "Tortillas"] },
  { category: "CARNES", names: ["Carne de hamburguesa", "Hot dog", "Chorizo", "Filete de pollo", "Milanesa", "Deshilachado", "Pollo broaster (piezas)", "Alitas"] },
  { category: "OTROS INSUMOS", names: ["Huevos", "Queso", "Plátano", "Papas", "Lechuga", "Tomate", "Aceite"] },
  { category: "BEBIDAS", names: ["Gaseosa personal", "Gaseosa 1 L", "Gaseosa 1½ L", "Agua"] },
  { category: "DESCARTABLES", names: ["Táper", "Bolsas", "Servilletas"] },
]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  storeId: string
  storeName?: string
  userId?: string
  userName?: string
  cashRegisterId?: string
  ticketConfig: TicketConfig
  /** Lo vendido en la caja que se cierra (va al ticket y al registro del conteo). */
  sales?: SalesTallyPrint
}

export function StockCountDialog({ open, onOpenChange, storeId, storeName, userId, userName, cashRegisterId, ticketConfig, sales }: Props) {
  const [items, setItems] = useState<StockItem[] | null>(null)
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [toBuy, setToBuy] = useState<Record<string, boolean>>({})
  // Filas donde la persona tocó "Comprar" a mano: ahí ya no se marca/desmarca solo.
  const [manualBuy, setManualBuy] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [editing, setEditing] = useState(false)
  const [newName, setNewName] = useState("")
  const [newCategory, setNewCategory] = useState("")

  const load = async () => {
    setError(null)
    try {
      const snap = await getDocs(query(collection(db, collections.stockItems), where("storeId", "==", storeId)))
      const list = snap.docs
        .map((d) => {
          const x = d.data() || {}
          return { id: d.id, name: String(x.name || ""), category: String(x.category || "OTROS"), order: Number(x.order) || 0, lastCount: Number(x.lastCount) || 0 }
        })
        .filter((i) => i.name)
        .sort((a, b) => a.category.localeCompare(b.category) || a.order - b.order || a.name.localeCompare(b.name))
      setItems(list)
      setCounts((c) => Object.fromEntries(list.map((i) => [i.id, c[i.id] ?? String(i.lastCount)])))
      setToBuy((t) => Object.fromEntries(list.map((i) => [i.id, t[i.id] ?? i.lastCount <= 0])))
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la lista")
    }
  }

  useEffect(() => {
    if (!open) return
    setItems(null)
    setCounts({})
    setToBuy({})
    setManualBuy({})
    setDone(false)
    setEditing(false)
    setFilter("")
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, storeId])

  const categories = useMemo(() => Array.from(new Set((items || []).map((i) => i.category))).sort(), [items])
  const visible = useMemo(() => {
    if (!items) return []
    const f = filter.trim().toLowerCase()
    return f ? items.filter((i) => i.name.toLowerCase().includes(f) || i.category.toLowerCase().includes(f)) : items
  }, [items, filter])

  const countOf = (id: string) => Math.max(0, Math.floor(Number(counts[id]) || 0))
  const setCount = (id: string, value: string) => {
    setCounts((c) => ({ ...c, [id]: value.replace(/[^\d]/g, "") }))
    // "Comprar" sigue a la cantidad (0 = comprar) mientras no se haya cambiado a mano.
    if (!manualBuy[id]) setToBuy((t) => ({ ...t, [id]: (Number(value) || 0) <= 0 }))
  }

  // ---- edición de la lista (configuración del local) ----
  const addItem = async (name: string, category: string, order = Date.now()) => {
    await setDoc(doc(collection(db, collections.stockItems)), {
      storeId,
      name: name.trim(),
      category: (category.trim() || "OTROS").toUpperCase(),
      order,
      lastCount: 0,
    })
  }
  const handleAdd = async () => {
    if (!newName.trim()) return
    if (items?.some((i) => i.name.toLowerCase() === newName.trim().toLowerCase())) {
      setError(`"${newName.trim()}" ya está en la lista`)
      return
    }
    setSaving(true)
    try {
      await addItem(newName, newCategory)
      setNewName("")
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo agregar")
    } finally {
      setSaving(false)
    }
  }
  const handleRemove = async (item: StockItem) => {
    if (!confirm(`¿Quitar "${item.name}" de la lista de conteo?`)) return
    setSaving(true)
    try {
      await deleteDoc(doc(db, collections.stockItems, item.id))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo quitar")
    } finally {
      setSaving(false)
    }
  }
  const handleSuggested = async () => {
    setSaving(true)
    try {
      const batch = writeBatch(db)
      let order = 1
      for (const g of SUGGESTED) {
        for (const name of g.names) {
          batch.set(doc(collection(db, collections.stockItems)), { storeId, name, category: g.category, order: order++, lastCount: 0 })
        }
      }
      await batch.commit()
      await load()
      setEditing(true) // para que revisen y ajusten la lista sugerida
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la lista sugerida")
    } finally {
      setSaving(false)
    }
  }

  // ---- guardar el conteo ----
  const save = async (print: boolean) => {
    if (!items) return
    // La ventana se abre en el click (antes del await): si no, el navegador la bloquea.
    const printWindow = print ? window.open("", "_blank") : null
    setSaving(true)
    setError(null)
    try {
      const now = new Date()
      const batch = writeBatch(db)
      for (const i of items) {
        batch.set(doc(db, collections.stockItems, i.id), { lastCount: countOf(i.id), lastCountAt: serverTimestamp() }, { merge: true })
      }
      batch.set(doc(collection(db, collections.stockCounts)), {
        storeId,
        cashRegisterId: cashRegisterId || null,
        userId: userId || null,
        userName: userName || null,
        createdAt: serverTimestamp(),
        items: items.map((i) => ({ stockItemId: i.id, category: i.category, name: i.name, previous: i.lastCount, counted: countOf(i.id), toBuy: !!toBuy[i.id] })),
        ...(sales ? { sales: { lines: sales.lines, totalAmount: sales.totalAmount, ordersCount: sales.ordersCount } } : {}),
      })
      await batch.commit()
      if (print) {
        const lines: StockCountLine[] = items.map((i) => ({ category: i.category, name: i.name, counted: countOf(i.id), toBuy: !!toBuy[i.id] }))
        printHTML(renderStockCountHTML(lines, { storeName, countedBy: userName, date: now }, ticketConfig, sales), printWindow)
      }
      setDone(true)
    } catch (err) {
      printWindow?.close()
      setError(err instanceof Error ? err.message : "No se pudo guardar el conteo")
    } finally {
      setSaving(false)
    }
  }

  const buyCount = items ? items.filter((i) => toBuy[i.id]).length : 0
  let lastCategory = ""

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-2xl max-h-[92vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary" />
            {editing ? "Lista de conteo del local" : "Conteo de stock del cierre"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "Lo que se cuenta al cerrar caja. Se configura una vez y queda como predeterminada."
              : "Revisa cuánto queda de cada producto (ya está cargado el último conteo), corrige lo que cambió y marca lo que hay que comprar."}
          </DialogDescription>
        </DialogHeader>

        {sales && !editing && !done && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm flex flex-wrap justify-between gap-2">
            <span>
              Vendido hoy: <b>{sales.lines.reduce((s, l) => s + l.quantity, 0)}</b> productos en <b>{sales.ordersCount}</b> pedidos
            </span>
            <span className="font-semibold">S/ {sales.totalAmount.toFixed(2)}</span>
          </div>
        )}

        {done ? (
          <div className="rounded-md border border-green-600/40 bg-green-600/10 p-4 text-sm">
            Cierre guardado. {buyCount > 0 ? `${buyCount} producto(s) marcados para comprar.` : "Nada marcado para comprar."}
          </div>
        ) : !items ? (
          <div className="flex items-center justify-center py-10">
            {error ? <p className="text-sm text-destructive">{error}</p> : <Spinner className="h-8 w-8 text-primary" />}
          </div>
        ) : items.length === 0 && !editing ? (
          <div className="py-8 text-center space-y-4">
            <ListChecks className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Este local todavía no tiene su lista de conteo. Se arma una sola vez con lo que cuentan cada noche.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => void handleSuggested()} disabled={saving}>
                Usar lista sugerida de comida rápida
              </Button>
              <Button variant="outline" onClick={() => setEditing(true)} disabled={saving}>
                Armar la lista desde cero
              </Button>
            </div>
          </div>
        ) : editing ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Input className="flex-1 min-w-40" placeholder="Producto (ej. Pan de hamburguesa)" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void handleAdd()} />
              <Input className="w-44" list="stock-categories" placeholder="Categoría (ej. PANES)" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void handleAdd()} />
              <datalist id="stock-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <Button onClick={() => void handleAdd()} disabled={saving || !newName.trim()}>
                <Plus className="h-4 w-4 mr-1" />
                Agregar
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto -mx-1 px-1">
              {items.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">Agrega el primer producto de la lista.</p>}
              {items.map((i) => {
                const header = i.category !== lastCategory
                lastCategory = i.category
                return (
                  <div key={i.id}>
                    {header && <p className="mt-3 mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-primary">{i.category}</p>}
                    <div className="flex items-center justify-between rounded-md px-2 py-1.5 odd:bg-muted/40">
                      <span className="text-sm">{i.name}</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => void handleRemove(i)} disabled={saving} title="Quitar de la lista">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </>
        ) : (
          <>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Buscar producto…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              </div>
              <Button variant="outline" onClick={() => setEditing(true)} title="Agregar o quitar productos de la lista">
                <Pencil className="h-4 w-4 mr-1" />
                Editar lista
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto -mx-1 px-1">
              <div className="grid grid-cols-[1fr_6rem_5.5rem] items-center gap-x-3 text-xs font-medium text-muted-foreground px-2 pb-1 sticky top-0 bg-background">
                <span>Producto</span>
                <span className="text-center">Hay</span>
                <span className="text-center">Comprar</span>
              </div>
              {visible.map((i) => {
                const header = i.category !== lastCategory
                lastCategory = i.category
                const zero = countOf(i.id) <= 0
                return (
                  <div key={i.id}>
                    {header && <p className="mt-3 mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-primary">{i.category}</p>}
                    <div className="grid grid-cols-[1fr_6rem_5.5rem] items-center gap-x-3 rounded-md px-2 py-1.5 odd:bg-muted/40">
                      <span className={`text-sm ${zero ? "font-semibold text-destructive" : ""}`}>{i.name}</span>
                      <Input inputMode="numeric" className="h-8 text-center" value={counts[i.id] ?? ""} onChange={(e) => setCount(i.id, e.target.value)} onFocus={(e) => e.target.select()} />
                      <div className="flex justify-center">
                        <Checkbox
                          checked={!!toBuy[i.id]}
                          onCheckedChange={(v) => {
                            setManualBuy((m) => ({ ...m, [i.id]: true }))
                            setToBuy((t) => ({ ...t, [i.id]: v === true }))
                          }}
                          aria-label={`Comprar ${i.name}`}
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
          ) : editing ? (
            <Button onClick={() => setEditing(false)} disabled={saving || !items?.length}>
              Listo, volver al conteo
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                Ahora no
              </Button>
              <Button variant="outline" onClick={() => void save(false)} disabled={saving || !items?.length}>
                Guardar
              </Button>
              <Button onClick={() => void save(true)} disabled={saving || !items?.length}>
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
