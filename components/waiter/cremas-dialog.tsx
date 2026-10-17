"use client"
/**
 * components/waiter/cremas-dialog.tsx
 * ---------------------------------------------------------------------------
 * "¿Qué cremas lleva?" — se abre al agregar un producto con allowsCremas.
 * Varias cremas (o todas), "Sin cremas", y si van encima o aparte. Devuelve
 * el texto de la nota del ítem (lib/business/cremas.ts).
 * ---------------------------------------------------------------------------
 */
import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Check, Ban } from "lucide-react"
import { cremasNote, type CremasPlacement } from "@/lib/business/cremas"

interface Props {
  open: boolean
  productLabel: string
  cremas: string[]
  onCancel: () => void
  onConfirm: (note: string) => void
}

export function CremasDialog({ open, productLabel, cremas, onCancel, onConfirm }: Props) {
  const [selected, setSelected] = useState<string[]>([])
  const [none, setNone] = useState(false)
  const [placement, setPlacement] = useState<CremasPlacement>("encima")

  useEffect(() => {
    if (open) {
      setSelected([])
      setNone(false)
      setPlacement("encima")
    }
  }, [open])

  const toggle = (c: string) => {
    setNone(false)
    setSelected((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))
  }
  const allSelected = cremas.length > 0 && selected.length === cremas.length
  const canConfirm = none || selected.length > 0
  // Mantener el orden de la lista del local en la nota.
  const ordered = cremas.filter((c) => selected.includes(c))

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>¿Qué cremas lleva?</DialogTitle>
          <DialogDescription>{productLabel}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {cremas.map((c) => {
              const on = selected.includes(c)
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggle(c)}
                  className={cn(
                    "flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm text-left transition-colors",
                    on ? "border-primary bg-primary/10 font-semibold" : "border-border hover:bg-muted"
                  )}
                >
                  {c}
                  {on && <Check className="h-4 w-4 text-primary" />}
                </button>
              )
            })}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={allSelected ? "default" : "outline"}
              onClick={() => {
                setNone(false)
                setSelected(allSelected ? [] : [...cremas])
              }}
            >
              {allSelected ? "Quitar todas" : "Todas las cremas"}
            </Button>
            <Button
              type="button"
              variant={none ? "default" : "outline"}
              className={cn(none && "bg-destructive hover:bg-destructive/90 text-white")}
              onClick={() => {
                setSelected([])
                setNone((n) => !n)
              }}
            >
              <Ban className="h-4 w-4 mr-1" />
              Sin cremas
            </Button>
          </div>

          {!none && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">¿Cómo van?</p>
              <div className="grid grid-cols-2 gap-2">
                {(["encima", "aparte"] as CremasPlacement[]).map((p) => (
                  <Button key={p} type="button" variant={placement === p ? "default" : "outline"} onClick={() => setPlacement(p)}>
                    {p === "encima" ? "Encima" : "Aparte"}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground min-h-4">
            {canConfirm ? `Va a la comanda como: "${cremasNote(ordered, placement, none)}"` : "Elige las cremas o \"Sin cremas\"."}
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button onClick={() => onConfirm(cremasNote(ordered, placement, none))} disabled={!canConfirm}>
            Agregar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
