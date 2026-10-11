"use client"
/**
 * components/platform/change-password-dialog.tsx
 * ---------------------------------------------------------------------------
 * "Cambiar contraseña" del dueño de la plataforma (su propia cuenta).
 * Ver app/api/platform/account/password/route.ts.
 * ---------------------------------------------------------------------------
 */
import { useEffect, useState } from "react"
import { platformFetch } from "@/lib/local/platform-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { CheckCircle2 } from "lucide-react"

export function ChangePasswordDialog({
  open,
  onOpenChange,
  email,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  email: string
}) {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [repeat, setRepeat] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (open) {
      setCurrent("")
      setNext("")
      setRepeat("")
      setError(null)
      setDone(false)
    }
  }, [open])

  const localError =
    next && next.length < 8
      ? "Mínimo 8 caracteres"
      : repeat && next !== repeat
        ? "Las contraseñas nuevas no coinciden"
        : null

  const handleSave = async () => {
    setError(null)
    setIsSaving(true)
    try {
      await platformFetch("/api/platform/account/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar la contraseña")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !isSaving && onOpenChange(v)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Cambiar mi contraseña</DialogTitle>
          <DialogDescription>Para la cuenta de dueño de la plataforma con la que entraste.</DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex items-start gap-2 rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm">
            <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
            <span>
              Contraseña cambiada. Desde ahora entra con la nueva. Si el navegador te ofrece actualizar la contraseña
              guardada, acepta.
            </span>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!localError && current && next && repeat) void handleSave()
            }}
          >
            {/* Ayuda al gestor de contraseñas del navegador a asociarla a esta cuenta */}
            <input type="text" name="username" autoComplete="username" value={email} className="hidden" readOnly />
            <div className="space-y-1.5">
              <Label>Contraseña actual</Label>
              <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Contraseña nueva</Label>
              <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="Mínimo 8 caracteres" />
            </div>
            <div className="space-y-1.5">
              <Label>Repite la contraseña nueva</Label>
              <Input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
            </div>
            {(localError || error) && <p className="text-sm text-destructive">{localError || error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSaving || !!localError || !current || !next || !repeat}>
                {isSaving ? "Guardando..." : "Cambiar contraseña"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {done && (
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Listo</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
