# Funcionalidades — LifeSystemSolution POS

Funcionalidades identificadas como faltantes durante la ronda de pruebas de
producción de 2026-09-17. Las tres se implementaron el mismo día (ver detalle de
cada una); queda registrado acá el alcance implementado y lo que falta pulir.

## 1. Pedido para llevar (takeout) — ✅ Implementado

- `OrderItem`/`Order` ya tenían `orderType: "dine_in" | "takeout"` en el modelo de
  datos (definido pero nunca usado). Se agregó `createTakeoutOrderTransaction()` en
  `lib/firebase/firestore.ts` — variante de `createOrderTransaction()` sin
  lookup/occupied-check de mesa ni escritura de estado de mesa.
- `contexts/pos-context.tsx::createOrder(orderType)` ahora acepta `"dine_in"`
  (default, comportamiento sin cambios) o `"takeout"`.
- `/mesero` tiene un botón "Pedido para Llevar" junto a la leyenda de colores que
  abre `OrderModal` sin mesa asociada (`table` es ahora opcional en `OrderModalProps`).
- Todas las pantallas que mostraban `Mesa {tableNumber}` (`/caja`, `/cocina`,
  `/historial-ventas`, `daily-sales.tsx`, `closure-sales-modal.tsx`, recibo impreso)
  ahora muestran "Para Llevar" cuando `order.orderType === "takeout"`.
- **Bug encontrado y corregido durante la prueba end-to-end**: `processPayment`
  tenía un guard `if (!order.tableId) throw "El pedido no tiene mesa asociada"` que
  bloqueaba el pago de CUALQUIER pedido takeout (probado: producto → cocina →
  intento de pago → error). `processPaymentTransaction` también leía/actualizaba la
  mesa de forma incondicional. Se corrigió haciendo `tableId` opcional (`null` para
  takeout) en ambos — verificado que el pago de un pedido para llevar ahora completa
  correctamente de punta a punta (creación → cocina → cobro → aparece en historial).
- **Pendiente de pulir**: el filtro de búsqueda por mesa en `/historial-ventas` no
  matchea "para llevar" como texto (busca solo por número) — cosmético, no bloquea
  nada.

## 2. Comanda de cocina impresa (ticketera térmica) — ✅ Implementado (disparo manual)

- La plantilla `generateKitchenTicket()` en `lib/print/receipt-templates.ts` ya
  existía completa (mesa/para-llevar, items, notas por ítem, indicador de pedido
  atrasado) pero no estaba conectada a ningún botón — nadie podía imprimirla.
- Se agregó un botón de impresora en cada tarjeta de pedido de `/cocina` que genera
  el HTML (`generatePrintHTML`) y abre el diálogo de impresión del navegador —
  mismo patrón ya usado para el recibo de venta en `/caja`. Imprime contra cualquier
  impresora configurada a nivel de SO (térmica USB/red, o normal como fallback).
- **Pendiente**: esto es disparo **manual** (el cocinero o mesero hace clic). Falta
  decidir si además se quiere que la comanda se imprima **automáticamente** al
  enviar el pedido a cocina desde `/mesero` — no se implementó automático todavía
  porque depende de que la tienda ya tenga la impresora térmica físicamente
  configurada como impresora del sistema operativo (si no hay impresora, un intento
  automático de imprimir en cada pedido sería molesto). Recomendación: activarlo una
  vez que el negocio confirme qué impresora usará.

## 3. Notas / alergias por ítem — ✅ Implementado

- El modelo de datos y la lógica de negocio (`OrderItem.notes`,
  `addToCart(...,notes)`, guardado hasta la base de datos) ya existían end-to-end;
  solo faltaba la UI para escribir la nota.
- Se agregó `updateCartItemNotes()` al contexto POS y un botón por ítem en el
  carrito (`components/waiter/cart.tsx`) que revela un campo de texto corto (ej.
  "sin salsa", "alergia al maní", máx. 200 caracteres).
- Ya se mostraba en `/cocina` y en la comanda impresa (`generateKitchenTicket`) —
  sin cambios necesarios ahí, solo faltaba poder escribirla.

---

Ninguna de las tres requirió cambios de infraestructura — el modelo `documents`
(JSONB) en Postgres ya soportaba cualquier campo adicional.
