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
3. Se vende sin depender del stock.
4. Al **cerrar caja** se abre el **conteo de stock**
   (`components/caja/stock-count-dialog.tsx`): una línea por producto y
   presentación con la cantidad registrada, casilla "Comprar". Al guardar se
   actualiza el stock, queda el historial en `stock_counts` y se puede
   imprimir el ticket con la lista **POR COMPRAR** para el día siguiente.
   También hay un botón "Conteo de stock" en caja para hacerlo en cualquier
   momento.

## Agregar un rubro nuevo

Agregar una entrada en `BUSINESS_TYPES` y `BUSINESS_PROFILES` con sus
funciones. Si necesita una función que no existe, agregarla a
`BusinessFeatures` (con su valor en cada rubro) y consultarla en la pantalla
o transacción que corresponda.
