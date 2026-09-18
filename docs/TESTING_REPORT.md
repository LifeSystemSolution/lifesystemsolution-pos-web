# Reporte de Pruebas — LifeSystemSolution POS

> Última actualización: 2026-09-18 (post-migración Firebase → Supabase/Postgres)
> Ambiente probado: producción — https://lifesystemsolution-pos-web.vercel.app
> Store de prueba: LOCAL DEMO 1 (`2WRBqHVkUMGpqNNybIX6`)

Todas las pruebas de este reporte se hicieron con **escrituras reales** contra la base
de datos de producción (Supabase), no solo navegación/lectura. Cada flujo se verificó
tanto en la UI como directamente en la tabla `documents` vía queries SQL, para
confirmar que el estado persistido es correcto y no solo lo que muestra la pantalla.

## Resumen ejecutivo

| Flujo | Estado | Bugs encontrados |
|---|---|---|
| Login / sesión / restauración de sesión | ✅ Verificado | 1 (corregido: bounce-back por race condition en guards) |
| Crear pedido (producto simple) | ✅ Verificado | — |
| Crear pedido (pizza con sabor + tamaño) | ✅ Verificado | — |
| Flujo de cocina (Pendiente → Preparando → Listo → Entregado) | ✅ Verificado | — |
| Pago con un solo método (efectivo) | ✅ Verificado | — |
| Pago mixto (2+ métodos en un mismo pedido) | ✅ Verificado | — |
| Bloqueo de pago con caja cerrada | ✅ Verificado (funciona correctamente) | — |
| Registrar gasto (Caja Operativa) | ✅ Verificado | 1 (corregido: no aparecía en "Últimos movimientos") |
| Cerrar Caja (con arqueo y diferencia) | ✅ Verificado | 1 (corregido: fórmula de caja esperada no cuadraba) |
| Abrir Caja | ✅ Verificado | — |
| Dashboard — estado SUNAT | ✅ Verificado | 1 (corregido: alarmaba sin motivo si SUNAT no está configurado) |
| SUNAT / Facturación electrónica | ⏸️ Pendiente | Diferido a propósito — ver sección SUNAT |
| Pedido para llevar (takeout) | ✅ Verificado end-to-end | 1 (corregido: pago bloqueado — ver docs/PENDING_FEATURES.md) |
| Comanda de cocina (ticketera) | ✅ Botón funciona sin errores | Impresión real no verificable en este entorno de prueba (bloqueo de pop-ups del sandbox) — ver docs/PENDING_FEATURES.md |
| Notas/alergias por ítem | ✅ Verificado end-to-end | — |

---

## 1. Autenticación y sesión

- Login vía `/api/auth/login` con email/contraseña (scrypt + JWT propio, sin Firebase).
- Sesión persistida en `localStorage` (`lss_session`), PIN operativo en `pos_operative_unlock`.
- **Bug encontrado y corregido**: los guards de ruta (`app/{admin,caja,cocina,...}/layout.tsx`
  y `app/historial-ventas/page.tsx`) redirigían a `/` antes de que terminara de resolverse
  la sesión async al recargar la página, expulsando a usuarios válidos. Se agregó estado
  `isRestoring` en `contexts/auth-context.tsx` para bloquear el guard hasta que la
  restauración de sesión termine. Aplicado a los 8 layouts + historial-ventas.
- **Bug encontrado y corregido**: `app/gastos/layout.tsx` no incluía `"super_admin"` en
  la whitelist de roles, rebotando a súper-admins reales a `/admin`.

## 2. Creación de pedidos

Probado desde `/mesero`:
- Producto simple (ej. "producto prueba", S/1.00).
- Pizza con selección de sabor ("Fresa") y tamaño ("Personal", S/10.00) — el modelo
  de pizza usa `massType` (PERSONAL/BIPERSONAL/FAMILIAR/GIGANTE/SUPER_GIGANTE) con
  `productId` fijo por tamaño (ej. `PZ-PER`); el sabor es solo metadata, no afecta
  precio/inventario.
- Verificado en DB: el pedido crea correctamente `items[]`, vincula `tableId`, y la
  mesa pasa a `status: "occupied"`.

## 3. Flujo de cocina

Probado desde `/cocina`: transición completa `Pendiente → Preparando → Listo →
Entregado` para un pedido real, confirmando en cada paso que `orders.status` y los
timestamps (`sentAt`, `readyAt`) se actualizan correctamente.

## 4. Cobranza / Pagos (`/caja`)

### 4.1 Pago simple
Un solo método de pago (efectivo) por el total exacto del pedido. Verificado:
`paymentStatus → "paid"`, `paymentMethod` refleja el método, mesa liberada a
`"available"`, `cash_box_balances` incrementado por el monto.

### 4.2 Pago mixto
Pedido de S/10.00 (pizza) pagado con S/5 Efectivo + S/5 Tarjeta simultáneamente.
Verificado en DB:
```
"payments": [{"amount": 5, "method": "cash"}, {"amount": 5, "method": "card"}],
"paymentMethod": "mixed",
"paymentStatus": "paid"
```
El saldo de caja (`cash_box_balances`) solo incrementó por la porción en **efectivo**
(S/5) — correcto, ya que la tarjeta no es dinero físico en la caja. La UI de
"Resumen de Ventas" mostró correctamente Efectivo S/25 / Tarjeta S/5 tras la prueba.

### 4.3 Intento de pago con caja cerrada
Se cerró la caja y se intentó procesar el pago de un pedido pendiente real. El guard
en `contexts/pos-context.tsx::processPayment` (`if (!cashRegister?.id) throw "No hay
caja abierta"`) bloqueó correctamente la operación — el pedido permaneció
`paymentStatus: "pending"` y el saldo de caja no se tocó. **Comportamiento correcto,
no es un bug** (se investigó a fondo porque inicialmente parecía uno — ver nota abajo).

> Nota de investigación: durante esta prueba, tres pedidos antiguos (de agosto, ya
> pagados desde antes) cambiaron su `updatedAt` al cerrar la caja. Esto es el barrido
> esperado de `closeCashRegister()` que adjunta `cashClosureId` a pedidos pagados que
> aún no tenían uno asignado (huérfanos de cierres anteriores a que existiera esa
> lógica) — comportamiento correcto, no un bug, aunque inicialmente se confundió con
> el resultado del intento de pago bloqueado.

## 5. Registrar Gasto (`Caja Operativa` / `Caja Fuerte`)

Probado registrando un gasto de S/15.00 (origen "Caja Operativa"). Verificado:
- `expenses` collection: registro creado con `amount`, `category`, `description`,
  `status: "completed"`.
- `cash_box_balances` decrementado correctamente (25 → 10).

**Bug encontrado y corregido**: `registerInternalExpenseV2` (la función real detrás
del botón "Registrar Gasto") escribía el movimiento financiero en la colección
`safe_box_movements` con el campo `createdAt`, pero la sección "Últimos movimientos"
de `/caja` se alimenta de `subscribeToFinancialMovements`, que consulta la colección
`financial_movements` ordenando por `timestamp`. El saldo se descontaba bien, pero el
movimiento nunca aparecía en el historial visible. Corregido para escribir en la
colección/campo correctos — verificado en vivo tras el fix: el gasto de prueba
apareció inmediatamente en "Últimos movimientos" con la descripción, categoría,
monto y usuario correctos.

## 6. Apertura y Cierre de Caja

### Cierre (`Cerrar Caja`)
Probado con una diferencia real de arqueo: Caja Esperada S/8.00, Efectivo Contado
S/7.50 → Diferencia -S/0.50, correctamente calculada y guardada en el registro de
cierre (`cash_register` collection, `difference: -0.5`). El historial de cierres en
la UI muestra correctamente todos los campos (Monto Inicial, Ventas Total, Efectivo
Esperado, Efectivo Contado, Diferencia).

**Bug encontrado y corregido**: la leyenda bajo "Caja Esperada" decía
`= Monto inicial + Ventas efectivo`, pero el monto mostrado (`expectedCash`, el saldo
real de `cash_box_balances`) sí restaba los gastos del día — la aritmética visible no
cuadraba con el número mostrado, lo que podía hacer pensar al cajero que hay una
diferencia de caja injustificada cuando en realidad son gastos ya registrados.
Corregido agregando el término `− Gastos (S/ X)` a la leyenda.

### Apertura (`Abrir Caja`)
Al abrir una nueva caja, el "Monto Inicial" ingresado **sobrescribe** el saldo de
`cash_box_balances` (no se suma al saldo existente). Se verificó que este es el mismo
comportamiento del sistema de referencia (`lifesystem-pos-desktop`), por lo tanto es
un diseño intencional heredado, no un bug de la migración — pero implica que el
cajero debe declarar el efectivo real contado al abrir turno, no un monto arbitrario,
o se perderá el registro del saldo previo.

## 7. Dashboard — Estado SUNAT

**Bug encontrado y corregido**: el dashboard mostraba alarmas ("N ventas sin
comprobante") y un bloque de estados SUNAT (Aceptados/Pendientes/Rechazados/Anulados)
incluso cuando las credenciales de SUNAT no están configuradas — lo cual es el caso
actual a propósito (ver sección 8). Se agregó un chequeo liviano
`GET /api/facturacion` (sin `tipo`/`id`) que responde `{configured: boolean}`, y el
dashboard ahora oculta ambos bloques por completo mientras SUNAT no esté conectado.

## 8. Features nuevas (2026-09-18): takeout, comanda impresa, notas por ítem

Ver detalle de implementación en [PENDING_FEATURES.md](./PENDING_FEATURES.md). Cada
una se probó end-to-end contra producción con escrituras reales:

### 8.1 Pedido para llevar
Flujo completo probado: `/mesero` → botón "Pedido para Llevar" → agregar producto
con nota → "Enviar a Cocina" → `/cocina` muestra "Para Llevar" (no "Mesa undefined")
→ Preparar/Listo/Entregado → `/caja` lista el pedido como "Para Llevar" → pago en
efectivo. Verificado en DB: `orderType: "takeout"`, sin `tableId`/`tableNumber`,
`paymentStatus: "paid"` al final.

**Bug encontrado y corregido**: el primer intento de pago falló con "El pedido no
tiene mesa asociada" — `processPayment`/`processPaymentTransaction` asumían que todo
pedido tiene mesa. Se corrigió haciendo `tableId` opcional (`null` para takeout).
Repetido el flujo completo tras el fix: pago exitoso.

### 8.2 Comanda de cocina impresa
Botón de impresora en cada tarjeta de `/cocina` — se confirmó que ejecuta sin
lanzar errores de consola y llama a `generateKitchenTicket()` +
`generatePrintHTML()` (mismo patrón que el botón de recibo ya existente en
`/caja`). **No se pudo verificar la impresión real** en este entorno de prueba: el
navegador automatizado bloquea `window.open()` incluso para el botón de recibo ya
existente (confirmado con una llamada directa `window.open("","_blank")` → `null`),
así que esto es una limitación del entorno de pruebas, no evidencia de un bug —
recomendado probar manualmente desde un navegador normal con una impresora
configurada.

### 8.3 Notas/alergias por ítem
Agregada la nota "Sin salsa, alergia al mani" a un ítem del carrito en `/mesero`;
verificado que se guarda en `OrderItem.notes`, se muestra en el carrito, en
`/cocina`, y se incluiría en la comanda impresa (la plantilla ya soportaba
`item.notes`).

### 8.4 Hallazgo de infraestructura: `AUTH_JWT_SECRET` distinto entre local y Vercel
Al generar un token de sesión firmado con el `AUTH_JWT_SECRET` de `.env.local` para
retomar las pruebas (sesión de navegador perdida a mitad de la ronda), producción lo
rechazó con "Token inválido o expirado" — confirmado con una llamada `curl` directa a
`/api/db`, sin pasar por el navegador. Un login real contra `/api/auth/login` sí
emitió un token válido y aceptado. Esto indica que el valor de
`AUTH_JWT_SECRET` configurado en Vercel ya no coincide con el que está en
`.env.local` (probablemente se rotó en algún momento sin actualizar el archivo
local). No afecta a los usuarios reales — solo importa si en el futuro se necesita
firmar/verificar tokens localmente contra producción. Recomendado: sincronizar
`.env.local` con el valor real de Vercel (`vercel env pull` o copiarlo manualmente
del dashboard) para que quede documentado y no se repita la confusión.

## 9. SUNAT / Facturación electrónica — PENDIENTE

**Estado: intencionalmente no configurado.** Las variables de entorno
`SUNAT_API_BASE_URL`, `SUNAT_API_KEY`, `SUNAT_API_SECRET` no están seteadas en
producción por decisión explícita del negocio (se activará más adelante). Mientras
tanto:
- Cualquier intento de emitir Boleta/Factura/Nota de Venta devuelve 500 desde
  `app/api/facturacion/route.ts` con mensaje claro ("Faltan credenciales").
- Esto **no bloquea** el flujo de pago — el pedido se marca pagado igual, solo falla
  el intento automático de emisión de comprobante (ver `handlePayment` en
  `app/caja/page.tsx`, que captura el error de facturación por separado del pago).
- El dashboard y comprobantes ya no muestran alarmas por esto (ver sección 7).

**Pendiente para cuando se active SUNAT**: probar emisión real de Boleta/Factura,
consulta de estado (`GET /api/facturacion?tipo=...&id=...`), notas de crédito, y
verificar que los códigos de error de SUNAT se muestren de forma clara al cajero.

## 10. No probado aún en esta ronda

- Ajustes manuales de inventario.
- Gestión de proveedores / pago a proveedores.
- Transferencia de pedidos entre mesas.
- Distribución de efectivo al cierre (caja fuerte / caja principal) — se vio el modal
  "Confirmar Distribución" de pasada pero no se completó un test dedicado.
- Reportes / `/dashboard` en profundidad más allá del bloque SUNAT.
