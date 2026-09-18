"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { platformFetch } from "@/lib/local/platform-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { ArrowLeft, Building2, Store as StoreIcon, Users2, KeyRound, Plus, Trash2, Save } from "lucide-react"

interface CompanyDetail {
  id: string
  name: string
  plan: string
  active: boolean
  sunatConfigured: boolean
  sunat_settings: { baseUrl?: string; apiKey?: string; apiSecret?: string; configured?: boolean } | null
  created_at: string
}
interface MemberRow {
  id: string
  email: string
  created_at: string
}
interface StoreRow {
  id: string
  name: string
  code: string | null
  active: boolean
}
interface OperationalUserRow {
  id: string
  name: string
  role: string
  storeId: string | null
  active: boolean
}
interface PlanRow {
  id: string
  name: string
  max_stores: number
}

export default function PlataformaEmpresaDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const companyId = params.id

  const [company, setCompany] = useState<CompanyDetail | null>(null)
  const [members, setMembers] = useState<MemberRow[]>([])
  const [stores, setStores] = useState<StoreRow[]>([])
  const [operationalUsers, setOperationalUsers] = useState<OperationalUserRow[]>([])
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Editable company fields
  const [planValue, setPlanValue] = useState("")
  const [activeValue, setActiveValue] = useState(true)
  const [isSavingInfo, setIsSavingInfo] = useState(false)

  // SUNAT form
  const [sunatBaseUrl, setSunatBaseUrl] = useState("")
  const [sunatApiKey, setSunatApiKey] = useState("")
  const [sunatApiSecret, setSunatApiSecret] = useState("")
  const [isSavingSunat, setIsSavingSunat] = useState(false)

  // Add member dialog
  const [showAddMember, setShowAddMember] = useState(false)
  const [memberEmail, setMemberEmail] = useState("")
  const [memberPassword, setMemberPassword] = useState("")
  const [isSavingMember, setIsSavingMember] = useState(false)

  const load = async () => {
    try {
      const [detailRes, plansRes] = await Promise.all([
        platformFetch(`/api/platform/companies/${companyId}`),
        platformFetch("/api/platform/plans"),
      ])
      setCompany(detailRes.company)
      setMembers(detailRes.members || [])
      setStores(detailRes.stores || [])
      setOperationalUsers(detailRes.operationalUsers || [])
      setPlans(plansRes.plans || [])
      setPlanValue(detailRes.company.plan)
      setActiveValue(detailRes.company.active)
      setSunatBaseUrl(detailRes.company.sunat_settings?.baseUrl || "")
      setSunatApiKey(detailRes.company.sunat_settings?.apiKey || "")
      setSunatApiSecret(detailRes.company.sunat_settings?.apiSecret || "")
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
      await platformFetch(`/api/platform/companies/${companyId}`, {
        method: "PATCH",
        body: JSON.stringify({ plan: planValue, active: activeValue }),
      })
      await load()
    } catch (err: any) {
      alert(err.message || "Error guardando cambios")
    } finally {
      setIsSavingInfo(false)
    }
  }

  const handleSaveSunat = async () => {
    setIsSavingSunat(true)
    try {
      const configured = !!(sunatBaseUrl.trim() && sunatApiKey.trim() && sunatApiSecret.trim())
      await platformFetch(`/api/platform/companies/${companyId}`, {
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
    } catch (err: any) {
      alert(err.message || "Error guardando la configuración SUNAT")
    } finally {
      setIsSavingSunat(false)
    }
  }

  const handleAddMember = async () => {
    if (!memberEmail.trim() || !memberPassword.trim()) {
      alert("Correo y contraseña son requeridos")
      return
    }
    setIsSavingMember(true)
    try {
      await platformFetch(`/api/platform/companies/${companyId}/members`, {
        method: "POST",
        body: JSON.stringify({ email: memberEmail, password: memberPassword }),
      })
      setShowAddMember(false)
      setMemberEmail("")
      setMemberPassword("")
      await load()
    } catch (err: any) {
      alert(err.message || "Error agregando la cuenta")
    } finally {
      setIsSavingMember(false)
    }
  }

  const handleRemoveMember = async (member: MemberRow) => {
    if (!confirm(`¿Quitar el acceso de ${member.email}? No podrá volver a iniciar sesión.`)) return
    try {
      await platformFetch(`/api/platform/companies/${companyId}/members?accountId=${encodeURIComponent(member.id)}`, {
        method: "DELETE",
      })
      await load()
    } catch (err: any) {
      alert(err.message || "Error quitando la cuenta")
    }
  }

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
          </h2>
          <p className="text-xs text-muted-foreground">
            Creada el {new Date(company.created_at).toLocaleDateString("es-PE")}
          </p>
        </div>
      </div>

      {/* Info + plan */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Información general</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                <span className="text-sm text-muted-foreground">{activeValue ? "Activa" : "Inactiva"}</span>
              </div>
            </div>
          </div>
          <Button size="sm" onClick={handleSaveInfo} disabled={isSavingInfo}>
            <Save className="h-4 w-4 mr-1" />
            {isSavingInfo ? "Guardando..." : "Guardar cambios"}
          </Button>
        </CardContent>
      </Card>

      {/* Login accounts */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users2 className="h-5 w-5" />
            Cuentas de acceso
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowAddMember(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Agregar cuenta
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Correo</TableHead>
                <TableHead>Creada</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.email}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(m.created_at).toLocaleDateString("es-PE")}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => handleRemoveMember(m)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                    Sin cuentas de acceso
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Stores */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <StoreIcon className="h-5 w-5" />
            Tiendas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tienda</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stores.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.code || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={s.active ? "default" : "destructive"}>
                      {s.active ? "Activa" : "Inactiva"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {stores.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                    Sin tiendas
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground mt-3">
            Para agregar más tiendas, el administrador de la empresa lo hace desde su
            propio panel (/admin) — cada tienda nueva cuenta contra el límite de su plan.
          </p>
        </CardContent>
      </Card>

      {/* Operational users (read-only) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users2 className="h-5 w-5" />
            Usuarios operativos (PIN)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operationalUsers.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell className="capitalize text-sm">{u.role?.replace("_", " ")}</TableCell>
                  <TableCell>
                    <Badge variant={u.active ? "default" : "destructive"}>
                      {u.active ? "Activo" : "Inactivo"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {operationalUsers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                    Sin usuarios operativos
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground mt-3">
            Vista de solo lectura — mesero, cajero, cocina y admins con PIN se crean y
            editan desde el /admin de la propia empresa, con la lógica de tienda/rol
            correspondiente.
          </p>
        </CardContent>
      </Card>

      {/* SUNAT settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-5 w-5" />
            Conexión SUNAT de esta empresa
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Cada empresa factura con su propio RUC — estas credenciales son
            independientes de las de cualquier otra empresa.{" "}
            <Badge variant={company.sunatConfigured ? "default" : "outline"}>
              {company.sunatConfigured ? "Configurado" : "Sin configurar"}
            </Badge>
          </p>
          <div className="space-y-2">
            <Label>URL base de la API</Label>
            <Input
              placeholder="https://tu-api-sunat.up.railway.app/api/v1"
              value={sunatBaseUrl}
              onChange={(e) => setSunatBaseUrl(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>API Key</Label>
              <Input
                type="password"
                value={sunatApiKey}
                onChange={(e) => setSunatApiKey(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>API Secret</Label>
              <Input
                type="password"
                value={sunatApiSecret}
                onChange={(e) => setSunatApiSecret(e.target.value)}
              />
            </div>
          </div>
          <Button size="sm" onClick={handleSaveSunat} disabled={isSavingSunat}>
            <Save className="h-4 w-4 mr-1" />
            {isSavingSunat ? "Guardando..." : "Guardar configuración SUNAT"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Por ahora esto solo guarda el dato — la emisión de comprobantes todavía usa
            la configuración global del servidor. Falta conectar esto a
            app/api/facturacion para que cada empresa use su propia credencial.
          </p>
        </CardContent>
      </Card>

      {/* Add member dialog */}
      <Dialog open={showAddMember} onOpenChange={setShowAddMember}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Agregar cuenta de acceso</DialogTitle>
            <DialogDescription>Para un segundo admin o dueño de otra sede de esta empresa.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Correo</Label>
              <Input
                type="email"
                placeholder="nuevo@empresa.com"
                value={memberEmail}
                onChange={(e) => setMemberEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Contraseña inicial</Label>
              <Input
                type="password"
                placeholder="Mínimo 8 caracteres"
                value={memberPassword}
                onChange={(e) => setMemberPassword(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddMember(false)} disabled={isSavingMember}>
              Cancelar
            </Button>
            <Button onClick={handleAddMember} disabled={isSavingMember}>
              {isSavingMember ? "Guardando..." : "Agregar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
