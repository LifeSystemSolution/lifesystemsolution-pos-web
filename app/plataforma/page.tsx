"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { platformFetch } from "@/lib/local/platform-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Building2, Store as StoreIcon, Plus, ChevronRight, Copy } from "lucide-react"
import { BUSINESS_PROFILES, BUSINESS_TYPES, normalizeBusinessType, type BusinessType } from "@/lib/business/profiles"

interface CompanyRow {
  id: string
  name: string
  plan: string
  active: boolean
  business_type?: string
  created_at: string
  userCount: number
  storeCount: number
}

interface StoreRow {
  id: string
  companyId: string
  companyName: string
  name: string
  code: string | null
  active: boolean
  updatedAt: string
}

interface PlanRow {
  id: string
  name: string
  max_stores: number
}

const emptyForm = {
  name: "",
  plan: "trial",
  businessType: "completo" as BusinessType,
  superEmail: "",
  superPassword: "",
  storeName: "",
  storeCode: "",
  storeEmail: "",
  storePassword: "",
}

interface CreatedInfo {
  companyName: string
  superAdmin: { email: string; password: string; pin: string }
  store: { name: string; accountEmail: string; password: string; pin: string }
}

export default function PlataformaPage() {
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [stores, setStores] = useState<StoreRow[]>([])
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [isSaving, setIsSaving] = useState(false)
  const [createdInfo, setCreatedInfo] = useState<CreatedInfo | null>(null)

  const loadAll = async () => {
    try {
      const [companiesRes, storesRes, plansRes] = await Promise.all([
        platformFetch("/api/platform/companies"),
        platformFetch("/api/platform/stores"),
        platformFetch("/api/platform/plans"),
      ])
      setCompanies(companiesRes.companies || [])
      setStores(storesRes.stores || [])
      setPlans(plansRes.plans || [])
    } catch (err: any) {
      setError(err.message || "Error cargando datos")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  const openCreate = () => {
    setForm(emptyForm)
    setCreatedInfo(null)
    setShowCreate(true)
  }

  const handleCreate = async () => {
    if (
      !form.name.trim() ||
      !form.superEmail.trim() ||
      !form.superPassword.trim() ||
      !form.storeEmail.trim() ||
      !form.storePassword.trim()
    ) {
      alert("Completa el nombre, la cuenta del Super Admin y la cuenta del primer local")
      return
    }
    setIsSaving(true)
    try {
      const res = await platformFetch("/api/platform/companies", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          plan: form.plan,
          businessType: form.businessType,
          superAdmin:{ email: form.superEmail, password: form.superPassword },
          store: {
            name: form.storeName,
            code: form.storeCode,
            accountEmail: form.storeEmail,
            accountPassword: form.storePassword,
          },
        }),
      })
      setCreatedInfo({
        companyName: form.name.trim(),
        superAdmin: { email: res.superAdmin.email, password: form.superPassword, pin: res.superAdmin.pin },
        store: {
          name: res.store.name,
          accountEmail: res.store.accountEmail,
          password: form.storePassword,
          pin: res.store.pin,
        },
      })
      await loadAll()
    } catch (err: any) {
      alert(err.message || "Error creando la empresa")
    } finally {
      setIsSaving(false)
    }
  }

  const copyCredentials = async (info: CreatedInfo) => {
    const text = [
      `Empresa: ${info.companyName}`,
      "",
      "SUPER ADMIN (ve todos los locales)",
      `  Cuenta: ${info.superAdmin.email}`,
      `  Contraseña: ${info.superAdmin.password}`,
      `  PIN de Super Admin: ${info.superAdmin.pin}`,
      "",
      `LOCAL: ${info.store.name} (cuenta que usan los empleados de este local)`,
      `  Cuenta: ${info.store.accountEmail}`,
      `  Contraseña: ${info.store.password}`,
      `  PIN del administrador del local: ${info.store.pin}`,
    ].join("\n")
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      alert("No se pudo copiar automáticamente — copia los datos a mano.")
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

  const totalStores = companies.reduce((sum, c) => sum + c.storeCount, 0)
  const totalUsers = companies.reduce((sum, c) => sum + c.userCount, 0)

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-3xl font-bold">{companies.length}</p>
            <p className="text-sm text-muted-foreground">Empresas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-3xl font-bold">{totalStores}</p>
            <p className="text-sm text-muted-foreground">Tiendas / sedes</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-3xl font-bold">{totalUsers}</p>
            <p className="text-sm text-muted-foreground">Cuentas de login</p>
          </CardContent>
        </Card>
      </div>

      {/* Companies */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-5 w-5" />
            Empresas
          </CardTitle>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            Crear empresa
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Rubro</TableHead>
                <TableHead>Tiendas</TableHead>
                <TableHead>Usuarios</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Creada</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((c) => (
                <TableRow key={c.id} className="cursor-pointer hover:bg-muted/40">
                  <TableCell className="font-medium">
                    <Link href={`/plataforma/empresas/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="capitalize">{c.plan}</TableCell>
                  <TableCell className="text-sm">
                    {normalizeBusinessType(c.business_type) === "comida_rapida" ? "Comida rápida" : "Restaurante completo"}
                  </TableCell>
                  <TableCell>{c.storeCount}</TableCell>
                  <TableCell>{c.userCount}</TableCell>
                  <TableCell>
                    <Badge variant={c.active ? "default" : "destructive"}>
                      {c.active ? "Activa" : "Inactiva"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString("es-PE")}
                  </TableCell>
                  <TableCell>
                    <Link href={`/plataforma/empresas/${c.id}`}>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {companies.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    Sin empresas registradas
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Stores / connections */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <StoreIcon className="h-5 w-5" />
            Tiendas y conexiones
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tienda</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stores.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.code || "—"}</TableCell>
                  <TableCell>
                    <Link href={`/plataforma/empresas/${s.companyId}`} className="hover:underline">
                      {s.companyName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.active ? "default" : "destructive"}>
                      {s.active ? "Activa" : "Inactiva"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {stores.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    Sin tiendas registradas
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Cada empresa está completamente aislada de las demás (RLS a nivel de base de
        datos) — esta vista es solo lectura agregada para administrar la plataforma,
        no un acceso directo a los datos operativos de cada negocio.
      </p>

      {/* Create company dialog */}
      <Dialog open={showCreate} onOpenChange={(open) => { setShowCreate(open); if (!open) setCreatedInfo(null) }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          {createdInfo ? (
            <>
              <DialogHeader>
                <DialogTitle>Empresa creada: {createdInfo.companyName}</DialogTitle>
                <DialogDescription>
                  Guarda estos datos — los PIN no se vuelven a mostrar (después puedes verlos o regenerarlos
                  desde la empresa).
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="p-3 rounded-lg bg-muted/50 border border-border space-y-1">
                  <p className="text-xs font-semibold text-primary">SUPER ADMIN — ve todos los locales</p>
                  <p className="text-xs text-muted-foreground">Cuenta</p>
                  <p className="font-mono text-sm break-all">{createdInfo.superAdmin.email}</p>
                  <p className="text-xs text-muted-foreground pt-1">PIN de Super Admin</p>
                  <p className="font-mono text-2xl tracking-widest">{createdInfo.superAdmin.pin}</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/50 border border-border space-y-1">
                  <p className="text-xs font-semibold text-primary">LOCAL: {createdInfo.store.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Cuenta que usan los empleados de este local (luego cada uno pone su PIN)
                  </p>
                  <p className="font-mono text-sm break-all">{createdInfo.store.accountEmail}</p>
                  <p className="text-xs text-muted-foreground pt-1">PIN del administrador del local</p>
                  <p className="font-mono text-2xl tracking-widest">{createdInfo.store.pin}</p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => copyCredentials(createdInfo)}>
                  <Copy className="h-4 w-4 mr-1" />
                  Copiar credenciales
                </Button>
                <Button onClick={() => { setShowCreate(false); setCreatedInfo(null) }}>Listo</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Crear empresa</DialogTitle>
                <DialogDescription>
                  Cada empresa tiene una cuenta de Super Admin y, por cada local, una cuenta propia que usan
                  sus empleados. Los locales no se mezclan entre sí.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>Nombre de la empresa</Label>
                  <Input
                    placeholder="Ej: Pizzería El Sol"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Plan</Label>
                  <Select value={form.plan} onValueChange={(v) => setForm({ ...form, plan: v })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="trial">Trial (sin plan asignado)</SelectItem>
                      {plans.map((p) => (
                        <SelectItem key={p.id} value={p.name}>
                          {p.name} (hasta {p.max_stores} tiendas)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Rubro (tipo de negocio)</Label>
                  <Select
                    value={form.businessType}
                    onValueChange={(v) => setForm({ ...form, businessType: v as BusinessType })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BUSINESS_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {BUSINESS_PROFILES[t].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{BUSINESS_PROFILES[form.businessType].description}</p>
                </div>

                <div className="p-3 rounded-lg border border-border space-y-3">
                  <p className="text-sm font-semibold">1. Cuenta del Super Admin (empresa)</p>
                  <div className="space-y-2">
                    <Label>Correo</Label>
                    <Input
                      type="email"
                      placeholder="dueño@empresa.com"
                      value={form.superEmail}
                      onChange={(e) => setForm({ ...form, superEmail: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Contraseña</Label>
                    <Input
                      type="password"
                      placeholder="Mínimo 8 caracteres"
                      value={form.superPassword}
                      onChange={(e) => setForm({ ...form, superPassword: e.target.value })}
                    />
                  </div>
                </div>

                <div className="p-3 rounded-lg border border-border space-y-3">
                  <p className="text-sm font-semibold">2. Primer local y su cuenta</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Nombre del local</Label>
                      <Input
                        placeholder="Ej: Sede Central"
                        value={form.storeName}
                        onChange={(e) => setForm({ ...form, storeName: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Código (opcional)</Label>
                      <Input
                        placeholder="Ej: CENTRAL"
                        value={form.storeCode}
                        onChange={(e) => setForm({ ...form, storeCode: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Correo de la cuenta del local</Label>
                    <Input
                      type="email"
                      placeholder="central@empresa.com"
                      value={form.storeEmail}
                      onChange={(e) => setForm({ ...form, storeEmail: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Contraseña de la cuenta del local</Label>
                    <Input
                      type="password"
                      placeholder="Mínimo 8 caracteres"
                      value={form.storePassword}
                      onChange={(e) => setForm({ ...form, storePassword: e.target.value })}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreate(false)} disabled={isSaving}>
                  Cancelar
                </Button>
                <Button onClick={handleCreate} disabled={isSaving}>
                  {isSaving ? "Creando..." : "Crear empresa"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
