"use client"

import { useEffect, useRef, useState } from "react"
import { useAuth } from "@/contexts/auth-context"
import { subscribeToKitchenOrders, updateDocument, collections, sendItemsToKitchen, type Order } from "@/lib/firebase/firestore"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn, toPeruDate } from "@/lib/utils"
import { Clock, ChefHat, CheckCircle, Printer } from "lucide-react"
import { renderKitchenHTML, printHTML } from "@/lib/print/ticket-render"
import { useTicketConfig } from "@/lib/hooks/use-ticket-config"

// Tiempo estimado de preparación: pasado esto, un pedido "Preparando" pasa
// solo a "Listo" sin que nadie tenga que tocar la pantalla — ver
// docs/BUSINESS_RULES.md. El botón manual sigue disponible para cocina/admin
// como adelanto (comida lista antes de tiempo), nunca para el mesero.
const AUTO_READY_MS = 10 * 60 * 1000

export default function CocinaPage() {
  const { currentStoreId, currentStore, user } = useAuth()
  const ticketConfig = useTicketConfig()
  const [orders, setOrders] = useState<Order[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // El cocinero prepara y marca listo (o lo hace la app sola); el mesero solo
  // retira de cocina y marca "Entregado". Admins pueden hacer ambas cosas.
  const canManagePrep = user?.role !== "mesero"
  const canDeliver = user?.role !== "cocina"

  useEffect(() => {
    if (!currentStoreId) return

    const unsubscribe = subscribeToKitchenOrders(currentStoreId, (kitchenOrders) => {
      // Sort by creation time (oldest first)
      const sorted = kitchenOrders.sort((a, b) => {
        const timeA = a.createdAt?.toMillis() || 0
        const timeB = b.createdAt?.toMillis() || 0
        return timeA - timeB
      })
      setOrders(sorted)
      setIsLoading(false)
    })

    return () => unsubscribe()
  }, [currentStoreId])

  const handleStatusChange = async (orderId: string, newStatus: Order["status"]) => {
    try {
      console.debug("[kitchen:status-change:start]", { orderId, newStatus })
      if (newStatus === "preparing") {
        const order = orders.find((o) => o.id === orderId)
        if (order?.items?.length) {
          const pendingItemIds = order.items
            .map((item, index) => {
              const needsSend = !item.sentAt || (item.cancelled && !item.cancelAcknowledgedAt)
              if (!needsSend) return null
              return item.id || `legacy:${index}`
            })
            .filter((id): id is string => Boolean(id))
          if (pendingItemIds.length > 0) {
            await sendItemsToKitchen(orderId, pendingItemIds)
          }
        }
      }
      const updateData: any = { status: newStatus }
      // When changing to "ready", save the timestamp for proper sorting
      if (newStatus === "ready") {
        updateData.readyAt = new Date()
        const order = orders.find((o) => o.id === orderId)
        if (order?.items?.length) {
          updateData.items = order.items.map((item) => {
            if (item.cancelled) return item
            if (item.sentAt && !item.readyAt) {
              return { ...item, readyAt: new Date() }
            }
            return item
          })
        }
      }
      // El mesero (o admin) que retira el pedido de cocina queda registrado —
      // es el "registro de lo que entregó y lo que no" que pidió el negocio.
      if (newStatus === "delivered") {
        updateData.deliveredAt = new Date()
        updateData.deliveredBy = user?.id
        updateData.deliveredByName = user?.name
      }
      await updateDocument(collections.orders, orderId, updateData)
      console.debug("[kitchen:status-change:done]", { orderId, updateData })
    } catch (error) {
      console.error("Error updating order status:", error)
    }
  }

  // Transición automática Preparando → Listo, sin que nadie tenga que tocar
  // la pantalla: cuenta desde que se enviaron los items a cocina (sentAt).
  const autoMarkReady = async (order: Order) => {
    try {
      const updateData: any = { status: "ready", readyAt: new Date() }
      if (order.items?.length) {
        updateData.items = order.items.map((item) => {
          if (item.cancelled) return item
          if (item.sentAt && !item.readyAt) return { ...item, readyAt: new Date() }
          return item
        })
      }
      await updateDocument(collections.orders, order.id!, updateData)
      console.debug("[kitchen:auto-ready]", { orderId: order.id })
    } catch (error) {
      console.error("Error auto-marking order ready:", error)
    }
  }

  // Ref con los pedidos más recientes: el interval de abajo corre una sola
  // vez (deps vacíos) y necesita leer el estado actual sin quedarse con una
  // versión vieja capturada en el closure.
  const ordersRef = useRef<Order[]>(orders)
  useEffect(() => {
    ordersRef.current = orders
  }, [orders])

  const autoAdvancingRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      for (const order of ordersRef.current) {
        if (order.status !== "preparing" || !order.id) continue
        if (autoAdvancingRef.current.has(order.id)) continue

        const unreadyItems = (order.items || []).filter(
          (item) => !item.cancelled && item.sentAt && !item.readyAt
        )
        if (unreadyItems.length === 0) continue

        const sentTimes = unreadyItems
          .map((item) => (item.sentAt as any)?.toMillis?.())
          .filter((ms: unknown): ms is number => typeof ms === "number")
        if (sentTimes.length === 0) continue

        const earliestSentAt = Math.min(...sentTimes)
        if (now - earliestSentAt >= AUTO_READY_MS) {
          const orderId = order.id
          autoAdvancingRef.current.add(orderId)
          autoMarkReady(order).finally(() => autoAdvancingRef.current.delete(orderId))
        }
      }
    }, 15000)
    return () => clearInterval(interval)
  }, [])

  const handlePrintComanda = (order: Order) => {
    printHTML(renderKitchenHTML(order, currentStore || undefined, ticketConfig))
    // Imprimir la comanda ES la señal de "empecé a preparar" — reemplaza el
    // click manual de "Preparar" (ver docs/BUSINESS_RULES.md). Solo aplica
    // al imprimir desde la columna de Pendientes; reimprimir una comanda ya
    // en preparación o lista no debe tocar su estado.
    if (order.status === "open" && order.id) {
      handleStatusChange(order.id, "preparing")
    }
  }

  const getStatusColor = (status: Order["status"]) => {
    switch (status) {
      case "open":
        return "bg-destructive/20 border-destructive text-destructive"
      case "preparing":
        return "bg-secondary/20 border-secondary text-secondary"
      case "ready":
        return "bg-green-500/20 border-green-500 text-green-500"
      case "delivered":
        return "bg-blue-500/20 border-blue-500 text-blue-500"
      default:
        return "bg-muted border-border text-muted-foreground"
    }
  }

  const getStatusIcon = (status: Order["status"]) => {
    switch (status) {
      case "open":
        return <Clock className="h-5 w-5" />
      case "preparing":
        return <ChefHat className="h-5 w-5" />
      case "ready":
        return <CheckCircle className="h-5 w-5" />
      case "delivered":
        return <CheckCircle className="h-5 w-5" />
      default:
        return null
    }
  }

  const getStatusLabel = (status: Order["status"]) => {
    switch (status) {
      case "open":
        return "Pendiente"
      case "preparing":
        return "Preparando"
      case "ready":
        return "Listo"
      case "delivered":
        return "Entregado"
      default:
        return status
    }
  }

  const getTimeElapsed = (createdAt: any) => {
    if (!createdAt?.toDate) return ""
    // Use Peru timezone for both now and created time
    const now = toPeruDate(new Date())
    const created = toPeruDate(createdAt)
    const diffMs = now.getTime() - created.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    
    if (diffMins < 1) return "Ahora"
    if (diffMins < 60) return `${diffMins} min`
    const hours = Math.floor(diffMins / 60)
    const mins = diffMins % 60
    return `${hours}h ${mins}m`
  }

  // Cuenta regresiva visible hasta el paso automático a "Listo" — así el
  // equipo entiende por qué un pedido cambia de estado solo.
  const getAutoReadyHint = (order: Order) => {
    const unreadyItems = (order.items || []).filter((item) => !item.cancelled && item.sentAt && !item.readyAt)
    if (unreadyItems.length === 0) return ""
    const sentTimes = unreadyItems
      .map((item) => (item.sentAt as any)?.toMillis?.())
      .filter((ms: unknown): ms is number => typeof ms === "number")
    if (sentTimes.length === 0) return ""
    const earliestSentAt = Math.min(...sentTimes)
    const remainingMs = AUTO_READY_MS - (Date.now() - earliestSentAt)
    if (remainingMs <= 0) return "Pasando a Listo…"
    const remainingMin = Math.ceil(remainingMs / 60000)
    return `Listo automáticamente en ~${remainingMin} min`
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <div className="flex flex-col items-center gap-4">
          <Spinner className="h-12 w-12 text-primary" />
          <p className="text-muted-foreground">Cargando pedidos...</p>
        </div>
      </div>
    )
  }

  const buildColumnOrders = (stage: "pending" | "preparing" | "ready"): Order[] => {
    return orders
      .map((order) => {
        const items = order.items || []
        const stageItems = items.filter((item) => {
          if (item.cancelled) return false
          if (stage === "pending") return !item.sentAt
          if (stage === "preparing") return !!item.sentAt && !item.readyAt
          return !!item.readyAt
        })
        if (stageItems.length === 0) return null
        return { ...order, items: stageItems }
      })
      .filter((o): o is Order => Boolean(o))
  }

  // Group orders by item lifecycle stage (not whole order status)
  const pendingOrders = buildColumnOrders("pending")
  const preparingOrders = buildColumnOrders("preparing")
  const readyOrders = buildColumnOrders("ready").sort((a, b) => {
    const timeA = a.createdAt?.toMillis() || 0
    const timeB = b.createdAt?.toMillis() || 0
    return timeA - timeB
  })
  console.debug("[kitchen:columns]", {
    pending: pendingOrders.length,
    preparing: preparingOrders.length,
    ready: readyOrders.length,
  })

  const renderOrderColumn = (columnOrders: Order[], status: Order["status"], label: string, color: string) => {
    return (
      <div className="flex flex-col">
        {/* Column Header */}
        <div className={cn("p-4 rounded-t-lg border-b-2", color)}>
          <h2 className="text-lg sm:text-xl font-bold">{label}</h2>
          <p className="text-sm opacity-80">{columnOrders.length} pedido{columnOrders.length !== 1 ? "s" : ""}</p>
        </div>

        {/* Orders Container */}
        <div className="flex-1 space-y-3 p-3 sm:p-4 rounded-b-lg bg-muted/30 min-h-96 overflow-y-auto">
          {columnOrders.length > 0 ? (
            columnOrders.map((order) => (
              <div
                key={order.id}
                className={cn(
                  "rounded-lg border-2 overflow-hidden transition-all hover:shadow-lg",
                  getStatusColor(status)
                )}
              >
                {/* Order Header */}
                <div className="flex items-center justify-between p-2 sm:p-3 border-b border-current/20">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(status)}
                    <div>
                      <p className="font-bold text-sm sm:text-base">
                        {order.orderType === "takeout" ? "Para Llevar" : `Mesa ${order.tableNumber}`}
                      </p>
                      <p className="text-xs opacity-80">{getTimeElapsed(order.createdAt)}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 flex-shrink-0"
                    onClick={() => handlePrintComanda(order)}
                    title="Imprimir comanda"
                  >
                    <Printer className="h-4 w-4" />
                  </Button>
                </div>

                {/* Order Items */}
                <div className="p-3 bg-background/50">
                  <ul className="space-y-1">
                    {order.items.map((item, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-current/20 flex items-center justify-center text-xs font-bold">
                          {item.quantity}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-xs sm:text-sm truncate">
                            {item.productName}
                            {item.variantName && (
                              <span className="text-muted-foreground font-normal"> - {item.variantName}</span>
                            )}
                          </p>
                          {item.cancelled && (
                            <p className="text-[10px] font-bold text-destructive">CANCELADO</p>
                          )}
                          {item.notes && (
                            <p className="text-xs text-muted-foreground line-clamp-2">Nota: {item.notes}</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Order Actions */}
                <div className="p-2 sm:p-3 border-t border-current/20 bg-background/30">
                  {status === "open" && (
                    <p className="text-xs text-center text-muted-foreground py-1">
                      Imprime la comanda para empezar a preparar
                    </p>
                  )}
                  {status === "preparing" && (
                    <>
                      <p className="text-xs text-center text-muted-foreground mb-2">
                        {getAutoReadyHint(order)}
                      </p>
                      {canManagePrep && (
                        <Button
                          className="w-full h-9 text-xs sm:text-sm bg-green-500 hover:bg-green-500/90 text-white dark:text-white"
                          onClick={() => handleStatusChange(order.id!, "ready")}
                        >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Listo (adelantar)
                        </Button>
                      )}
                    </>
                  )}
                  {status === "ready" && (
                    canDeliver ? (
                      <Button
                        className="w-full h-9 text-xs sm:text-sm bg-blue-500 hover:bg-blue-500/90 text-white dark:text-white"
                        onClick={() => handleStatusChange(order.id!, "delivered")}
                      >
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Entregado
                      </Button>
                    ) : (
                      <p className="text-xs text-center text-muted-foreground py-1">
                        Esperando que el mesero lo retire
                      </p>
                    )
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p className="text-sm">Sin pedidos</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 h-full">
      {/* Stats Bar */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="p-2 sm:p-4 rounded-lg bg-destructive/10 border border-destructive/30">
          <p className="text-xl sm:text-3xl font-bold text-destructive">{pendingOrders.length}</p>
          <p className="text-xs sm:text-sm text-destructive/80">Pendientes</p>
        </div>
        <div className="p-2 sm:p-4 rounded-lg bg-secondary/10 border border-secondary/30">
          <p className="text-xl sm:text-3xl font-bold text-secondary">{preparingOrders.length}</p>
          <p className="text-xs sm:text-sm text-secondary/80">Preparando</p>
        </div>
        <div className="p-2 sm:p-4 rounded-lg bg-green-500/10 border border-green-500/30">
          <p className="text-xl sm:text-3xl font-bold text-green-500">{readyOrders.length}</p>
          <p className="text-xs sm:text-sm text-green-500/80">Listos</p>
        </div>
      </div>

      {/* Kanban Columns - Professional Kitchen Display */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {renderOrderColumn(
          pendingOrders,
          "open",
          "🔴 Pendientes",
          "bg-destructive/10 border-destructive/30"
        )}
        {renderOrderColumn(
          preparingOrders,
          "preparing",
          "🟡 Preparando",
          "bg-secondary/10 border-secondary/30"
        )}
        {renderOrderColumn(
          readyOrders,
          "ready",
          "🟢 Listos",
          "bg-green-500/10 border-green-500/30"
        )}
      </div>

      {/* Empty State */}
      {orders.length === 0 && (
        <div className="col-span-full text-center py-16">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
            <ChefHat className="h-10 w-10 text-muted-foreground" />
          </div>
          <p className="text-xl font-medium text-muted-foreground">
            No hay pedidos pendientes
          </p>
          <p className="text-sm text-muted-foreground/70">
            Los nuevos pedidos aparecerán aquí automáticamente
          </p>
        </div>
      )}
    </div>
  )
}
