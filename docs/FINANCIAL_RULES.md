# Reglas de Negocio: Caja y Gastos

> Modelo de cajas, categorías de gasto y funciones transaccionales, verificado
> contra [`lib/firebase/firestore.ts`](../lib/firebase/firestore.ts). Para el
> comportamiento observado en producción tras la migración (fórmula de "Caja
> Esperada", bug de "Últimos movimientos", etc.) ver
> [TESTING_REPORT.md](./TESTING_REPORT.md).

## 1. Tipos de caja

```typescript
type CashBoxType = "operational" | "principal" | "strongbox"
```

| Caja | Uso |
|---|---|
| `operational` (Caja Operativa) | Efectivo del turno: ventas en efectivo, gastos rápidos, apertura/cierre diario. |
| `principal` (Caja Principal) | Acumulación intermedia, recibe de las cajas operativas en el cierre. |
| `strongbox` (Caja Fuerte) | Reserva del negocio; pagos a proveedores y retiros grandes; en la UI actual (`/caja`) es la que se usa día a día junto con la operativa. |

Balance por caja y tienda: `cashBoxBalances/{storeId}_{boxType}` (vía el shim de
`documents`, ver [SQL_MIGRATION_PLAN.md](./SQL_MIGRATION_PLAN.md)).

## 2. Categorías de gasto

```typescript
type ExpenseCategory =
  | "supplies"        // Compras/insumos
  | "providers"       // Pagos a proveedores
  | "delivery"        // Entregas/envíos
  | "maintenance"      // Mantenimiento
  | "cleaning"         // Limpieza
  | "services"         // Servicios (internet, teléfono, etc)
  | "utilities"        // Servicios (luz, agua, gas)
  | "salaries"         // Sueldos
  | "transportation"   // Movilidad/combustible
  | "emergency"        // Gastos de emergencia
  | "other"            // Otros gastos
```

## 3. Regla crítica: usar siempre las funciones `*Transaction`

Toda operación de dinero debe pasar por una función transaccional — garantizan
atomicidad (todo o nada), rollback automático, seguridad ante concurrencia y
auditoría completa. Nunca escribir directamente un balance desde un componente.

| Función | Propósito |
|---|---|
| `registerExpenseTransaction()` | Registra un gasto y descuenta la caja de origen. |
| `registerInternalExpenseV2()` | Variante usada actualmente desde el botón "Registrar Gasto" de `/caja` (ver nota de `TESTING_REPORT.md` sobre a qué colección escribe). |
| `distributeCashOnClosureTransaction()` | Distribuye el efectivo contado al cierre entre `principal`/`strongbox`/lo que queda en operativa. |
| `transferCashTransaction()` | Transferencia entre `principal` y `strongbox`. |
| `payProviderTransaction()` | Pago a proveedor desde `principal` o `strongbox`, actualiza saldo del proveedor. |
| `cancelExpenseTransaction()` | Anula (soft-delete) un gasto y revierte el descuento de balance. |
| `getAllCashBoxBalances()` | Lectura puntual de los 3 balances. |

Cada función sigue el patrón **READ (todo) → VALIDATE → WRITE (todo)** dentro de
una única transacción — es el mismo patrón que exige el motor subyacente y evita
estados parciales (gasto creado sin descuento de balance, o viceversa).

## 4. Auditoría

Cada operación financiera crea, dentro de la misma transacción:
1. El registro de negocio (gasto, distribución, pago a proveedor, ...).
2. Un movimiento financiero append-only (nunca se edita ni se borra; anulaciones
   crean un movimiento de reversa, no modifican el original).
3. Una entrada de auditoría con usuario, timestamp y balance antes/después.

## 5. Validaciones invariantes

- Monto siempre positivo.
- No se permite un `salida`/gasto que deje el balance de origen negativo (excepto
  ajustes explícitos de arqueo).
- La distribución al cierre debe sumar exactamente el balance operativo contado
  (`toPrincipal + toStrongbox + remaining === balance`); si no cuadra, la
  transacción se rechaza completa.
- Todo movimiento requiere `userId` + `userName` (atribución obligatoria).
