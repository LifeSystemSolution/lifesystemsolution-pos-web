# Rubros (tipos de negocio)

Cada empresa tiene un **rubro** (`companies.business_type`, migración `007`)
que decide qué funciones usa el POS. Un solo código para todos: las pantallas
y transacciones preguntan por la **función**, nunca por el nombre del rubro.
Definición: [`lib/business/profiles.ts`](../lib/business/profiles.ts).

Lo elige/cambia solo el dueño de la plataforma: al crear la empresa o en
`/plataforma/empresas/[id]` → Información general → Rubro. Los equipos ya
abiertos toman el cambio al volver a iniciar sesión (o recargar la página).

| Función (`features.*`) | Restaurante completo | Comida rápida |
|---|---|---|
| `stockControl` — descuenta stock al pedir y bloquea sin stock | Sí | No |
| `requireDeliveredToCharge` — cobrar solo lo entregado por cocina | Sí | No (va directo a caja) |
| `safeBox` — caja fuerte (distribución al cierre, gastos desde caja fuerte) | Sí | No |
| `sunatDocs` — boleta y factura | Sí | No (solo nota de venta) |
| `kitchenScreen` — pantalla de cocina en el menú | Sí | No (comanda impresa) |
| `closingStockCount` — conteo de stock al cerrar caja + ticket | No | Sí |
| `dailySalesTally` — "Vendido hoy" por producto desde la apertura de caja | No | Sí |

## Dónde se aplica

- Transacciones: `deductInventoryInTransaction` / `restoreInventoryInTransaction`
  y la validación de "entregado" en `processPaymentTransaction`
  (`lib/firebase/firestore.ts`) y `processPayment` (`contexts/pos-context.tsx`),
  vía `getBusinessSettings()` (`lib/business/client.ts`, lee
  `GET /api/company/settings` una vez por sesión).
- Pantallas: `useBusinessFeatures()` — caja (pedidos a cobrar, comprobantes,
  caja fuerte, conteo), lista de productos y carrito (marcas de stock),
  cabecera (enlace a Cocina).

## Comida rápida: flujo

1. El mesero toma el pedido → se imprime la comanda para cocina.
2. El pedido aparece en caja de inmediato; se cobra con **nota de venta**
   (numeración interna NV01-…).
3. **No hay descuento de stock por venta.** En su lugar, caja muestra
   **"Vendido hoy"** (`components/caja/sales-tally-card.tsx`,
   `lib/business/sales-tally.ts`): cantidad y monto por producto de lo
   cobrado en la caja abierta. Empieza en 0 en cada apertura de caja (sale de
   los pedidos de esa caja; no se guarda ni se reinicia a mano). Se imprime
   cuando se quiera.
4. Al **cerrar caja** se abre el **cierre del día**
   (`components/caja/stock-count-dialog.tsx`): checklist de conteo sobre la
   **lista propia del local** (colección `stock_items`: pan, carnes, papas,
   gaseosas…, no los platos de la carta). La lista se arma **una vez**
   ("Editar lista", o "Usar lista sugerida de comida rápida") y queda como
   predeterminada. Cada producto trae lo último contado; "Comprar" se marca
   solo cuando la cantidad es 0 (salvo que se cambie a mano). Al guardar:
   `lastCount` en cada `stock_item`, registro en `stock_counts` (incluye lo
   vendido) y el ticket **CIERRE DEL DÍA**: VENDIDO HOY + CONTEO + POR COMPRAR.
   También hay un botón "Conteo de stock" en caja para hacerlo en cualquier
   momento.

## Agregar un rubro nuevo

Agregar una entrada en `BUSINESS_TYPES` y `BUSINESS_PROFILES` con sus
funciones. Si necesita una función que no existe, agregarla a
`BusinessFeatures` (con su valor en cada rubro) y consultarla en la pantalla
o transacción que corresponda.
