"use client"
/**
 * components/platform/ticket-settings-card.tsx
 * ---------------------------------------------------------------------------
 * Formato de impresión de UNA empresa (nota de venta + comanda de cocina),
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
import { Printer, Save, RotateCcw, Receipt, ImagePlus, Trash2, QrCode } from "lucide-react"
import {
  DEFAULT_TICKET_CONFIG,
  FONT_FAMILIES,
  FONT_FAMILY_LABELS,
  FONT_SCALES,
  FONT_SCALE_LABELS,
  LOGO_MAX_CHARS,
  LOGO_SIZES,
  LOGO_SIZE_LABELS,
  PAPER_LABELS,
  PAPER_SIZES,
  PAPER_SPECS,
  QR_MODES,
  QR_MODE_LABELS,
  type FontFamily,
  type FontScale,
  type LogoSize,
  type PaperSize,
  type QrMode,
  type TicketConfig,
} from "@/lib/print/ticket-config"
import { printHTML, renderKitchenHTML, renderReceiptHTML, sampleOrder } from "@/lib/print/ticket-render"

type Tab = "business" | "receipt" | "kitchen"
const PREVIEW_WIDTH = 340 // px disponibles para la hoja en la vista previa
const MM_TO_PX = 3.78
/** 576 px = ancho del cabezal de una térmica de 80 mm a 203 dpi: más resolución no se nota. */
const LOGO_MAX_WIDTH = 576
const LOGO_MAX_HEIGHT = 320

interface Props {
  companyId: string
  initial: TicketConfig
  sampleStoreName?: string
  onSaved?: () => void
  onError?: (err: unknown) => void
}

type ImageMode = "color" | "gray" | "bw"

/**
 * Reduce la imagen, la aplana sobre fondo blanco (un PNG transparente puede
 * salir negro en térmica) y la pasa a escala de grises ("gray") o a blanco y
 * negro puro ("bw", para QR: módulos nítidos). Todo en el navegador: al
 * servidor solo llega el data URL ya procesado.
 */
async function processImage(file: File, mode: ImageMode, maxW: number, maxH: number): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) {
    throw new Error("Formato no soportado. Usa PNG, JPG, WEBP, GIF o SVG.")
  }
  if (file.size > 8 * 1024 * 1024) throw new Error("La imagen pesa más de 8 MB.")
  const url = URL.createObjectURL(file)
  try {
    // onload y no img.decode(): decode() no se resuelve mientras la pestaña está oculta.
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error("No se pudo leer la imagen."))
      el.src = url
    })
    const w0 = img.naturalWidth || 400
    const h0 = img.naturalHeight || 200
    const scale = Math.min(1, maxW / w0, maxH / h0)
    const w = Math.max(1, Math.round(w0 * scale))
    const h = Math.max(1, Math.round(h0 * scale))
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")!
    ctx.fillStyle = "#fff"
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    if (mode !== "color") {
      const data = ctx.getImageData(0, 0, w, h)
      const px = data.data
      for (let i = 0; i < px.length; i += 4) {
        let l = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2])
        if (mode === "bw") l = l < 150 ? 0 : 255
        px[i] = px[i + 1] = px[i + 2] = l
      }
      ctx.putImageData(data, 0, 0)
    }
    let out = canvas.toDataURL("image/png")
    if (out.length > LOGO_MAX_CHARS) out = canvas.toDataURL("image/jpeg", 0.85)
    if (out.length > LOGO_MAX_CHARS) out = canvas.toDataURL("image/jpeg", 0.6)
    if (out.length > LOGO_MAX_CHARS) throw new Error("La imagen es demasiado pesada; prueba con una versión más simple.")
    return out
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function TicketSettingsCard({ companyId, initial, sampleStoreName, onSaved, onError }: Props) {
  const [draft, setDraft] = useState<TicketConfig>(initial)
  const [tab, setTab] = useState<Tab>("business")
  const [isSaving, setIsSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [logoGray, setLogoGray] = useState(true)
  const [logoError, setLogoError] = useState<string | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const qrFileRef = useRef<HTMLInputElement>(null)

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

  const handleLogo = async (file: File | undefined) => {
    if (!file) return
    setLogoError(null)
    try {
      setBusiness({ logo: await processImage(file, logoGray ? "gray" : "color", LOGO_MAX_WIDTH, LOGO_MAX_HEIGHT) })
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "No se pudo leer la imagen")
    } finally {
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const handleQrImage = async (file: File | undefined) => {
    if (!file) return
    setQrError(null)
    try {
      setReceipt({ qrImage: await processImage(file, "bw", 600, 600) })
    } catch (err) {
      setQrError(err instanceof Error ? err.message : "No se pudo leer la imagen")
    } finally {
      if (qrFileRef.current) qrFileRef.current.value = ""
    }
  }

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
              <TabsTrigger value="receipt">Nota de venta</TabsTrigger>
              <TabsTrigger value="kitchen">Comanda de cocina</TabsTrigger>
            </TabsList>

            <TabsContent value="business" className="space-y-5">
              {/* Logo */}
              <div className="space-y-2">
                <Label>Logo</Label>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex h-20 w-40 items-center justify-center rounded-md border border-dashed border-border bg-white p-2">
                    {draft.business.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={draft.business.logo} alt="Logo" className="max-h-full max-w-full object-contain" />
                    ) : (
                      <span className="text-xs text-neutral-500">Sin logo</span>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                        className="hidden"
                        onChange={(e) => void handleLogo(e.target.files?.[0])}
                      />
                      <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                        <ImagePlus className="h-4 w-4 mr-1" />
                        {draft.business.logo ? "Cambiar logo" : "Subir logo"}
                      </Button>
                      {draft.business.logo && (
                        <Button size="sm" variant="ghost" onClick={() => setBusiness({ logo: "" })}>
                          <Trash2 className="h-4 w-4 mr-1" />
                          Quitar
                        </Button>
                      )}
                    </div>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                      <Switch checked={logoGray} onCheckedChange={setLogoGray} />
                      Convertir a blanco y negro al subir (recomendado para térmica)
                    </label>
                  </div>
                  <div className="w-40">
                    <Field label="Tamaño en el ticket">
                      <Select value={draft.business.logoSize} onValueChange={(v) => setBusiness({ logoSize: v as LogoSize })}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LOGO_SIZES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {LOGO_SIZE_LABELS[s]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                </div>
                {logoError && <p className="text-xs text-destructive">{logoError}</p>}
                <p className="text-xs text-muted-foreground">
                  Mejor resultado: logo sobre fondo blanco, en horizontal y con trazos gruesos.
                </p>
              </div>

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

            <TabsContent value="receipt" className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <PaperSelect value={draft.receipt.paper} onChange={(paper) => setReceipt({ paper })} />
                <Field label="Título del documento">
                  <Input value={draft.receipt.title} maxLength={60} onChange={(e) => setReceipt({ title: e.target.value })} />
                </Field>
                <FontSelect value={draft.receipt.fontScale} onChange={(fontScale) => setReceipt({ fontScale })} />
                <Field label="Tipo de letra">
                  <Select value={draft.receipt.fontFamily} onValueChange={(v) => setReceipt({ fontFamily: v as FontFamily })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FONT_FAMILIES.map((f) => (
                        <SelectItem key={f} value={f}>
                          {FONT_FAMILY_LABELS[f]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                <Toggle label="Logo" checked={draft.receipt.showLogo} onChange={(v) => setReceipt({ showLogo: v })} />
                <Toggle label="N° de nota" checked={draft.receipt.showOrderNumber} onChange={(v) => setReceipt({ showOrderNumber: v })} />
                <Toggle label="Fecha y hora" checked={draft.receipt.showDateTime} onChange={(v) => setReceipt({ showDateTime: v })} />
                <Toggle label="Nombre del local" checked={draft.receipt.showStoreName} onChange={(v) => setReceipt({ showStoreName: v })} />
                <Toggle label="Mesa / Para llevar" checked={draft.receipt.showTable} onChange={(v) => setReceipt({ showTable: v })} />
                <Toggle label="Quién atendió" checked={draft.receipt.showWaiter} onChange={(v) => setReceipt({ showWaiter: v })} />
                <Toggle label="Observaciones" checked={draft.receipt.showNotes} onChange={(v) => setReceipt({ showNotes: v })} />
                <Toggle label="Subtotal" checked={draft.receipt.showSubtotals} onChange={(v) => setReceipt({ showSubtotals: v })} />
                <Toggle label="Importe en letras (SON: …)" checked={draft.receipt.showAmountInWords} onChange={(v) => setReceipt({ showAmountInWords: v })} />
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
              <Field label="Mensaje final" hint="Una por línea">
                <Textarea
                  rows={2}
                  value={draft.receipt.footerText}
                  maxLength={500}
                  onChange={(e) => setReceipt({ footerText: e.target.value })}
                />
              </Field>

              {/* Código QR */}
              <div className="rounded-md border border-border p-4 space-y-3">
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <QrCode className="h-4 w-4" />
                    Código QR al final de la nota
                  </span>
                  <Switch checked={draft.receipt.qrEnabled} onCheckedChange={(v) => setReceipt({ qrEnabled: v })} />
                </label>
                {draft.receipt.qrEnabled && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field label="Texto sobre el QR">
                        <Input value={draft.receipt.qrTitle} maxLength={60} onChange={(e) => setReceipt({ qrTitle: e.target.value })} />
                      </Field>
                      <Field label="¿De dónde sale el QR?">
                        <Select value={draft.receipt.qrMode} onValueChange={(v) => setReceipt({ qrMode: v as QrMode })}>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {QR_MODES.map((m) => (
                              <SelectItem key={m} value={m}>
                                {QR_MODE_LABELS[m]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>

                    {draft.receipt.qrMode === "link" ? (
                      <>
                        <Field label="Enlace del QR" hint="Web, Instagram, WhatsApp (wa.me/51...), carta digital…">
                          <Input
                            value={draft.receipt.qrUrl}
                            maxLength={300}
                            placeholder="https://instagram.com/multipizza"
                            onChange={(e) => setReceipt({ qrUrl: e.target.value })}
                          />
                        </Field>
                        <Toggle
                          label="Mostrar el enlace debajo del QR"
                          checked={draft.receipt.qrShowUrl}
                          onChange={(v) => setReceipt({ qrShowUrl: v })}
                        />
                        {!draft.receipt.qrUrl.trim() && (
                          <p className="text-xs text-amber-500">Sin enlace el QR no se imprime.</p>
                        )}
                      </>
                    ) : (
                      <div className="flex flex-wrap items-center gap-4">
                        <div className="flex h-28 w-28 items-center justify-center rounded-md border border-dashed border-border bg-white p-1">
                          {draft.receipt.qrImage ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={draft.receipt.qrImage} alt="QR" className="max-h-full max-w-full object-contain" />
                          ) : (
                            <span className="text-xs text-neutral-500 text-center">Sin imagen</span>
                          )}
                        </div>
                        <div className="space-y-2">
                          <input
                            ref={qrFileRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                            className="hidden"
                            onChange={(e) => void handleQrImage(e.target.files?.[0])}
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" onClick={() => qrFileRef.current?.click()}>
                              <QrCode className="h-4 w-4 mr-1" />
                              {draft.receipt.qrImage ? "Cambiar imagen del QR" : "Subir imagen del QR"}
                            </Button>
                            {draft.receipt.qrImage && (
                              <Button size="sm" variant="ghost" onClick={() => setReceipt({ qrImage: "" })}>
                                <Trash2 className="h-4 w-4 mr-1" />
                                Quitar
                              </Button>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground max-w-xs">
                            Sube la imagen del QR recortada al cuadrado (sin bordes grandes). Se convierte a blanco y
                            negro para que se escanee bien en la térmica.
                          </p>
                          {qrError && <p className="text-xs text-destructive">{qrError}</p>}
                          {!draft.receipt.qrImage && (
                            <p className="text-xs text-amber-500">Sin imagen el QR no se imprime.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
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
              Vista previa — {previewKind === "kitchen" ? "comanda" : "nota de venta"} en {PAPER_LABELS[previewPaper]}
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

/**
 * El papel a escala real dentro de un iframe, achicado para entrar en
 * PREVIEW_WIDTH. En térmica se ve el rollo completo y el contenido en el
 * ancho que realmente imprime el cabezal; en hojas, con su margen.
 */
function PaperPreview({ html, paper }: { html: string; paper: PaperSize }) {
  const spec = PAPER_SPECS[paper]
  const widthPx = Math.round(spec.printMm * MM_TO_PX)
  const padPx = Math.round(((spec.widthMm - spec.printMm) / 2) * MM_TO_PX)
  const outerPx = widthPx + padPx * 2
  const scale = Math.min(1, PREVIEW_WIDTH / outerPx)
  const [contentHeight, setContentHeight] = useState(400)
  const frameRef = useRef<HTMLIFrameElement>(null)

  const measure = () => {
    const doc = frameRef.current?.contentDocument
    if (!doc) return
    const update = () => setContentHeight(Math.max(200, doc.documentElement.scrollHeight))
    update()
    // El logo puede terminar de cargar después del onLoad del iframe.
    Array.from(doc.images).forEach((img) => img.addEventListener("load", update))
  }

  const outerHeight = contentHeight + (spec.thermal ? 0 : padPx * 2)
  return (
    <div
      className="rounded-md border border-border bg-muted/30 p-3 overflow-auto"
      style={{ width: PREVIEW_WIDTH + 24, maxHeight: 720 }}
    >
      <div style={{ width: outerPx * scale, height: outerHeight * scale }}>
        <div
          className="bg-white shadow-md origin-top-left"
          style={{
            width: outerPx,
            height: outerHeight,
            padding: spec.thermal ? `0 ${padPx}px` : padPx,
            transform: `scale(${scale})`,
          }}
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
