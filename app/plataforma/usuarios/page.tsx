"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { platformFetch } from "@/lib/local/platform-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { ShieldCheck } from "lucide-react"

interface AccountRow {
  id: string
  email: string
  isPlatformOwner: boolean
  active: boolean
  createdAt: string
  companyId: string | null
  companyName: string | null
  storeId: string | null
  storeName: string | null
}

export default function PlataformaUsuariosPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await platformFetch("/api/platform/users")
        setAccounts(res.users || [])
      } catch (err: any) {
        setError(err.message || "Error cargando cuentas")
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-5 w-5" />
            Cuentas de acceso (todas las empresas)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Correo</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Nivel</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Creada</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.id} className={a.active ? "" : "opacity-60"}>
                  <TableCell className="font-medium">{a.email}</TableCell>
                  <TableCell>
                    {a.companyId ? (
                      <Link href={`/plataforma/empresas/${a.companyId}`} className="hover:underline">
                        {a.companyName}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Sin empresa</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {a.isPlatformOwner ? (
                      <Badge>Dueño de plataforma</Badge>
                    ) : a.storeId ? (
                      <Badge variant="outline">Local: {a.storeName}</Badge>
                    ) : a.companyId ? (
                      <Badge variant="secondary">Empresa · Super Admin</Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={a.active ? "default" : "destructive"}>{a.active ? "Activa" : "Desactivada"}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(a.createdAt).toLocaleDateString("es-PE")}
                  </TableCell>
                </TableRow>
              ))}
              {accounts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    Sin cuentas registradas
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Vista global de solo lectura. Para crear, desactivar, cambiar contraseñas o eliminar cuentas, entra a la
        empresa correspondiente. Los usuarios operativos con PIN (mesero, cajero, cocina) se ven y administran también
        dentro de cada empresa.
      </p>
    </div>
  )
}
