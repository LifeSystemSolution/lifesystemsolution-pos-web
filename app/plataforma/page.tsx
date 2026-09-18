"use client"

import { useEffect, useState } from "react"
import { platformFetch } from "@/lib/local/platform-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { Building2, Store as StoreIcon } from "lucide-react"

interface CompanyRow {
  id: string
  name: string
  plan: string
  active: boolean
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

export default function PlataformaPage() {
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [stores, setStores] = useState<StoreRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const [companiesRes, storesRes] = await Promise.all([
          platformFetch("/api/platform/companies"),
          platformFetch("/api/platform/stores"),
        ])
        setCompanies(companiesRes.companies || [])
        setStores(storesRes.stores || [])
      } catch (err: any) {
        setError(err.message || "Error cargando datos")
      } finally {
        setIsLoading(false)
      }
    })()
  }, [])

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
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-5 w-5" />
            Empresas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Tiendas</TableHead>
                <TableHead>Usuarios</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Creada</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="capitalize">{c.plan}</TableCell>
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
                </TableRow>
              ))}
              {companies.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
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
                  <TableCell>{s.companyName}</TableCell>
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
    </div>
  )
}
