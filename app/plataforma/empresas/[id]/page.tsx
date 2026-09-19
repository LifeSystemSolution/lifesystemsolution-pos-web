"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { platformFetch } from "@/lib/local/platform-client"
import { ConfirmDeleteDialog } from "@/components/platform/confirm-delete-dialog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import {
  ArrowLeft,
  Building2,
  Store as StoreIcon,
  Users2,
  KeyRound,
  Plus,
  Trash2,
  Save,
  Pencil,
  Eye,
  EyeOff,
  RefreshCw,
  ShieldCheck,
  Info,
} from "lucide-react"

interface CompanyDetail {
  id: string
  name: string
  plan: string
  active: boolean
  sunatConfigured: boolean
  sunat_settings: { baseUrl?: string; apiKey?: string; apiSecret?: string; configured?: boolean } | null
  created_at: string
}
interface Member {
  id: string
  email: string
  active: boolean
  isPlatformOwner: boolean
  storeId: string | null
  created_at: string
}
interface StoreItem {
  id: string
  name: string
  code: string | null
  active: boolean
}
interface OpUser {
  id: string
  name: string
  role: string
  storeId: string | null
  assignedStores: string[]
  pin: string
  active: boolean
}
interface PlanRow {
  id: string
  name: string
  max_stores: number
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin_global: "Admin global",
  admin: "Admin de local",
  cajero: "Cajero",
  mesero: "Mesero",
  cocina: "Cocina",
}
const isCrossStoreRole = (role: string) => role === "super_admin" || role === "admin_global"
const COMPANY_LEVEL = "__company__"

function fail(err: any, fallback: string) {
  alert(err?.message || fallback)
}

export default function PlataformaEmpresaDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const companyId = params.id
  const base = `/api/platform/companies/${companyId}`

  const [company, setCompany] = useState<CompanyDetail | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [stores, setStores] = useState<StoreItem[]>([])
  const [users, setUsers] = useState<OpUser[]>([])
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Información general
  const [nameValue, setNameValue] = useState("")
  const [planValue, setPlanValue] = useState("")
  const [activeValue, setActiveValue] = useState(true)
  const [isSavingInfo, setIsSavingInfo] = useState(false)
  const [showDeleteCompany, setShowDeleteCompany] = useState(false)

  // SUNAT
  const [sunatBaseUrl, setSunatBaseUrl] = useState("")
  const [sunatApiKey, setSunatApiKey] = useState("")
  const [sunatApiSecret, setSunatApiSecret] = useState("")
  const [isSavingSunat, setIsSavingSunat] = useState(false)

  // Diálogos
  const [accountDialog, setAccountDialog] = useState<{ mode: "add" } | { mode: "edit"; member: Member } | null>(null)
  const [storeDialog, setStoreDialog] = useState<{ mode: "add" } | { mode: "edit"; store: StoreItem } | null>(null)
  const [userDialog, setUserDialog] = useState<{ mode: "add" } | { mode: "edit"; user: OpUser } | null>(null)
  const [pinResult, setPinResult] = useState<{ title: string; pin: string } | null>(null)
  const [storeToDelete, setStoreToDelete] = useState<StoreItem | null>(null)
  const [userFilter, setUserFilter] = useState("all")
  const [revealedPins, setRevealedPins] = useState<Set<string>>(new Set())

  const storeName = useMemo(() => {
    const map = new Map(stores.map((s) => [s.id, s.name]))
    return (id: string | null) => (id ? map.get(id) || "(local eliminado)" : "")
  }, [stores])

  const load = async () => {
    try {
      const [detail, plansRes] = await Promise.all([platformFetch(base), platformFetch("/api/platform/plans")])
      setCompany(detail.company)
      setMembers(detail.members || [])
      setStores(detail.stores || [])
      setUsers(detail.operationalUsers || [])
      setPlans(plansRes.plans || [])
      setNameValue(detail.company.name)
      setPlanValue(detail.company.plan)
      setActiveValue(detail.company.active)
      setSunatBaseUrl(detail.company.sunat_settings?.baseUrl || "")
      setSunatApiKey(detail.company.sunat_settings?.apiKey || "")
      setSunatApiSecret(detail.company.sunat_settings?.apiSecret || "")
    } catch (err: any) {
      setError(err.message || "Error cargando la empresa")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const handleSaveInfo = async () => {
    setIsSavingInfo(true)
    try {
      await platformFetch(base, { method: "PATCH", body: JSON.stringify({ name: nameValue, plan: planValue, active: activeValue }) })
      await load()
    } catch (err) {
      fail(err, "Error guardando cambios")
    } finally {
      setIsSavingInfo(false)
    }
  }

  const handleSaveSunat = async () => {
    setIsSavingSunat(true)
    try {
      const configured = !!(sunatBaseUrl.trim() && sunatApiKey.trim() && sunatApiSecret.trim())
      await platformFetch(base, {
        method: "PATCH",
        body: JSON.stringify({
          sunatSettings: {
            baseUrl: sunatBaseUrl.trim() || undefined,
            apiKey: sunatApiKey.trim() || undefined,
            apiSecret: sunatApiSecret.trim() || undefined,
            configured,
          },
        }),
      })
      await load()
    } catch (err) {
      fail(err, "Error guardando la configuración SUNAT")
    } finally {
      setIsSavingSunat(false)
    }
  }

  // ---- cuentas de acceso ----
  const toggleMember = async (m: Member, active: boolean) => {
    if (!active && !confirm(`¿Desactivar ${m.email}? Se corta su acceso de inmediato (no puede iniciar sesión).`)) return
    try {
      await platformFetch(`${base}/members/${m.id}`, { method: "PATCH", body: JSON.stringify({ active }) })
      await load()
    } catch (err) {
      fail(err, "Error actualizando la cuenta")
    }
  }
  const deleteMember = async (m: Member) => {
    if (!confirm(`¿Eliminar la cuenta ${m.email}? No podrá volver a iniciar sesión y no se puede deshacer.`)) return
    try {
      await platformFetch(`${base}/members/${m.id}`, { method: "DELETE" })
      await load()
    } catch (err) {
      fail(err, "Error eliminando la cuenta")
    }
  }

  // ---- locales ----
  const toggleStore = async (s: StoreItem, active: boolean) => {
    const msg = active
      ? `¿Reactivar el local ${s.name}? Sus cuentas de acceso también se reactivan.`
      : `¿Desactivar el local ${s.name}? Sus cuentas de acceso se desactivan y sus empleados no podrán entrar. Los datos se conservan.`
    if (!confirm(msg)) return
    try {
      await platformFetch(`${base}/stores/${s.id}`, { method: "PATCH", body: JSON.stringify({ active }) })
      await load()
    } catch (err) {
      fail(err, "Error actualizando el local")
    }
  }

  // ---- usuarios operativos ----
  const toggleUser = async (u: OpUser, active: boolean) => {
    try {
      await platformFetch(`${base}/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ active }) })
      await load()
    } catch (err) {
      fail(err, "Error actualizando el usuario")
    }
  }
  const regeneratePin = async (u: OpUser) => {
    if (!confirm(`¿Generar un PIN nuevo para ${u.name}? El anterior deja de funcionar.`)) return
    try {
      const res = await platformFetch(`${base}/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ regeneratePin: true }) })
      setPinResult({ title: `Nuevo PIN de ${u.name}`, pin: res.pin })
      await load()
    } catch (err) {
      fail(err, "Error generando el PIN")
    }
  }
  const deleteUser = async (u: OpUser) => {
    if (!confirm(`¿Eliminar a ${u.name}? No podrá volver a entrar. Los pedidos que atendió conservan su nombre.`)) return
    try {
      await platformFetch(`${base}/users/${u.id}`, { method: "DELETE" })
      await load()
    } catch (err) {
      fail(err, "Error eliminando el usuario")
    }
  }
  const toggleReveal = (id: string) =>
    setRevealedPins((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const visibleUsers = users.filter((u) => {
    if (userFilter === "all") return true
    if (userFilter === COMPANY_LEVEL) return isCrossStoreRole(u.role)
    return u.storeId === userFilter
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="h-10 w-10 text-primary" />
      </div>
    )
  }
  if (error || !company) {
    return <p className="text-destructive text-sm">{error || "Empresa no encontrada"}</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/plataforma">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {company.name}
            <Badge variant={company.active ? "default" : "destructive"}>{company.active ? "Activa" : "Inactiva"}</Badge>
          </h2>
          <p className="text-xs text-muted-foreground">
            Creada el {new Date(company.created_at).toLocaleDateString("es-PE")}
          </p>
        </div>
      </div>

      {/* Información general */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Información general</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input value={nameValue} onChange={(e) => setNameValue(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Plan</Label>
              <Select value={planValue} onValueChange={setPlanValue}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trial">Trial</SelectItem>
                  {plans.map((p) => (
                    <SelectItem key={p.id} value={p.name}>
                      {p.name} (hasta {p.max_stores} tiendas)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Estado</Label>
              <div className="flex items-center gap-3 h-9">
                <Switch checked={activeValue} onCheckedChange={setActiveValue} />
                <span className="text-sm text-muted-foreground">
                  {activeValue ? "Activa" : "Inactiva — nadie de la empresa puede entrar"}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 justify-between">
            <Button size="sm" onClick={handleSaveInfo} disabled={isSavingInfo}>
              <Save className="h-4 w-4 mr-1" />
              {isSavingInfo ? "Guardando..." : "Guardar cambios"}
            </Button>
            <Button size="sm" variant="outline" className="text-destructive border-destructive/40" onClick={() => setShowDeleteCompany(true)}>
              <Trash2 className="h-4 w-4 mr-1" />
              Eliminar empresa
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Modelo de acceso */}
      <div className="flex gap-3 p-3 rounded-lg border border-border bg-muted/30 text-sm text-muted-foreground">
        <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-primary" />
        <p>
          <span className="font-medium text-foreground">Cómo se entra:</span> el <b>Super Admin</b> usa la cuenta de
          nivel <i>Empresa</i> (ve todos los locales) y luego su PIN. Cada <b>local</b> tiene su propia cuenta: todos
          sus empleados (meseros, cajeros, cocina) entran con ESA cuenta y luego colocan su PIN personal. Una cuenta de
          local solo ve los datos de su local — los locales no se mezclan.
        </p>
      </div>

      {/* Cuentas de acceso */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-5 w-5" />
            Cuentas de acceso
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => setAccountDialog({ mode: "add" })}>
            <Plus className="h-4 w-4 mr-1" />
            Agregar cuenta
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Correo</TableHead>
                <TableHead>Nivel</TableHead>
                <TableHead>Activa</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id} className={m.active ? "" : "opacity-60"}>
                  <TableCell className="font-medium">{m.email}</TableCell>
                  <TableCell>
                    {m.isPlatformOwner ? (
                      <Badge>Dueño de plataforma</Badge>
                    ) : m.storeId ? (
                      <Badge variant="outline">Local: {storeName(m.storeId)}</Badge>
                    ) : (
                      <Badge variant="secondary">Empresa · Super Admin</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch checked={m.active} disabled={m.isPlatformOwner} onCheckedChange={(v) => toggleMember(m, v)} />
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {!m.isPlatformOwner && (
                      <>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Editar (contraseña / nivel)" onClick={() => setAccountDialog({ mode: "edit", member: m })}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Eliminar" onClick={() => deleteMember(m)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                    Sin cuentas de acceso
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Locales */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <StoreIcon className="h-5 w-5" />
            Locales
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => setStoreDialog({ mode: "add" })}>
            <Plus className="h-4 w-4 mr-1" />
            Agregar local
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Local</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Cuenta(s) del local</TableHead>
                <TableHead>Usuarios</TableHead>
                <TableHead>Activo</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stores.map((s) => {
                const accounts = members.filter((m) => m.storeId === s.id)
                return (
                  <TableRow key={s.id} className={s.active ? "" : "opacity-60"}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.code || "—"}</TableCell>
                    <TableCell className="text-sm">
                      {accounts.length > 0 ? (
                        accounts.map((a) => <p key={a.id}>{a.email}</p>)
                      ) : (
                        <span className="text-destructive">Sin cuenta — nadie puede entrar a este local</span>
                      )}
                    </TableCell>
                    <TableCell>{users.filter((u) => u.storeId === s.id).length}</TableCell>
                    <TableCell>
                      <Switch checked={s.active} onCheckedChange={(v) => toggleStore(s, v)} />
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Editar" onClick={() => setStoreDialog({ mode: "edit", store: s })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Eliminar local" onClick={() => setStoreToDelete(s)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
              {stores.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                    Sin locales
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground mt-3">
            Cada local nuevo cuenta contra el límite de tiendas del plan y se crea siempre con su propia cuenta de acceso.
          </p>
        </CardContent>
      </Card>

      {/* Usuarios operativos */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users2 className="h-5 w-5" />
            Usuarios operativos (PIN)
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger className="w-44 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value={COMPANY_LEVEL}>De toda la empresa</SelectItem>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={() => setUserDialog({ mode: "add" })}>
              <Plus className="h-4 w-4 mr-1" />
              Agregar usuario
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Local</TableHead>
                <TableHead>PIN</TableHead>
                <TableHead>Activo</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleUsers.map((u) => (
                <TableRow key={u.id} className={u.active ? "" : "opacity-60"}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell>
                    <Badge variant={isCrossStoreRole(u.role) ? "secondary" : "outline"}>{ROLE_LABELS[u.role] || u.role}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {u.role === "admin_global"
                      ? u.assignedStores.length > 0
                        ? u.assignedStores.map(storeName).join(", ")
                        : "Sin locales asignados"
                      : isCrossStoreRole(u.role)
                        ? "Todos"
                        : storeName(u.storeId)}
                  </TableCell>
                  <TableCell>
                    <button className="inline-flex items-center gap-2 font-mono text-sm" onClick={() => toggleReveal(u.id)} title="Mostrar / ocultar PIN">
                      {revealedPins.has(u.id) ? u.pin : "••••"}
                      {revealedPins.has(u.id) ? <EyeOff className="h-3.5 w-3.5 text-muted-foreground" /> : <Eye className="h-3.5 w-3.5 text-muted-foreground" />}
                    </button>
                  </TableCell>
                  <TableCell>
                    <Switch checked={u.active} onCheckedChange={(v) => toggleUser(u, v)} />
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Editar" onClick={() => setUserDialog({ mode: "edit", user: u })}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Generar PIN nuevo" onClick={() => regeneratePin(u)}>
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Eliminar" onClick={() => deleteUser(u)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {visibleUsers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                    Sin usuarios
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground mt-3">
            El PIN es único dentro de cada local (dos empleados del mismo local nunca comparten PIN). Desde el /admin de
            la empresa solo se pueden editar o desactivar los que ya existen — crear y ascender de rol es solo desde acá.
          </p>
        </CardContent>
      </Card>

      {/* SUNAT */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-5 w-5" />
            Conexión SUNAT de esta empresa
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Cada empresa factura con su propio RUC — estas credenciales son independientes de las de cualquier otra
            empresa.{" "}
            <Badge variant={company.sunatConfigured ? "default" : "outline"}>
              {company.sunatConfigured ? "Configurado" : "Sin configurar"}
            </Badge>
          </p>
          <div className="space-y-2">
            <Label>URL base de la API</Label>
            <Input placeholder="https://tu-api-sunat.up.railway.app/api/v1" value={sunatBaseUrl} onChange={(e) => setSunatBaseUrl(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>API Key</Label>
              <Input type="password" value={sunatApiKey} onChange={(e) => setSunatApiKey(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>API Secret</Label>
              <Input type="password" value={sunatApiSecret} onChange={(e) => setSunatApiSecret(e.target.value)} />
            </div>
          </div>
          <Button size="sm" onClick={handleSaveSunat} disabled={isSavingSunat}>
            <Save className="h-4 w-4 mr-1" />
            {isSavingSunat ? "Guardando..." : "Guardar configuración SUNAT"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Por ahora esto solo guarda el dato — la emisión de comprobantes todavía usa la configuración global del
            servidor. Falta conectar esto a app/api/facturacion para que cada empresa use su propia credencial.
          </p>
        </CardContent>
      </Card>

      {/* Diálogos */}
      <AccountDialog
        state={accountDialog}
        stores={stores}
        base={base}
        onClose={() => setAccountDialog(null)}
        onDone={async () => {
          setAccountDialog(null)
          await load()
        }}
      />
      <StoreDialog
        state={storeDialog}
        base={base}
        onClose={() => setStoreDialog(null)}
        onDone={async () => {
          setStoreDialog(null)
          await load()
        }}
      />
      <UserDialog
        state={userDialog}
        stores={stores}
        base={base}
        onClose={() => setUserDialog(null)}
        onDone={async (pinInfo) => {
          setUserDialog(null)
          if (pinInfo) setPinResult(pinInfo)
          await load()
        }}
      />

      <Dialog open={!!pinResult} onOpenChange={(open) => !open && setPinResult(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{pinResult?.title}</DialogTitle>
            <DialogDescription>Entrégaselo a la persona. Siempre puedes volver a verlo desde la tabla.</DialogDescription>
          </DialogHeader>
          <div className="p-3 rounded-lg bg-muted/50 border border-border text-center">
            <p className="font-mono text-3xl tracking-widest">{pinResult?.pin}</p>
          </div>
          <DialogFooter>
            <Button onClick={() => setPinResult(null)}>Listo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={showDeleteCompany}
        onOpenChange={setShowDeleteCompany}
        title="Eliminar empresa"
        description={`Se borra ${company.name} con TODO: locales, pedidos, productos, inventario, cajas, usuarios y cuentas de acceso. No se puede deshacer.`}
        confirmText={company.name}
        onConfirm={async () => {
          try {
            await platformFetch(`${base}?confirm=${encodeURIComponent(company.name)}`, { method: "DELETE" })
            router.push("/plataforma")
          } catch (err) {
            fail(err, "Error eliminando la empresa")
          }
        }}
      />
      <ConfirmDeleteDialog
        open={!!storeToDelete}
        onOpenChange={(open) => !open && setStoreToDelete(null)}
        title="Eliminar local"
        description={`Se borra ${storeToDelete?.name} con todo su contenido: pedidos, mesas, productos, inventario, cajas, usuarios y sus cuentas de acceso. Si solo quieres pausarlo, usa el interruptor "Activo" (conserva los datos).`}
        confirmText={storeToDelete?.name || ""}
        onConfirm={async () => {
          if (!storeToDelete) return
          try {
            await platformFetch(`${base}/stores/${storeToDelete.id}?confirm=${encodeURIComponent(storeToDelete.name)}`, { method: "DELETE" })
            await load()
          } catch (err) {
            fail(err, "Error eliminando el local")
          }
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Diálogos
// ---------------------------------------------------------------------------

function AccountDialog({
  state,
  stores,
  base,
  onClose,
  onDone,
}: {
  state: { mode: "add" } | { mode: "edit"; member: Member } | null
  stores: StoreItem[]
  base: string
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [level, setLevel] = useState(COMPANY_LEVEL)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!state) return
    setPassword("")
    if (state.mode === "edit") {
      setEmail(state.member.email)
      setLevel(state.member.storeId || COMPANY_LEVEL)
    } else {
      setEmail("")
      setLevel(COMPANY_LEVEL)
    }
  }, [state])

  const save = async () => {
    setSaving(true)
    try {
      if (state?.mode === "add") {
        if (!email.trim() || !password.trim()) return alert("Correo y contraseña son requeridos")
        await platformFetch(`${base}/members`, {
          method: "POST",
          body: JSON.stringify({ email, password, storeId: level === COMPANY_LEVEL ? null : level }),
        })
      } else if (state?.mode === "edit") {
        const patch: Record<string, unknown> = {}
        if (password.trim()) patch.password = password
        const newStore = level === COMPANY_LEVEL ? null : level
        if (newStore !== state.member.storeId) patch.storeId = newStore
        if (Object.keys(patch).length === 0) return onClose()
        await platformFetch(`${base}/members/${state.member.id}`, { method: "PATCH", body: JSON.stringify(patch) })
      }
      await onDone()
    } catch (err) {
      fail(err, "Error guardando la cuenta")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{state?.mode === "edit" ? "Editar cuenta de acceso" : "Agregar cuenta de acceso"}</DialogTitle>
          <DialogDescription>
            Las cuentas de <b>Empresa</b> ven todos los locales (Super Admin). Las cuentas de <b>Local</b> solo ven ese
            local — son las que usan sus empleados.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Nivel</Label>
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={COMPANY_LEVEL}>Empresa (Super Admin)</SelectItem>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    Local: {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Correo</Label>
            <Input type="email" value={email} disabled={state?.mode === "edit"} onChange={(e) => setEmail(e.target.value)} placeholder="cuenta@empresa.com" />
          </div>
          <div className="space-y-2">
            <Label>{state?.mode === "edit" ? "Nueva contraseña (déjala vacía para no cambiarla)" : "Contraseña inicial"}</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function StoreDialog({
  state,
  base,
  onClose,
  onDone,
}: {
  state: { mode: "add" } | { mode: "edit"; store: StoreItem } | null
  base: string
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [accountEmail, setAccountEmail] = useState("")
  const [accountPassword, setAccountPassword] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!state) return
    setAccountEmail("")
    setAccountPassword("")
    setName(state.mode === "edit" ? state.store.name : "")
    setCode(state.mode === "edit" ? state.store.code || "" : "")
  }, [state])

  const save = async () => {
    if (!name.trim() || !code.trim()) return alert("Nombre y código son requeridos")
    setSaving(true)
    try {
      if (state?.mode === "add") {
        if (!accountEmail.trim() || !accountPassword.trim()) return alert("El local necesita su cuenta de acceso (correo y contraseña)")
        await platformFetch(`${base}/stores`, { method: "POST", body: JSON.stringify({ name, code, accountEmail, accountPassword }) })
      } else if (state?.mode === "edit") {
        await platformFetch(`${base}/stores/${state.store.id}`, { method: "PATCH", body: JSON.stringify({ name, code }) })
      }
      await onDone()
    } catch (err) {
      fail(err, "Error guardando el local")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{state?.mode === "edit" ? "Editar local" : "Agregar local"}</DialogTitle>
          <DialogDescription>
            {state?.mode === "edit"
              ? "Cambia el nombre o el código del local."
              : "Se crea con 10 mesas, el inventario base de pizza y SU cuenta de acceso (la que usarán sus empleados)."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Sede Norte" />
            </div>
            <div className="space-y-2">
              <Label>Código</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ej: NORTE" />
            </div>
          </div>
          {state?.mode === "add" && (
            <div className="p-3 rounded-lg border border-border space-y-3">
              <p className="text-sm font-semibold">Cuenta del local</p>
              <div className="space-y-2">
                <Label>Correo</Label>
                <Input type="email" value={accountEmail} onChange={(e) => setAccountEmail(e.target.value)} placeholder="norte@empresa.com" />
              </div>
              <div className="space-y-2">
                <Label>Contraseña</Label>
                <Input type="password" value={accountPassword} onChange={(e) => setAccountPassword(e.target.value)} placeholder="Mínimo 8 caracteres" />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Guardando..." : state?.mode === "edit" ? "Guardar" : "Crear local"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function UserDialog({
  state,
  stores,
  base,
  onClose,
  onDone,
}: {
  state: { mode: "add" } | { mode: "edit"; user: OpUser } | null
  stores: StoreItem[]
  base: string
  onClose: () => void
  onDone: (pinInfo?: { title: string; pin: string }) => Promise<void>
}) {
  const [name, setName] = useState("")
  const [role, setRole] = useState("mesero")
  const [storeId, setStoreId] = useState("")
  const [assigned, setAssigned] = useState<string[]>([])
  const [pin, setPin] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!state) return
    if (state.mode === "edit") {
      setName(state.user.name)
      setRole(state.user.role)
      setStoreId(state.user.storeId || stores[0]?.id || "")
      setAssigned(state.user.assignedStores || [])
      setPin(state.user.pin || "")
    } else {
      setName("")
      setRole("mesero")
      setStoreId(stores[0]?.id || "")
      setAssigned([])
      setPin("")
    }
  }, [state, stores])

  const cross = isCrossStoreRole(role)

  const save = async () => {
    if (!name.trim()) return alert("El nombre es requerido")
    if (!cross && !storeId) return alert("Selecciona un local para este rol")
    setSaving(true)
    try {
      const payload = {
        name,
        role,
        storeId: cross ? undefined : storeId,
        assignedStores: role === "admin_global" ? assigned : undefined,
        pin: pin.trim() || undefined,
      }
      if (state?.mode === "add") {
        const res = await platformFetch(`${base}/users`, { method: "POST", body: JSON.stringify(payload) })
        await onDone({ title: `PIN de ${name.trim()}`, pin: res.pin })
      } else if (state?.mode === "edit") {
        await platformFetch(`${base}/users/${state.user.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        await onDone()
      }
    } catch (err) {
      fail(err, "Error guardando el usuario")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{state?.mode === "edit" ? "Editar usuario" : "Agregar usuario operativo"}</DialogTitle>
          <DialogDescription>
            El empleado entra con la cuenta de su local y luego coloca este PIN para abrir su perfil.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Carlos Ramírez" />
          </div>
          <div className="space-y-2">
            <Label>Rol</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mesero">Mesero</SelectItem>
                <SelectItem value="cajero">Cajero</SelectItem>
                <SelectItem value="cocina">Cocina</SelectItem>
                <SelectItem value="admin">Admin de local</SelectItem>
                <SelectItem value="admin_global">Admin global (varios locales)</SelectItem>
                <SelectItem value="super_admin">Super Admin (todos los locales)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {!cross && (
            <div className="space-y-2">
              <Label>Local</Label>
              <Select value={storeId} onValueChange={setStoreId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecciona un local" />
                </SelectTrigger>
                <SelectContent>
                  {stores.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {role === "admin_global" && (
            <div className="space-y-2">
              <Label>Locales que administra</Label>
              <div className="space-y-1 p-2 rounded-lg border border-border">
                {stores.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={assigned.includes(s.id)}
                      onChange={(e) => setAssigned(e.target.checked ? [...assigned, s.id] : assigned.filter((id) => id !== s.id))}
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label>PIN {state?.mode === "add" && "(déjalo vacío para generar uno)"}</Label>
            <Input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="4 a 6 dígitos" inputMode="numeric" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Guardando..." : state?.mode === "edit" ? "Guardar" : "Crear usuario"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
