"use client"

import { useState } from "react"
import { usePOS } from "@/contexts/pos-context"
import { TableGrid } from "@/components/waiter/table-grid"
import { ProductList } from "@/components/waiter/product-list"
import { Cart } from "@/components/waiter/cart"
import { OrderModal } from "@/components/waiter/order-modal"
import { Spinner } from "@/components/ui/spinner"
import { Button } from "@/components/ui/button"
import { ShoppingBag } from "lucide-react"
import type { Table } from "@/lib/firebase/firestore"

export default function MeseroPage() {
  const { tables, isLoading, selectedTable, selectTable, clearSelectedTable, readyOrders } = usePOS()
  const [showOrderModal, setShowOrderModal] = useState(false)
  const [showTakeoutModal, setShowTakeoutModal] = useState(false)

  const handleTableSelect = (table: Table) => {
    const status = table.status?.trim().toLowerCase()
    if (status === "available") {
      selectTable(table)
      setShowOrderModal(true)
    } else if (status === "occupied" || status === "reserved") {
      // Show existing order or allow adding more items
      selectTable(table)
      setShowOrderModal(true)
    }
  }

  const handleCloseModal = () => {
    setShowOrderModal(false)
    clearSelectedTable()
  }

  const handleCloseTakeoutModal = () => {
    setShowTakeoutModal(false)
    clearSelectedTable()
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <div className="flex flex-col items-center gap-4">
          <Spinner className="h-12 w-12 text-primary" />
          <p className="text-muted-foreground">Cargando mesas...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Legend + Takeout entry point */}
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-6">
        <div className="flex flex-wrap items-center gap-3 sm:gap-6 text-xs sm:text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-green-500/20 border border-green-500" />
            <span className="text-muted-foreground">Disponible</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-red-500/20 border border-red-500" />
            <span className="text-muted-foreground">Ocupada</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-yellow-500/20 border border-yellow-500" />
            <span className="text-muted-foreground">Reservada</span>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowTakeoutModal(true)}>
          <ShoppingBag className="h-4 w-4 mr-2" />
          Pedido para Llevar
        </Button>
      </div>

      {/* Tables Grid */}
      <TableGrid tables={tables} onTableSelect={handleTableSelect} readyOrders={readyOrders} />

      {/* Order Modal */}
      {showOrderModal && selectedTable && (
        <OrderModal table={selectedTable} onClose={handleCloseModal} />
      )}

      {/* Takeout Order Modal */}
      {showTakeoutModal && (
        <OrderModal onClose={handleCloseTakeoutModal} />
      )}
    </div>
  )
}
