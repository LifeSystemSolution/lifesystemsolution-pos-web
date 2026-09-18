# Sistema de Impresión y Plantillas de Recibo

> Diseño de las plantillas térmicas (recibo de venta, comanda de cocina, cierre de
> caja, resumen diario) y de la configuración de impresora. Vive en
> [`lib/print/`](../lib/print/) y [`components/print/`](../components/print/); no
> depende de Firebase/Supabase — genera HTML/texto en el cliente.

## 1. Núcleo (`lib/print/`)

| Archivo | Responsabilidad |
|---|---|
| [`thermal-printer.ts`](../lib/print/thermal-printer.ts) | Formateo de texto para impresoras térmicas (alineación, ancho, ESC/POS, HTML de impresión). |
| [`receipt-templates.ts`](../lib/print/receipt-templates.ts) | Genera los `ReceiptElement[]` de cada plantilla: `generateOrderReceipt()`, `generateKitchenTicket()`, `generateCashClosureReport()`, `generateDailySalesReport()`. |
| [`print-settings.ts`](../lib/print/print-settings.ts) | Tipos de configuración, valores por defecto y perfiles de impresora predefinidos. |

Componentes en [`components/print/`](../components/print/): `receipt-printer.tsx`
(vista previa + impresión), `print-settings-dialog.tsx` (configuración con pestañas
General/Recibo/Cocina/Avanzado), `print-preview-modal.tsx` (zoom, código HTML,
descarga) y `print-management-panel.tsx` (estado/gestión para admin).

## 2. Perfiles de impresora

| Perfil | Ancho papel | Caracteres | Auto-corte |
|---|---|---|---|
| Térmica 80mm (estándar POS) | 80mm | 42 | Sí |
| Térmica 58mm | 58mm | 32 | Sí |
| Inyección / Láser | A4 (210mm) | 80 | No |

La configuración se guarda en `localStorage` con clave `print-settings-{storeId}`
(por tienda, no compartida entre dispositivos) y se gestiona con el hook
`usePrintSettings(storeId)`.

## 3. Formato de fecha/hora

Todas las plantillas usan zona horaria de Perú (`America/Lima`), formato
`DD/MM/YYYY - HH:MM AM/PM`, locale `es-PE`. La función central es
`formatReceiptDateTime()` en [`lib/utils.ts`](../lib/utils.ts): acepta `Date` o un
valor con `.toDate()` (compatible con el shim de Firestore), y hace fallback a
`"N/A"` si la fecha es inválida — nunca debe mostrarse "Invalid Date" en un recibo.

## 4. Plantilla: Recibo de venta (`generateOrderReceipt`)

Diseño de referencia (80mm, 42 caracteres):

```
================================
LIFESYSTEMSOLUTION
@lifesystemsolutionperu
===============

Local: Huánuco Centro
RUC: 20609199416

================================
RECIBO DE VENTA
===============

Pedido #: 00125
Mesa: 04
Fecha: 07/05/2026
Hora: 08:45 PM
Atendido por: Carlos

================================
ITEMS
=====

1x Pizza Americana Familiar
                        S/ 42.00

2x Coca Cola 500ml
                        S/ 10.00

---

OBSERVACIONES:
* Sin cebolla
* Extra queso

---

Subtotal:........................S/ 60.00
Descuento:........................S/  0.00
Delivery:..........................S/  0.00

================================
TOTAL:                   S/ 60.00
===============================

Método de pago:
         EFECTIVO

================================
¡Gracias por su compra!
Síguenos: @lifesystemsolutionperu
================================
```

Reglas de la plantilla:
- Encabezado con nombre de tienda, RUC y local (personalizable por tienda).
- Pedido #, mesa, fecha/hora y mesero/cajero que atendió.
- Items con cantidad + nombre + variante, precio alineado a la derecha.
- Sección "OBSERVACIONES" solo aparece si algún item tiene `notes`.
- Subtotal / Descuento / Delivery antes del total; total en tamaño grande y negrita.
- Método de pago (EFECTIVO / TARJETA / YAPE / MIXTO) destacado.
- Si `order.createdAt` no es parseable, se usa `"N/A"` en vez de romper el render.

## 5. Otras plantillas

- **`generateKitchenTicket()`** — comanda de cocina: mesa o "Para Llevar", notas por
  ítem, indicador de prioridad ("PEDIDO ATRASADO" pasados 10 min) y fuente más
  grande (configurable en Print Settings → pestaña Cocina). Se dispara con el botón
  de impresora en cada tarjeta de pedido de `/cocina` (2026-09-17 — antes existía la
  plantilla pero no había ningún botón que la usara).
- **`generateCashClosureReport()`** — reporte de cierre de caja: desglose de ventas
  por método de pago, cantidad de pedidos, cajero, arqueo.
- **`generateDailySalesReport()`** — resumen de ventas del día.

## 6. Uso básico

```typescript
import { generateOrderReceipt } from "@/lib/print/receipt-templates"
import { generatePrintHTML } from "@/lib/print/thermal-printer"

const receiptElements = generateOrderReceipt(order, store)
const html = generatePrintHTML(receiptElements, store.name, store.code)

const printWindow = window.open("", "_blank")
printWindow.document.write(html)
printWindow.document.close()
printWindow.print()
```

Compatibilidad probada: Chrome/Firefox/Safari/Edge; impresoras térmicas 80mm/58mm,
inyección y láser (con `window.print()` como fallback general).
