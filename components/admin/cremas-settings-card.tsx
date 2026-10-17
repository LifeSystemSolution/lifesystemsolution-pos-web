"use client"
/**
 * components/admin/cremas-settings-card.tsx
 * ---------------------------------------------------------------------------
 * Admin → Productos: las cremas que ofrece el local al agregar un producto
 * con "Lleva cremas". Se guarda en store_settings/{storeId}_cremas.
 * ---------------------------------------------------------------------------
 */
import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, X } from "lucide-react"
import { useStoreCremas } from "@/lib/hooks/use-store-cremas"

export function CremasSettingsCard({ storeId }: { storeId: string }) {
  const { cremas, configured, save } = useStoreCremas(storeId)
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const persist = async (list: string[]) => {
    setSaving(true)
    setError(null)
    try {
      await save(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar")
    } finally {
      setSaving(false)
    }
  }

  const add = async () => {
    const n = name.trim()
    if (!n) return
    if (cremas.some((c) => c.toLowerCase() === n.toLowerCase())) {
      setError(`"${n}" ya está en la lista`)
      return
    }
    await persist([...cremas, n])
    setName("")
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Cremas del local</CardTitle>
        <p className="text-xs text-muted-foreground">
          Se ofrecen al agregar un producto con <b>"Lleva cremas"</b> (encima, aparte o sin cremas).
          {!configured && " Esta es la lista por defecto: cualquier cambio la guarda para el local."}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {cremas.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 pl-3 pr-1 py-1 text-sm">
              {c}
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-destructive/15 hover:text-destructive disabled:opacity-50"
                onClick={() => void persist(cremas.filter((x) => x !== c))}
                disabled={saving}
                aria-label={`Quitar ${c}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          {cremas.length === 0 && <span className="text-sm text-muted-foreground">Sin cremas configuradas.</span>}
        </div>
        <div className="flex gap-2">
          <Input placeholder="Nueva crema (ej. Huancaína)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
          <Button onClick={() => void add()} disabled={saving || !name.trim()}>
            <Plus className="h-4 w-4 mr-1" />
            Agregar
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
