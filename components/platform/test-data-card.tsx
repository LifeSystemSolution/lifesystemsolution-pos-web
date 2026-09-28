"use client"
/**
 * components/platform/test-data-card.tsx
 * ---------------------------------------------------------------------------
 * "Borrar datos de prueba" de una empresa o de un local, en
 * /plataforma/empresas/[id]. Muestra antes cuánto se va a borrar (GET) y
 * pide escribir el nombre exacto (el servidor lo vuelve a exigir).
 * ---------------------------------------------------------------------------
 */
import { useEffect, useState } from "react"
import { platformFetch } from "@/lib/local/platform-client"
import { ConfirmDeleteDialog } from "@/components/platform/confirm-delete-dialog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Eraser, CheckCircle2 } from "lucide-react"

const ALL = "__all__"

type Row = { collection: string; label: string; count: number }
type Preview = { confirmName: string; deleted: Row[]; totalDeleted: number }
type Result = Preview & {
  stock: { restoredUnits: number; inventoryItems: number; missingItems: number }
  tablesFreed: number
}

interface Props {
  companyId: string
  stores: { id: string; name?: string }[]
  onDone?: () => void
  onError?: (err: unknown) => void
}

export function TestDataCard({ companyId, stores, onDone, onError }: Props) {
  const [scope, setScope] = useState<string>(ALL)
  const [restoreStock, setRestoreStock] = useState(true)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  const storeId = scope === ALL ? null : scope
  const base = `/api/platform/companies/${companyId}/test-data`

  const loadPreview = async () => {
    setIsLoading(true)
    try {
      setPreview(await platformFetch(storeId ? `${base}?storeId=${encodeURIComponent(storeId)}` : base))
    } catch (err) {
      onError?.(err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    setResult(null)
    void loadPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, companyId])

  const handleConfirm = async () => {
    try {
      const res: Result = await platformFetch(base, {
        method: "POST",
        body: JSON.stringify({ storeId, confirm: preview?.confirmName, restoreStock }),
      })
      setResult(res)
      await loadPreview()
      onDone?.()
    } catch (err) {
      onError?.(err)
      throw err
    }
  }

  const scopeLabel = storeId ? `el local ${preview?.confirmName ?? ""}` : "toda la empresa"

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Eraser className="h-5 w-5" />
          Datos de prueba
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Borra las ventas, cajas, movimientos, gastos, comprobantes e historial generados al probar. <b>No toca</b>{" "}
          productos, mesas, usuarios, locales, cuentas ni la configuración.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
          <div className="space-y-1.5">
            <Label>Qué limpiar</Label>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Toda la empresa (todos los locales)</SelectItem>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    Solo el local {s.name || s.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm cursor-pointer pb-2">
            <span>Devolver al stock lo que se vendió</span>
            <Switch checked={restoreStock} onCheckedChange={setRestoreStock} />
          </label>
        </div>

        <div className="rounded-md border border-border p-3 text-sm">
          {isLoading && !preview ? (
            <p className="text-muted-foreground">Calculando…</p>
          ) : preview && preview.totalDeleted > 0 ? (
            <>
              <p className="mb-2 font-medium">
                Se borrarán {preview.totalDeleted} registros de {scopeLabel}:
              </p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-muted-foreground">
                {preview.deleted.map((r) => (
                  <li key={r.collection} className="flex justify-between gap-2">
                    <span>{r.label}</span>
                    <span className="font-mono text-foreground">{r.count}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-muted-foreground">No hay datos de operación en {scopeLabel}. Nada que borrar.</p>
          )}
        </div>

        <Button
          variant="destructive"
          size="sm"
          disabled={!preview || preview.totalDeleted === 0 || isLoading}
          onClick={() => setShowConfirm(true)}
        >
          <Eraser className="h-4 w-4 mr-1" />
          Borrar datos de prueba
        </Button>

        {result && (
          <div className="rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm space-y-1">
            <p className="flex items-center gap-2 font-medium text-green-500">
              <CheckCircle2 className="h-4 w-4" />
              Listo: {result.totalDeleted} registros borrados.
            </p>
            {restoreStock && (
              <p className="text-muted-foreground">
                Stock devuelto: {result.stock.restoredUnits} unidades en {result.stock.inventoryItems} productos
                {result.stock.missingItems > 0 ? ` (${result.stock.missingItems} ya no existían)` : ""}.
              </p>
            )}
            {result.tablesFreed > 0 && <p className="text-muted-foreground">Mesas liberadas: {result.tablesFreed}.</p>}
          </div>
        )}

        <ConfirmDeleteDialog
          open={showConfirm}
          onOpenChange={setShowConfirm}
          title="Borrar datos de prueba"
          description={`Se borran definitivamente ${preview?.totalDeleted ?? 0} registros de ${scopeLabel} (ventas, cajas, movimientos, gastos, comprobantes). Los reportes quedarán en cero. No se puede deshacer.`}
          confirmText={preview?.confirmName ?? ""}
          confirmLabel="Borrar datos de prueba"
          onConfirm={handleConfirm}
        />
      </CardContent>
    </Card>
  )
}
