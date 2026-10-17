"use client"

import { useAuth } from "@/contexts/auth-context"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { Spinner } from "@/components/ui/spinner"
import { POSHeader } from "@/components/pos-header"
import { useBusinessFeatures } from "@/lib/business/client"

export default function InventarioLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { firebaseUser, isRestoring, user, store, isAdmin } = useAuth()
  const router = useRouter()
  const { stockControl } = useBusinessFeatures()

  useEffect(() => {
    if (isRestoring) return
    if (!firebaseUser || !user || !store) {
      router.push("/")
    } else if (!isAdmin) {
      router.push("/")
    }
  }, [isRestoring, firebaseUser, user, store, isAdmin, router])

  if (isRestoring || !firebaseUser || !user || !store) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner className="h-12 w-12 text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <POSHeader title={stockControl ? "Inventario" : "Conteo de stock"} />
      <main className="p-3 sm:p-4">{children}</main>
    </div>
  )
}
