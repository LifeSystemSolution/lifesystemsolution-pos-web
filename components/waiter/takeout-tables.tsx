"use client"
/**
 * components/waiter/takeout-tables.tsx
 * ---------------------------------------------------------------------------
 * Pedidos para llevar pendientes de cobro, mostrados como "mesas temporales"
 * con el nombre del cliente. Desaparecen solos al cobrarse en caja.
 * También el diálogo que pide el nombre al crear uno nuevo.
 * ---------------------------------------------------------------------------
 */
import { useEffect, useState } from "react"
import type { Order } from "@/lib/firebase/firestore"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ShoppingBag } from "lucide-react"
import { cn } from "@/lib/utils"

const STATUS_LABELS: Record<string, string> = {
  open: "Pendiente",
  preparing: "Preparando",
  ready: "Listo",
  delivered: "Entregado",
}

export function pendingTakeoutOrders(orders: Order[]) {
  return orders
    .filter(
      (o) =>
        o.orderType === "takeout" &&
        o.paymentStatus === "pending" &&
        !o.cancelled &&
        !o.deleted &&
        o.status !== "cancelled"
    )
    .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0))
}

interface TakeoutTablesProps {
  orders: Order[]
  readyOrders?: Order[]
  onSelect: (order: Order) => void
}

export function TakeoutTables({ orders, readyOrders = [], onSelect }: TakeoutTablesProps) {
  if (orders.length === 0) return null
  const readyIds = new Set(readyOrders.map((o) => o.id))

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Para llevar</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-4">
        {orders.map((order) => {
          const ready = readyIds.has(order.id) || order.status === "ready"
          return (
            <button
              key={order.id}
              onClick={() => onSelect(order)}
              className={cn(
                "rounded-xl border-2 border-dashed p-3 flex flex-col items-center justify-center gap-1 min-h-[96px] relative transition-all hover:scale-105 active:scale-95",
                "bg-orange-500/10 border-orange-500/60 hover:border-orange-500 hover:bg-orange-500/20"
              )}
            >
              {ready && (
                <div className="absolute -top-2 -right-2 w-6 h-6 sm:w-7 sm:h-7 bg-blue-500 rounded-full border-2 border-background flex items-center justify-center">
                  <span className="text-white text-xs sm:text-sm font-bold">!</span>
                </div>
              )}
              <ShoppingBag className="h-5 w-5 text-orange-500" />
              <p className="font-bold text-sm sm:text-base text-foreground text-center line-clamp-2 break-words w-full">
                {order.customerName?.trim() || "Sin nombre"}
              </p>
              <p className="text-[10px] sm:text-xs text-muted-foreground">
                S/ {Number(order.total || 0).toFixed(2)} · {STATUS_LABELS[order.status] || order.status}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface TakeoutNameDialogProps {
  open: boolean
  onCancel: () => void
  onConfirm: (customerName: string) => void
}

export function TakeoutNameDialog({ open, onCancel, onConfirm }: TakeoutNameDialogProps) {
  const [name, setName] = useState("")
  useEffect(() => {
    if (open) setName("")
  }, [open])
  const trimmed = name.trim()
  const submit = () => trimmed && onConfirm(trimmed)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Pedido para llevar</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <label htmlFor="takeout-customer" className="text-sm text-muted-foreground">
            Nombre del cliente
          </label>
          <Input
            id="takeout-customer"
            autoFocus
            maxLength={40}
            placeholder="Ej. Juan"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <p className="text-xs text-muted-foreground">
            Se crea una mesa temporal con este nombre hasta que se cobre el pedido.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!trimmed}>
            Continuar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
