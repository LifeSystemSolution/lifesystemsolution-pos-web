"use client"
/**
 * components/platform/ticket-settings-card.tsx
 * ---------------------------------------------------------------------------
 * Formato de impresión de UNA empresa (recibo de venta + comanda de cocina),
 * en /plataforma/empresas/[id]. La vista previa usa exactamente el mismo
 * generador que imprime el POS (lib/print/ticket-render.ts), con un pedido de
 * ejemplo — lo que se ve acá es lo que sale en la impresora.
 * ---------------------------------------------------------------------------
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { platformFetch } from "@/lib/local/platform-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Printer, Save, RotateCcw, Receipt } from "lucide-react"
import {
  DEFAULT_TICKET_CONFIG,
  FONT_SCALES,
  FONT_SCALE_LABELS,
  PAPER_LABELS,
  PAPER_SIZES,
  PAPER_SPECS,
  type FontScale,
  type PaperSize,
  type TicketConfig,
} from "@/lib/print/ticket-config"
import { printHTML, renderKitchenHTML, renderReceiptHTML, sampleOrder } from "@/lib/print/ticket-render"

type Tab = "business" | "receipt" | "kitchen"
const PREVIEW_WIDTH = 340 // px disponibles para la hoja en la vista previa
const MM_TO_PX = 3.78

interface Props {
  companyId: string
  initial: TicketConfig
  sampleStoreName?: string
  onSaved?: () => void
  onError?: (err: unknown) => void
}

export function TicketSettingsCard({ companyId, initial, sampleStoreName, onSaved, onError }: Props) {
  const [draft, setDraft] = useState<TicketConfig>(initial)
  const [tab, setTab] = useState<Tab>("business")
  const [isSaving, setIsSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => setDraft(initial), [initial])

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const setBusiness = (patch: Partial<TicketConfig["business"]>) =>
    setDraft((d) => ({ ...d, business: { ...d.business, ...patch } }))
  const setReceipt = (patch: Partial<TicketConfig["receipt"]>) =>
    setDraft((d) => ({ ...d, receipt: { ...d.receipt, ...patch } }))
  const setKitchen = (patch: Partial<TicketConfig["kitchen"]>) =>
    setDraft((d) => ({ ...d, kitchen: { ...d.kitchen, ...patch } }))

  const previewKind = tab === "kitchen" ? "kitchen" : "receipt"
  const previewPaper = previewKind === "kitchen" ? draft.kitchen.paper : draft.receipt.paper
  const previewHtml = useMemo(() => {
    const store = { name: sampleStoreName || "Sede Central" }
    return previewKind === "kitchen"
      ? renderKitchenHTML(sampleOrder(), store, draft)
      : renderReceiptHTML(sampleOrder(), store, draft)
  }, [draft, previewKind, sampleStoreName])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await platformFetch(`/api/platform/companies/${companyId}`, {
        method: "PATCH",
        body: JSON.stringify({ ticketSettings: draft }),
      })
      setSavedAt(Date.now())
      onSaved?.()
    } catch (err) {
      onError?.(err)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-5 w-5" />
          Formato de impresión
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Aplica a todos los locales de esta empresa. Los cambios llegan al POS al guardar (los equipos abiertos los
          toman al volver a la pestaña, o en menos de un minuto).
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-6">
          {/* Formulario */}
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList className="mb-4">
              <TabsTrigger value="business">Negocio</TabsTrigger>
              <TabsTrigger value="receipt">Recibo de venta</TabsTrigger>
              <TabsTrigger value="kitchen">Comanda de cocina</TabsTrigger>
            </TabsList>

            <TabsContent value="business" className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Nombre comercial" hint="Vacío = nombre del local">
                  <Input value={draft.business.name} maxLength={120} onChange={(e) => setBusiness({ name: e.target.value })} />
                </Field>
                <Field label="RUC">
                  <Input value={draft.business.ruc} maxLength={20} onChange={(e) => setBusiness({ ruc: e.target.value })} />
                </Field>
                <Field label="Dirección">
                  <Input value={draft.business.address} maxLength={200} onChange={(e) => setBusiness({ address: e.target.value })} />
                </Field>
                <Field label="Teléfono">
                  <Input value={draft.business.phone} maxLength={60} onChange={(e) => setBusiness({ phone: e.target.value })} />
                </Field>
              </div>
              <Field label="Líneas adicionales" hint="Una por línea: redes sociales, web, eslogan…">
                <Textarea
                  rows={3}
                  value={draft.business.extraLines}
                  maxLength={500}
                  placeholder={"@multipizza\nwww.multipizza.pe"}
                  onChange={(e) => setBusiness({ extraLines: e.target.value })}
                />
              </Field>
            </TabsContent>

            <TabsContent value="receipt" className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <PaperSelect value={draft.receipt.paper} onChange={(paper) => setReceipt({ paper })} />
                <FontSelect value={draft.receipt.fontScale} onChange={(fontScale) => setReceipt({ fontScale })} />
                <Field label="Título">
                  <Input value={draft.receipt.title} maxLength={60} onChange={(e) => setReceipt({ title: e.target.value })} />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                <Toggle label="Nombre del local" checked={draft.receipt.showStoreName} onChange={(v) => setReceipt({ showStoreName: v })} />
                <Toggle label="N° de pedido" checked={draft.receipt.showOrderNumber} onChange={(v) => setReceipt({ showOrderNumber: v })} />
                <Toggle label="Mesa / Para llevar" checked={draft.receipt.showTable} onChange={(v) => setReceipt({ showTable: v })} />
                <Toggle label="Fecha y hora" checked={draft.receipt.showDateTime} onChange={(v) => setReceipt({ showDateTime: v })} />
                <Toggle label="Quién atendió" checked={draft.receipt.showWaiter} onChange={(v) => setReceipt({ showWaiter: v })} />
                <Toggle label="Observaciones" checked={draft.receipt.showNotes} onChange={(v) => setReceipt({ showNotes: v })} />
                <Toggle label="Subtotal" checked={draft.receipt.showSubtotals} onChange={(v) => setReceipt({ showSubtotals: v })} />
                <Toggle label="Forma de pago" checked={draft.receipt.showPaymentMethod} onChange={(v) => setReceipt({ showPaymentMethod: v })} />
                <Toggle label="Tiempo estimado" checked={draft.receipt.showEstimatedTime} onChange={(v) => setReceipt({ showEstimatedTime: v })} />
              </div>
              {draft.receipt.showEstimatedTime && (
                <Field label="Texto del tiempo estimado">
                  <Input
                    value={draft.receipt.estimatedTimeText}
                    maxLength={60}
                    onChange={(e) => setReceipt({ estimatedTimeText: e.target.value })}
                  />
                </Field>
              )}
              <Field label="Pie del recibo" hint="Una por línea">
                <Textarea
                  rows={3}
                  value={draft.receipt.footerText}
                  maxLength={500}
                  onChange={(e) => setReceipt({ footerText: e.target.value })}
                />
              </Field>
            </TabsContent>

            <TabsContent value="kitchen" className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <PaperSelect value={draft.kitchen.paper} onChange={(paper) => setKitchen({ paper })} />
                <FontSelect value={draft.kitchen.fontScale} onChange={(fontScale) => setKitchen({ fontScale })} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                <Toggle label="Hora del pedido" checked={draft.kitchen.showTime} onChange={(v) => setKitchen({ showTime: v })} />
                <Toggle label="Mesero" checked={draft.kitchen.showWaiter} onChange={(v) => setKitchen({ showWaiter: v })} />
                <Toggle label="Observaciones" checked={draft.kitchen.showNotes} onChange={(v) => setKitchen({ showNotes: v })} />
                <Toggle
                  label="Aviso de pedido atrasado (+10 min)"
                  checked={draft.kitchen.showLateWarning}
                  onChange={(v) => setKitchen({ showLateWarning: v })}
                />
              </div>
            </TabsContent>

            <div className="flex flex-wrap items-center gap-2 pt-6">
              <Button size="sm" onClick={handleSave} disabled={isSaving || !dirty}>
                <Save className="h-4 w-4 mr-1" />
                {isSaving ? "Guardando..." : "Guardar formato"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => printHTML(previewHtml)}>
                <Printer className="h-4 w-4 mr-1" />
                Imprimir prueba
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(DEFAULT_TICKET_CONFIG)}>
                <RotateCcw className="h-4 w-4 mr-1" />
                Valores por defecto
              </Button>
              {dirty ? (
                <span className="text-xs text-amber-500">Cambios sin guardar</span>
              ) : savedAt ? (
                <span className="text-xs text-green-500">Guardado</span>
              ) : null}
            </div>
          </Tabs>

          {/* Vista previa */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Vista previa — {previewKind === "kitchen" ? "comanda" : "recibo"} en {PAPER_LABELS[previewPaper]}
            </p>
            <PaperPreview html={previewHtml} paper={previewPaper} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm cursor-pointer">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

function PaperSelect({ value, onChange }: { value: PaperSize; onChange: (v: PaperSize) => void }) {
  return (
    <Field label="Papel">
      <Select value={value} onValueChange={(v) => onChange(v as PaperSize)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAPER_SIZES.map((p) => (
            <SelectItem key={p} value={p}>
              {PAPER_LABELS[p]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

function FontSelect({ value, onChange }: { value: FontScale; onChange: (v: FontScale) => void }) {
  return (
    <Field label="Tamaño de letra">
      <Select value={value} onValueChange={(v) => onChange(v as FontScale)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FONT_SCALES.map((f) => (
            <SelectItem key={f} value={f}>
              {FONT_SCALE_LABELS[f]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

/** La hoja a escala real dentro de un iframe, achicada para que entre en PREVIEW_WIDTH. */
function PaperPreview({ html, paper }: { html: string; paper: PaperSize }) {
  const spec = PAPER_SPECS[paper]
  const paddingMm = spec.thermal ? 0 : 12 // margen de página de las hojas (en papel lo pone @page)
  const widthPx = Math.round((spec.widthMm - paddingMm * 2) * MM_TO_PX)
  const padPx = Math.round(paddingMm * MM_TO_PX)
  const outerPx = widthPx + padPx * 2
  const scale = Math.min(1, PREVIEW_WIDTH / outerPx)
  const [contentHeight, setContentHeight] = useState(400)
  const frameRef = useRef<HTMLIFrameElement>(null)

  const measure = () => {
    const doc = frameRef.current?.contentDocument
    if (doc) setContentHeight(Math.max(200, doc.documentElement.scrollHeight))
  }

  const outerHeight = contentHeight + padPx * 2
  return (
    <div
      className="rounded-md border border-border bg-muted/30 p-3 overflow-auto"
      style={{ width: PREVIEW_WIDTH + 24, maxHeight: 640 }}
    >
      <div style={{ width: outerPx * scale, height: outerHeight * scale }}>
        <div
          className="bg-white shadow-md origin-top-left"
          style={{ width: outerPx, height: outerHeight, padding: padPx, transform: `scale(${scale})` }}
        >
          <iframe
            ref={frameRef}
            title="Vista previa de impresión"
            srcDoc={html}
            onLoad={measure}
            sandbox="allow-same-origin"
            style={{ width: widthPx, height: contentHeight, border: 0, display: "block" }}
          />
        </div>
      </div>
    </div>
  )
}
