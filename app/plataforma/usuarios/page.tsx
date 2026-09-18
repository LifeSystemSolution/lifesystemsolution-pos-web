"use client"

import { useEffect, useState } from "react"
import { platformFetch } from "@/lib/local/platform-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { Users2 } from "lucide-react"

interface UserRow {
  id: string
  email: string
  isPlatformOwner: boolean
  createdAt: string
  companyId: string | null
  companyName: string | null
}

export default function PlataformaUsuariosPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await platformFetch("/api/platform/users")
        setUsers(res.users || [])
      } catch (err: any) {
        setError(err.message || "Error cargando usuarios")
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
            <Users2 className="h-5 w-5" />
            Cuentas de login (todas las empresas)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Correo</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Rol de plataforma</TableHead>
                <TableHead>Creada</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.email}</TableCell>
                  <TableCell>{u.companyName || <span className="text-muted-foreground">Sin empresa</span>}</TableCell>
                  <TableCell>
                    {u.isPlatformOwner ? (
                      <Badge>Dueño de plataforma</Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(u.createdAt).toLocaleDateString("es-PE")}
                  </TableCell>
                </TableRow>
              ))}
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    Sin cuentas registradas
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Esta lista muestra solo cuentas de login (correo/contraseña, una por empresa
        o tienda administradora). Los usuarios operativos con PIN (mesero, cajero,
        cocina) se administran dentro de cada empresa, en su propio /admin — no
        aparecen acá para no cruzar datos entre negocios.
      </p>
    </div>
  )
}
