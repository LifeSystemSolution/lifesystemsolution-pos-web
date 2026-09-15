"use client"

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import {
  getUserByPinAndStore,
  getUserByPin,
  getStoreByCode,
  getAllStores,
  getUserAccessibleStores,
  getDocument,
  type User,
  type Store,
} from "@/lib/firebase/firestore"
import { getStoredSession, setStoredSession, clearStoredSession } from "@/lib/local/session"
import {
  hasPermission,
  canAccessStore,
  canAccessAdminPanel,
  canManageUsers,
  canProcessPayments,
  canCreateOrders,
  canViewKitchen,
  canManageKitchen,
  type Permission,
} from "@/lib/auth/permissions"

/**
 * "firebaseUser" ya no es Firebase — es la cuenta de auth_accounts logueada
 * en app/api/auth/login (Paso 1, correo/contraseña, sin ninguna dependencia
 * de Firebase). Se mantiene el nombre del campo (acá y en el resto del
 * contexto) para no tener que tocar los ~9 layouts que solo hacen
 * `if (!firebaseUser)` / `if (firebaseUser)` — el shape (uid/email) también
 * se mantiene igual por lo mismo.
 */
type AuthAccount = { uid: string; email: string | null }

interface AuthContextType {
  // Paso 1: login propio (correo/contraseña), persistente entre refrescos.
  firebaseUser: AuthAccount | null
  isFirebaseAuthenticated: boolean
  // true mientras se intenta restaurar la sesión guardada al montar — los
  // layouts deben esperar a que esto sea false antes de redirigir a "/" por
  // estado vacío (ver el comentario largo junto a useState(isRestoring)).
  isRestoring: boolean
  firebaseLogin: (email: string, password: string) => Promise<boolean>
  firebaseLogout: () => Promise<void>

  // PIN-based operational user
  user: User | null
  store: Store | null
  currentStore: Store | null
  storeId: string | null
  currentStoreId: string | null
  availableStores: Store[]
  allAccessibleStores: Store[] // All stores user can access (for admin_global)
  firebaseAccessibleStores: Store[] // Tiendas de la empresa de esta cuenta

  // UI State
  isLoading: boolean
  error: string | null
  needsStoreSelection: boolean

  // PIN login functions
  login: (storeCode: string, pin: string) => Promise<boolean>
  loginSuperAdmin: (pin: string) => Promise<boolean>
  selectStore: (store: Store) => void
  changeStore: () => void
  switchStore: (store: Store) => Promise<void> // Switch to different store (for admin_global)
  logout: () => Promise<void>

  // Role checks (legacy - still supported)
  isSuperAdmin: boolean
  isAdmin: boolean
  isCajero: boolean
  isMesero: boolean
  isCocina: boolean

  // Permission helpers
  hasPermission: (permission: Permission) => boolean
  canAccessStore: (storeId: string) => boolean
  canAccessAdminPanel: () => boolean
  canManageUsers: () => boolean
  canProcessPayments: () => boolean
  canCreateOrders: () => boolean
  canViewKitchen: () => boolean
  canManageKitchen: () => boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Formato guardado en localStorage bajo "pos_operative_unlock" — la validación
// del PIN (Paso 2), para no pedirlo de nuevo en cada F5.
type PinData = {
  userId: string
  storeId: string
  userName: string
  accountId: string
  timestamp: number
  expiresAt: number
}

function persistPinData(accountId: string, foundUser: User, storeId: string) {
  const pinData: PinData = {
    userId: foundUser.id!,
    storeId,
    userName: foundUser.name,
    accountId,
    timestamp: Date.now(),
    expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutos
  }
  localStorage.setItem("pos_operative_unlock", JSON.stringify(pinData))
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Paso 1 (login propio, ver app/api/auth/login)
  const [firebaseUser, setFirebaseUser] = useState<AuthAccount | null>(null)
  const [isFirebaseAuthenticated, setIsFirebaseAuthenticated] = useState(false)

  // PIN-based user
  const [user, setUser] = useState<User | null>(null)
  const [store, setStore] = useState<Store | null>(null)
  const [currentStoreId, setCurrentStoreId] = useState<string | null>(null)
  const [availableStores, setAvailableStores] = useState<Store[]>([])
  const [allAccessibleStores, setAllAccessibleStores] = useState<Store[]>([])
  const [firebaseAccessibleStores, setFirebaseAccessibleStores] = useState<Store[]>([])

  // UI State
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsStoreSelection, setNeedsStoreSelection] = useState(false)
  // true hasta que el efecto de abajo termina de intentar restaurar la
  // sesión guardada. CRÍTICO: todos los layouts (admin/caja/cocina/...)
  // deben esperar a que esto sea false antes de redirigir a "/" por
  // firebaseUser/user/store vacíos — si no, en cualquier recarga completa
  // de página (F5, o el fallback de Next.js a navegación dura cuando falla
  // un fetch de RSC) el guard redirige con el estado todavía en null, ANTES
  // de que la restauración asíncrona de abajo alcance a completarse, y la
  // sesión se pierde aunque los datos en localStorage fueran válidos. Este
  // bug existía desde antes de sacar Firebase (con onAuthStateChanged tenía
  // la misma ventana), acá quedó resuelto de raíz.
  const [isRestoring, setIsRestoring] = useState(true)

  // Restaura la sesión guardada al montar. Como nuestro token no expira
  // silenciosamente en el cliente (dura 7 días, ver lib/local/auth.ts), esto
  // corre una sola vez al montar, no como un listener continuo.
  useEffect(() => {
    const session = getStoredSession()
    if (!session) {
      setIsRestoring(false)
      return
    }

    const accountUser: AuthAccount = { uid: session.accountId, email: session.email }
    setFirebaseUser(accountUser)
    setIsFirebaseAuthenticated(true)
    ;(async () => {
     try {
      try {
        const stores = await getAllStores()
        setFirebaseAccessibleStores(stores)
        if (stores.length === 1) {
          setStore(stores[0])
          setCurrentStoreId(stores[0].id!)
        }
      } catch (err) {
        console.error("Error loading stores:", err)
      }

      // Restaurar validación de PIN (Paso 2) desde localStorage
      try {
        const pinDataRaw = localStorage.getItem("pos_operative_unlock")
        if (!pinDataRaw) return
        const parsed: PinData = JSON.parse(pinDataRaw)

        if (parsed.accountId !== session.accountId) {
          console.log("[v0] Cuenta distinta — se limpia la persistencia de PIN")
          localStorage.removeItem("pos_operative_unlock")
          return
        }
        if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
          console.log("[v0] Validación de PIN expirada")
          localStorage.removeItem("pos_operative_unlock")
          return
        }

        try {
          const restoredUser = await getDocument<User>("users", parsed.userId)
          if (restoredUser && restoredUser.active) {
            const selectedStore = await getDocument<Store>("stores", parsed.storeId)
            if (selectedStore) {
              setUser(restoredUser)
              setStore(selectedStore)
              setCurrentStoreId(selectedStore.id!)
              setNeedsStoreSelection(false)
              console.log("[v0] Restored PIN validation from localStorage for user:", restoredUser.name)
              return
            }
          }
          localStorage.removeItem("pos_operative_unlock")
        } catch (err) {
          console.warn("[v0] Error restoring user from PIN data:", err)
          localStorage.removeItem("pos_operative_unlock")
        }
      } catch (err) {
        console.warn("[v0] Error processing PIN persistence:", err)
      }
     } finally {
      setIsRestoring(false)
     }
    })()
  }, [])

  const firebaseLogin = useCallback(async (email: string, password: string): Promise<boolean> => {
    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || "Error al iniciar sesión")
        return false
      }

      setStoredSession({ token: json.token, accountId: json.accountId, email: json.email })
      setFirebaseUser({ uid: json.accountId, email: json.email })
      setIsFirebaseAuthenticated(true)

      try {
        const stores = await getAllStores()
        setFirebaseAccessibleStores(stores)
        if (stores.length === 1) {
          setStore(stores[0])
          setCurrentStoreId(stores[0].id!)
        }
      } catch (err) {
        console.error("Error loading stores:", err)
      }

      return true
    } catch (err: any) {
      console.error("Login error:", err)
      setError(err.message || "Error al iniciar sesión")
      return false
    } finally {
      setIsLoading(false)
    }
  }, [])

  // PIN login for normal users (existing system)
  const login = useCallback(async (storeCode: string, pin: string): Promise<boolean> => {
    setIsLoading(true)
    setError(null)

    try {
      const foundStore = await getStoreByCode(storeCode.toUpperCase())
      if (!foundStore) {
        setError("Código de tienda inválido")
        return false
      }

      if (!foundStore.active) {
        setError("Esta tienda no está activa")
        return false
      }

      // Get user by PIN and store
      let foundUser = await getUserByPinAndStore(pin, foundStore.id!)
      if (!foundUser) {
        setError("PIN incorrecto o usuario inactivo en esta tienda")
        return false
      }

      // CRITICAL: Validate user has access to this store
      // For single-store users: check storeId
      // For multi-store users (admin_global): check assignedStores
      const hasAccess =
        (foundUser.role === "admin_global" && foundUser.assignedStores?.includes(foundStore.id!)) ||
        (foundUser.storeId === foundStore.id!)

      if (!hasAccess) {
        setError("Acceso denegado: usuario no está autorizado para esta tienda")
        console.error(
          `[v0] Access denied - User ${foundUser.name} (${foundUser.id}) ` +
          `not assigned to store ${foundStore.code} (${foundStore.id}). ` +
          `Role: ${foundUser.role}, StoreID: ${foundUser.storeId}, AssignedStores: ${foundUser.assignedStores?.join(',') || 'none'}`
        )
        return false
      }

      setStore(foundStore)
      setCurrentStoreId(foundStore.id!)
      setUser(foundUser)
      setNeedsStoreSelection(false)

      if (firebaseUser) {
        persistPinData(firebaseUser.uid, foundUser, foundStore.id!)
      }

      return true
    } catch (err) {
      console.error("PIN login error:", err)
      setError("Error al iniciar sesión. Intente de nuevo.")
      return false
    } finally {
      setIsLoading(false)
    }
  }, [firebaseUser])

  // PIN login for super admin (existing system)
  const loginSuperAdmin = useCallback(async (pin: string): Promise<boolean> => {
    setIsLoading(true)
    setError(null)

    try {
      const foundUser = await getUserByPin(pin)
      if (!foundUser) {
        setError("PIN incorrecto o usuario inactivo")
        return false
      }

      if (foundUser.role !== "super_admin" && foundUser.role !== "admin_global") {
        setError("Este PIN no corresponde a un administrador")
        return false
      }

      const stores = await getAllStores()
      setAvailableStores(stores)

      // For admin_global, also load all accessible stores
      if (foundUser.role === "admin_global") {
        const accessibleStores = await getUserAccessibleStores(foundUser.id!)
        setAllAccessibleStores(accessibleStores)
      }

      setUser(foundUser)
      setNeedsStoreSelection(true)

      return true
    } catch (err) {
      console.error("Super admin PIN login error:", err)
      setError("Error al iniciar sesión. Intente de nuevo.")
      return false
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Select store for super admin
  const selectStore = useCallback((selectedStore: Store) => {
    setStore(selectedStore)
    setCurrentStoreId(selectedStore.id!)
    setNeedsStoreSelection(false)

    if (firebaseUser && user) {
      persistPinData(firebaseUser.uid, user, selectedStore.id!)
    }
  }, [firebaseUser, user])

  // Change store for super admin
  const changeStore = useCallback(() => {
    setStore(null)
    setCurrentStoreId(null)
    setNeedsStoreSelection(true)
  }, [])

  // Switch to different store (for admin_global users)
  const switchStore = useCallback(async (selectedStore: Store) => {
    try {
      setStore(selectedStore)
      setCurrentStoreId(selectedStore.id!)
      setNeedsStoreSelection(false)

      if (firebaseUser && user) {
        persistPinData(firebaseUser.uid, user, selectedStore.id!)
      }
    } catch (err) {
      console.error("Error switching store:", err)
      setError("Error al cambiar de local")
    }
  }, [firebaseUser, user])

  // Complete logout
  const logout = useCallback(async () => {
    try {
      clearStoredSession()
      setFirebaseUser(null)
      setIsFirebaseAuthenticated(false)
      setUser(null)
      setStore(null)
      setCurrentStoreId(null)
      setAvailableStores([])
      setAllAccessibleStores([])
      setFirebaseAccessibleStores([])
      setError(null)
      setNeedsStoreSelection(false)
      localStorage.removeItem("pos_operative_unlock")
    } catch (err) {
      console.error("Logout error:", err)
      setError("Error al cerrar sesión")
    }
  }, [])

  const value: AuthContextType = {
    firebaseUser,
    isFirebaseAuthenticated,
    isRestoring,
    firebaseLogin,
    firebaseLogout: logout,

    user,
    store,
    currentStore: store,
    storeId: currentStoreId,
    currentStoreId,
    availableStores,
    allAccessibleStores,
    firebaseAccessibleStores,

    isLoading,
    error,
    needsStoreSelection,

    login,
    loginSuperAdmin,
    selectStore,
    changeStore,
    switchStore,
    logout,

    // Legacy role checks - still supported
    isSuperAdmin: user?.role === "super_admin",
    isAdmin: user?.role === "admin" || user?.role === "admin_global" || user?.role === "super_admin",
    isCajero: user?.role === "cajero" || user?.role === "admin" || user?.role === "admin_global" || user?.role === "super_admin",
    isMesero: user?.role === "mesero" || user?.role === "admin" || user?.role === "admin_global" || user?.role === "super_admin",
    isCocina: user?.role === "cocina" || user?.role === "admin" || user?.role === "admin_global" || user?.role === "super_admin",

    // Permission helpers
    hasPermission: (permission: Permission) => hasPermission(user, permission),
    canAccessStore: (storeId: string) => canAccessStore(user, storeId),
    canAccessAdminPanel: () => canAccessAdminPanel(user),
    canManageUsers: () => canManageUsers(user),
    canProcessPayments: () => canProcessPayments(user),
    canCreateOrders: () => canCreateOrders(user),
    canViewKitchen: () => canViewKitchen(user),
    canManageKitchen: () => canManageKitchen(user),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
