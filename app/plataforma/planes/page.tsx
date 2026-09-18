"use client"

import { useEffect, useState } from "react"
import { platformFetch } from "@/lib/local/platform-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Wallet, Plus, Pencil, Trash2 } from "lucide-react"

interface PlanRow {
  id: string
  name: string
  max_stores: number
  price_monthly: string | null
  currency: string
  active: boolean
  description: string | null
}

const emptyForm = {
  name: "",
  maxStores: "1",
  priceMonthly: "",
  currency: "PEN",
  description: "",
  active: true,
}

export default function PlataformaPlanesPage() {
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showDialog, setShowDialog] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [isSaving, setIsSaving] = useState(false)

  const loadPlans = async () => {
    try {
      const res = await platformFetch("/api/platform/plans")
      setPlans(res.plans || [])
    } catch (err: any) {
      setError(err.message || "Error cargando planes")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadPlans()
  }, [])

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm)
    setShowDialog(true)
  }

  const openEdit = (plan: PlanRow) => {
    setEditingId(plan.id)
    setForm({
      name: plan.name,
      maxStores: String(plan.max_stores),
      priceMonthly: plan.price_monthly ? String(plan.price_monthly) : "",
      currency: plan.currency,
      description: plan.description || "",
      active: plan.active,
    })
    setShowDialog(true)
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.maxStores) {
      alert("Nombre y máximo de tiendas son requeridos")
      return
    }
    setIsSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        maxStores: parseInt(form.maxStores, 10),
        priceMonthly: form.priceMonthly ? parseFloat(form.priceMonthly) : null,
        currency: form.currency || "PEN",
        description: form.description.trim() || null,
        active: form.active,
      }
      if (editingId) {
        await platformFetch("/api/platform/plans", {
          method: "PATCH",
          body: JSON.stringify({ id: editingId, ...payload }),
        })
      } else {
        await platformFetch("/api/platform/plans", {
          method: "POST",
          body: JSON.stringify(payload),
        })
      }
      setShowDialog(false)
      await loadPlans()
    } catch (err: any) {
      alert(err.message || "Error guardando el plan")
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (plan: PlanRow) => {
    if (!confirm(`¿Eliminar el plan "${plan.name}"? Esto no afecta a las empresas que ya lo tengan asignado.`)) return
    try {
      await platformFetch(`/api/platform/plans?id=${encodeURIComponent(plan.id)}`, { method: "DELETE" })
      await loadPlans()
    } catch (err: any) {
      alert(err.message || "Error eliminando el plan")
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="h-10 w-10 text-primary" />
      </div>
    )
  }

  if (error) {
    return <p className="text-destructive text-sm">{error}</p>
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-5 w-5" />
            Planes
          </CardTitle>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            Nuevo plan
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Máx. tiendas</TableHead>
                <TableHead>Costo mensual</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <p className="font-medium">{p.name}</p>
                    {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                  </TableCell>
                  <TableCell>{p.max_stores}</TableCell>
                  <TableCell>
                    {p.price_monthly ? `${p.currency} ${Number(p.price_monthly).toFixed(2)}` : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.active ? "default" : "destructive"}>
                      {p.active ? "Activo" : "Inactivo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(p)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => handleDelete(p)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {plans.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    Sin planes creados todavía
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Los planes son informativos por ahora — definen cuántas tiendas puede tener
        una empresa y a qué costo, pero todavía no hay cobro automático conectado.
        Sirven de base para cuando se active la facturación del SaaS.
      </p>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar plan" : "Nuevo plan"}</DialogTitle>
            <DialogDescription>Define el nombre, el límite de tiendas y el costo mensual.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input
                placeholder="Ej: Plan Básico"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Máximo de tiendas</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.maxStores}
                  onChange={(e) => setForm({ ...form, maxStores: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Costo mensual</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={form.priceMonthly}
                  onChange={(e) => setForm({ ...form, priceMonthly: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Moneda</Label>
              <Input
                placeholder="PEN"
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Descripción (opcional)</Label>
              <Input
                placeholder="Ej: Para negocios con 1 sola sede"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Plan activo</Label>
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={isSaving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
