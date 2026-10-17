"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Clock, User, ChevronRight } from "lucide-react"
import { describeMovement, movementAmountText, type MovementDirection } from "@/lib/business/movement-label"
import { cn, toPeruDate } from "@/lib/utils"
import Link from "next/link"

export interface FinancialMovementDisplay {
  id: string
  type?: string // "sale" | "expense" | "cash_movement" | etc
  movementType?: string // entrada/salida (for cash movements)
  category?: string
  amount: number
  description: string
  origin?: string // "caja_operativa" | "caja_fuerte"
  userId: string
  userName: string
  timestamp: any // Firestore Timestamp
  source?: string // backward compat: "cash_register" | "safe_box"
  fromBox?: string
  toBox?: string
}

const DIRECTION_STYLE: Record<MovementDirection, { icon: typeof Clock; color: string }> = {
  in: { icon: ArrowDownLeft, color: "text-green-600" },
  out: { icon: ArrowUpRight, color: "text-destructive" },
  move: { icon: ArrowLeftRight, color: "text-blue-600" },
}

export interface RecentMovementsProps {
  movements: FinancialMovementDisplay[]
}

export function RecentMovements({ movements }: RecentMovementsProps) {
  const formatTime = (date: any) => {
    const d = date instanceof Date ? date : date.toDate?.() || new Date(date)
    const peruDate = toPeruDate(d)
    return peruDate.toLocaleTimeString("es-PE", {
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  if (movements.length === 0) {
    return (
      <div className="text-center py-4 text-sm text-muted-foreground">
        Sin movimientos
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {movements.slice(0, 5).map((m) => {
        const d = describeMovement(m)
        const { icon: Icon, color } = DIRECTION_STYLE[d.direction]
        return (
          <div key={m.id} className="space-y-1 pb-3 border-b border-border/40 last:border-0 last:pb-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className={cn("mt-0.5 flex-shrink-0", color)}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{d.title}</p>
                  {d.detail && <p className="text-xs text-muted-foreground truncate">{d.detail}</p>}
                </div>
              </div>
              <p className={cn("font-bold text-sm flex-shrink-0", color)}>{movementAmountText(m)}</p>
            </div>

            {/* Time and User */}
            <div className="flex items-center gap-3 text-xs text-muted-foreground ml-6">
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>{formatTime(m.timestamp)}</span>
              </div>
              <div className="flex items-center gap-1 truncate">
                <User className="h-3 w-3" />
                <span className="truncate">{m.userName}</span>
              </div>
            </div>
          </div>
        )
      })}
      
      {/* Link to full history */}
      <Link href="/admin/finanzas">
        <Button
          variant="outline"
          className="w-full mt-3 justify-between"
          size="sm"
        >
          <span>Ver historial completo</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </Link>
    </div>
  )
}
