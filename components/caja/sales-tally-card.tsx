"use client"
/**
 * components/caja/sales-tally-card.tsx
 * ---------------------------------------------------------------------------
 * "Vendido hoy" en caja (rubros con features.dailySalesTally): cantidad y
 * monto por producto de lo cobrado desde que se abrió caja. Empieza en 0 en
 * cada apertura. Se puede imprimir en cualquier momento.
 * ---------------------------------------------------------------------------
 */
import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { BarChart3, Printer, ChevronDown, ChevronUp } from "lucide-react"
import type { SalesTally } from "@/lib/business/sales-tally"

const COLLAPSED_ROWS = 8

export function SalesTallyCard({ tally, onPrint }: { tally: SalesTally; onPrint: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const rows = expanded ? tally.lines : tally.lines.slice(0, COLLAPSED_ROWS)
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Vendido hoy
          </CardTitle>
          <Button size="sm" variant="outline" onClick={onPrint} disabled={tally.lines.length === 0}>
            <Printer className="h-4 w-4 mr-1" />
            Imprimir
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Desde que se abrió caja · se reinicia en cada apertura</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-muted/40 p-2">
            <p className="text-xs text-muted-foreground">Pedidos</p>
            <p className="text-lg font-bold">{tally.ordersCount}</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-2">
            <p className="text-xs text-muted-foreground">Productos</p>
            <p className="text-lg font-bold">{tally.totalUnits}</p>
          </div>
          <div className="rounded-lg bg-primary/10 p-2">
            <p className="text-xs text-muted-foreground">Monto</p>
            <p className="text-lg font-bold text-primary">S/ {tally.totalAmount.toFixed(2)}</p>
          </div>
        </div>
        {tally.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-2">Todavía no hay ventas cobradas en esta caja.</p>
        ) : (
          <div className="space-y-1">
            {rows.map((l) => (
              <div key={l.name} className="flex items-center justify-between gap-2 text-sm rounded px-2 py-1 odd:bg-muted/40">
                <span className="truncate">{l.name}</span>
                <span className="flex items-center gap-3 shrink-0">
                  <span className="font-semibold">{l.quantity}</span>
                  <span className="w-20 text-right text-muted-foreground">S/ {l.total.toFixed(2)}</span>
                </span>
              </div>
            ))}
            {tally.lines.length > COLLAPSED_ROWS && (
              <Button variant="ghost" size="sm" className="w-full" onClick={() => setExpanded((e) => !e)}>
                {expanded ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
                {expanded ? "Ver menos" : `Ver los ${tally.lines.length} productos`}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
