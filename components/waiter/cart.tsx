"use client"

import { useMemo, useState } from "react"
import { usePOS } from "@/contexts/pos-context"
import { useAuth } from "@/contexts/auth-context"
import { useStoreStock, quantityByInventory, remainingFor } from "@/lib/hooks/use-store-stock"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Minus, Plus, Trash2, MessageSquarePlus } from "lucide-react"
import { calculateItemTotal } from "@/lib/utils"

interface CartProps {
  onSendOrder: () => void
  isSending: boolean
}

export function Cart({ onSendOrder, isSending }: CartProps) {
  const { cart, getCartTotal, updateCartItemQuantity, updateCartItemNotes, removeFromCart, clearCart } = usePOS()
  const [editingNotesFor, setEditingNotesFor] = useState<string | null>(null)
  const { currentStoreId } = useAuth()
  const stock = useStoreStock(currentStoreId)
  // Todo lo del carrito que comparte inventario (p. ej. dos sabores de pizza
  // del mismo tamaño usan la misma masa) cuenta junto.
  const inCart = useMemo(
    () => (currentStoreId ? quantityByInventory(currentStoreId, cart) : new Map<string, number>()),
    [cart, currentStoreId]
  )

  if (cart.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-8 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-muted-foreground"
          >
            <circle cx="9" cy="21" r="1" />
            <circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
          </svg>
        </div>
        <p className="text-muted-foreground">El carrito está vacío</p>
        <p className="text-sm text-muted-foreground/70">Agrega productos para crear el pedido</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Cart Items */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {cart.map((item) => {
          // Cuántas unidades más se pueden sumar (null = stock aún no cargó).
          const left = currentStoreId ? remainingFor(stock, currentStoreId, item, inCart) : null
          const atLimit = left !== null && left <= 0
          return (
          <div
            key={item.tempId}
            className="p-3 rounded-lg bg-muted/30 border border-border space-y-2"
          >
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-foreground truncate">
                  {item.productName}
                  {item.variantName && (
                    <span className="text-muted-foreground font-normal"> - {item.variantName}</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  S/ {item.price.toFixed(2)} c/u
                  {atLimit && <span className="ml-2 font-semibold text-destructive">Sin más stock</span>}
                </p>
                {item.notes && editingNotesFor !== item.tempId && (
                  <p className="text-xs text-secondary mt-1 truncate">Nota: {item.notes}</p>
                )}
              </div>

              {/* Quantity Controls */}
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 sm:h-7 sm:w-7"
                  onClick={() => updateCartItemQuantity(item.tempId, item.quantity - 1)}
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <span className="w-8 text-center font-medium text-sm">{item.quantity}</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 sm:h-7 sm:w-7"
                  onClick={() => !atLimit && updateCartItemQuantity(item.tempId, item.quantity + 1)}
                  disabled={atLimit}
                  title={atLimit ? "No queda más stock de este producto" : undefined}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              {/* Notes Toggle */}
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 sm:h-7 sm:w-7 ${item.notes ? "text-secondary" : "text-muted-foreground"}`}
                onClick={() => setEditingNotesFor(editingNotesFor === item.tempId ? null : item.tempId)}
                title="Nota o alergia"
              >
                <MessageSquarePlus className="h-3.5 w-3.5" />
              </Button>

              {/* Remove Button */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 sm:h-7 sm:w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => removeFromCart(item.tempId)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>

              {/* Item Total */}
              <p className="w-16 text-right font-semibold text-sm text-primary">
                S/ {calculateItemTotal(item.price, item.quantity)}
              </p>
            </div>

            {editingNotesFor === item.tempId && (
              <Input
                autoFocus
                placeholder="Ej: sin salsa, alergia al maní..."
                value={item.notes || ""}
                maxLength={200}
                onChange={(e) => updateCartItemNotes(item.tempId, e.target.value)}
                onBlur={() => setEditingNotesFor(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setEditingNotesFor(null)
                }}
                className="h-8 text-sm"
              />
            )}
          </div>
          )
        })}
      </div>

      {/* Cart Footer */}
      <div className="border-t border-border pt-4 mt-4 space-y-4">
        {/* Total */}
        <div className="flex items-center justify-between">
          <span className="text-lg font-medium text-foreground">Total</span>
          <span className="text-2xl font-bold text-primary">
            S/ {getCartTotal().toFixed(2)}
          </span>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            className="flex-1 h-10"
            onClick={clearCart}
            disabled={isSending}
          >
            Limpiar
          </Button>
          <Button
            className="flex-1 h-10 bg-primary hover:bg-primary/90"
            onClick={onSendOrder}
            disabled={isSending}
          >
            {isSending ? "Enviando..." : "Enviar a Cocina"}
          </Button>
        </div>
      </div>
    </div>
  )
}
