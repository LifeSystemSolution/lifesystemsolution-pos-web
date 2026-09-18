# Reglas de Negocio: Roles, Multi-tienda y Edición de Pedidos

> Reglas verificadas contra [`lib/auth/permissions.ts`](../lib/auth/permissions.ts)
> y [`lib/firebase/firestore.ts`](../lib/firebase/firestore.ts). El mecanismo de
> login cambió con la migración (ver [SQL_MIGRATION_PLAN.md](./SQL_MIGRATION_PLAN.md):
> ya no es Firebase Auth sino JWT propio), pero el modelo de roles, permisos y
> tiendas que describe este documento no cambió.

## 1. Roles y permisos

### 1.1 Roles disponibles

| Rol | Alcance | Descripción |
|---|---|---|
| `super_admin` | Todas las tiendas | Acceso total, incluye gestión de tiendas |
| `admin_global` | Tiendas en `assignedStores[]` | Admin de varias sedes asignadas |
| `admin` | Una tienda (`storeId`) | Admin de una sola sede |
| `cajero` | Su tienda | Pagos y creación de pedidos |
| `mesero` | Su tienda | Toma de pedidos |
| `cocina` | Su tienda | Ver y gestionar comandas |

### 1.2 Matriz de permisos

```typescript
type Permission =
  | "view_dashboard" | "manage_users" | "manage_stores" | "view_reports"
  | "process_payments" | "create_orders" | "view_menu" | "manage_menu"
  | "view_kitchen" | "manage_kitchen" | "access_admin_panel"
```

| Permiso | super_admin | admin_global | admin | cajero | mesero | cocina |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| view_dashboard | ✓ | ✓ | ✓ | ✓ | | |
| manage_users | ✓ | ✓ | ✓ | | | |
| manage_stores | ✓ | | | | | |
| view_reports | ✓ | ✓ | ✓ | | | |
| process_payments | ✓ | ✓ | ✓ | ✓ | | |
| create_orders | ✓ | ✓ | ✓ | ✓ | ✓ | |
| view_menu | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| manage_menu | ✓ | ✓ | ✓ | | | |
| view_kitchen | ✓ | ✓ | ✓ | ✓ | | ✓ |
| manage_kitchen | ✓ | ✓ | ✓ | | | ✓ |
| access_admin_panel | ✓ | ✓ | ✓ | | | |

`manage_stores` es el único permiso exclusivo de `super_admin`.

### 1.3 Uso en componentes

```tsx
import { usePermissions } from "@/hooks/use-permissions"

const { can, role, user } = usePermissions()
if (!can.accessAdminPanel()) return <div>No tienes permiso</div>
{can.manageUsers() && <UserManagement />}
```

```tsx
import { RoleGate, AdminPanelGate, PaymentGate } from "@/components/auth/role-gate"

<RoleGate roles={["cocina", "admin", "super_admin"]}>
  <KitchenDisplay />
</RoleGate>
<RoleGate permission="manage_users">
  <UserManagementPanel />
</RoleGate>
```

Los checks de permisos son de UI (visibilidad); las validaciones que importan
(pagos, cierre de caja, gestión de usuarios) deben reforzarse también del lado del
servidor/API — ver `validateStoreAccess` y equivalentes en `lib/auth/`.

## 2. Multi-tienda

- Un usuario `admin_global` puede administrar varias sedes sin credenciales
  duplicadas: `user.assignedStores: string[]`.
- Un usuario de una sola tienda usa `user.storeId` (no `assignedStores`).
- `canAccessStore(user, storeId)`: `super_admin` siempre `true`; `admin_global`
  se valida contra `assignedStores`; el resto solo si `storeId === user.storeId`.
- Toda consulta de datos de negocio (pedidos, mesas, caja, inventario) debe filtrar
  por `storeId` — es el límite de aislamiento entre sedes. `admin_global` cambia de
  tienda con `switchStore()` desde el contexto de auth sin volver a autenticarse.
- El componente `StoreSwitcher` (`components/store/store-switcher.tsx`) solo se
  muestra a `admin_global`.

## 3. Edición de pedidos

Funciones en [`lib/firebase/firestore.ts`](../lib/firebase/firestore.ts):
`editOrderItemsWithAudit()`, `removeOrderItem()`, `updateOrderItemQuantity()`,
`updateOpenOrderItems()`, `cancelOrderItems()`.

### 3.1 Reglas invariantes

- **Pedido pagado → no editable.** Toda función valida
  `paymentStatus !== "paid"` antes de tocar items; si ya está pagado lanza
  `"No se puede editar un pedido pagado"`.
- **Item entregado → no se puede quitar ni modificar.** `status === "delivered"`
  bloquea remoción/edición de ese item específico
  (`"No se puede remover item entregado"`), aunque el resto del pedido siga abierto.
- **Inventario por delta, no por recálculo total.** Si una cantidad baja de 5 a 3,
  se restauran 2 unidades (no se recalculan las 5). Si sube, se descuenta solo la
  diferencia. Remover un item restaura su cantidad completa.
- **Soft delete.** Un item removido se marca `cancelled: true`, nunca se borra —
  preserva el historial del pedido.
- **Total siempre recalculado** a partir de los items no cancelados tras cada
  edición.
- **Auditoría obligatoria.** Cada edición crea un `OrderAuditLog` con
  `action` (`item_quantity_changed`, `item_removed`, `order_edited`, ...),
  `userId`/`userName`, y `changes` con valores antes/después.

### 3.2 Mensajes de error estándar (español, UI)

| Situación | Mensaje |
|---|---|
| Pedido no existe | `Pedido no encontrado` |
| Pedido ya pagado | `No se puede editar un pedido pagado` |
| Item no existe | `Item no encontrado` |
| Item ya entregado | `No se puede remover item entregado` |
| Cantidad inválida | `La cantidad debe ser mayor a 0` |

### 3.3 Envío parcial a cocina

`OrderItem` trackea `sentAt`/`sentCount` por item (no por pedido completo): permite
enviar solo los items nuevos a cocina cuando se agregan productos a un pedido ya
abierto, sin reimprimir/reenviar lo que ya se preparó. La comanda de cocina filtra
por items con `sentAt` nulo (ver [PRINT_SYSTEM.md](./PRINT_SYSTEM.md) para el
formato del ticket).
