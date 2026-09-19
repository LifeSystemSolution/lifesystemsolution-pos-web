"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertTriangle } from "lucide-react"

interface ConfirmDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Qué se va a perder — se muestra en rojo para que se lea antes de confirmar. */
  description: string
  /** Texto exacto que hay que escribir para habilitar el botón (el servidor lo vuelve a exigir). */
  confirmText: string
  confirmLabel?: string
  onConfirm: () => Promise<void>
}

// Borrado destructivo: hay que escribir el nombre exacto. Es la misma barrera
// que exige el servidor (?confirm=...), así que no se puede saltar desde acá.
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  confirmLabel = "Eliminar definitivamente",
  onConfirm,
}: ConfirmDeleteDialogProps) {
  const [typed, setTyped] = useState("")
  const [isWorking, setIsWorking] = useState(false)

  useEffect(() => {
    if (open) setTyped("")
  }, [open])

  const handleConfirm = async () => {
    setIsWorking(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !isWorking && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-destructive/90">{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <p className="text-sm text-muted-foreground">
            Para confirmar, escribe <span className="font-mono font-semibold text-foreground">{confirmText}</span>
          </p>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={confirmText} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isWorking}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isWorking || typed.trim() !== confirmText}>
            {isWorking ? "Eliminando..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
