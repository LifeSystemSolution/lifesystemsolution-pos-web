"use client"

import { useAuth } from "@/contexts/auth-context"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import Link from "next/link"
import { Spinner } from "@/components/ui/spinner"
import { Button } from "@/components/ui/button"
import { Building2, Users2, Wallet, LogOut, KeyRound } from "lucide-react"
import { ChangePasswordDialog } from "@/components/platform/change-password-dialog"

// Panel de plataforma: independiente del panel /admin de cada empresa. No
// exige PIN operativo ni tienda seleccionada (Paso 2) — solo el login de
// correo/contraseña (Paso 1) más el flag is_platform_owner de la cuenta. Ver
// docs/BUSINESS_RULES.md.
export default function PlataformaLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { firebaseUser, isRestoring, isPlatformOwner, firebaseLogout } = useAuth()
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    if (isRestoring) return
    if (!firebaseUser || !isPlatformOwner) {
      router.push("/")
    }
  }, [isRestoring, firebaseUser, isPlatformOwner, router])

  if (isRestoring || !firebaseUser || !isPlatformOwner) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner className="h-12 w-12 text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">Plataforma</h1>
            <p className="text-xs text-muted-foreground">{firebaseUser.email}</p>
          </div>
          <div className="flex items-center gap-1">
            <Link href="/plataforma">
              <Button variant="ghost" size="sm" className="gap-2">
                <Building2 className="h-4 w-4" />
                <span className="hidden sm:inline">Empresas</span>
              </Button>
            </Link>
            <Link href="/plataforma/usuarios">
              <Button variant="ghost" size="sm" className="gap-2">
                <Users2 className="h-4 w-4" />
                <span className="hidden sm:inline">Usuarios</span>
              </Button>
            </Link>
            <Link href="/plataforma/planes">
              <Button variant="ghost" size="sm" className="gap-2">
                <Wallet className="h-4 w-4" />
                <span className="hidden sm:inline">Planes</span>
              </Button>
            </Link>
            <Button variant="ghost" size="sm" className="gap-2" onClick={() => setShowPassword(true)}>
              <KeyRound className="h-4 w-4" />
              <span className="hidden sm:inline">Contraseña</span>
            </Button>
            <Button variant="ghost" size="sm" className="gap-2" onClick={() => firebaseLogout()}>
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Salir</span>
            </Button>
          </div>
        </div>
      </header>
      <main className="p-3 sm:p-6 max-w-6xl mx-auto">{children}</main>
      <ChangePasswordDialog open={showPassword} onOpenChange={setShowPassword} email={firebaseUser.email || ""} />
    </div>
  )
}
