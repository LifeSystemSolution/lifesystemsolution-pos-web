# Modelo de Productos e Inventario

> Reglas de negocio del catálogo (pizzas y productos simples) e inventario.
> No describe persistencia (eso vive en [SQL_MIGRATION_PLAN.md](./SQL_MIGRATION_PLAN.md));
> esto es *qué* significa cada campo y *qué* garantiza el sistema, verificado contra
> [`lib/firebase/firestore.ts`](../lib/firebase/firestore.ts).

## 1. Pizzas: categoría especial

Las pizzas son la única categoría con un modelo de precio/inventario desacoplado.
Todo lo demás (bebidas, extras, etc.) usa el modelo de producto simple (sección 2).

### 1.1 Inventario: solo 5 productos operacionales

El stock de pizza se controla **únicamente por tamaño** (`massType`), nunca por sabor.
El sabor es metadata para cocina/recibo y no tiene SKU ni stock propio.

```typescript
PIZZA_MASS_TYPES = ["PERSONAL", "BIPERSONAL", "FAMILIAR", "GIGANTE", "SUPER_GIGANTE"]

PIZZA_INVENTORY_CODES = {
  PERSONAL: "PZ-PER", BIPERSONAL: "PZ-BIP", FAMILIAR: "PZ-FAM",
  GIGANTE: "PZ-GIG", SUPER_GIGANTE: "PZ-SGI",
}
```

Al vender "Hawaiana + Familiar", el sistema descuenta stock de `PZ-FAM` solamente;
"Pepperoni + Familiar" descuenta el mismo `PZ-FAM`. El ID del documento de inventario
para una pizza es `${storeId}_pizzamass_${massType}` (no incluye el sabor ni el
productId) — ver `getInventoryItemId()` en
[`lib/firebase/firestore.ts`](../lib/firebase/firestore.ts).

### 1.2 Precio: por sabor + tamaño (`priceMap`)

Cada sabor es un `Product` con `category: "pizzas"` cuyo precio varía por tamaño en
`priceMap`:

```typescript
{
  name: "Hawaiana",
  category: "pizzas",
  priceMap: { PERSONAL: 18, FAMILIAR: 42 }, // GIGANTE y SUPER_GIGANTE ausentes
}
```

- `priceMap` puede ser **parcial**. Un tamaño sin precio (ausente, null o ≤ 0) no
  está disponible para ese sabor: el modal de venta lo muestra deshabilitado.
- Validación al guardar en admin: se exige al menos 1 precio > 0; solo se persisten
  los tamaños con precio válido.
- Precio final de venta = `priceMap[sabor][tamaño]`.

### 1.3 Flujo de venta

1. Usuario elige el sabor (lista de `Product` con `category: "pizzas"`).
2. Modal de tamaño: solo se habilitan los tamaños presentes en `priceMap` del sabor.
3. Cobro = `priceMap[tamaño]`.
4. Inventario: se descuenta `PZ-<TAMAÑO>` (nunca el sabor).

### 1.4 OrderItem de una pizza

```typescript
{
  productType: "pizza",
  massType: "FAMILIAR",   // controla inventario y precio
  flavor: "Hawaiana",     // metadata: cocina/recibo, NO afecta inventario ni precio
  category: "pizzas",
}
```

## 2. Productos simples (no-pizza): variantes

Bebidas, extras y demás productos usan variantes de tamaño/presentación, cada una
con su propio precio e inventario.

```typescript
{
  name: "Inca Cola",
  category: "GASEOSAS",
  variants: [
    { id: "uuid-1", name: "500ml", price: 3.5 },
    { id: "uuid-2", name: "1 Litro", price: 5.0 },
  ],
}
```

- Cada variante tiene un `id` estable (UUID), generado al guardar el producto si no
  existe.
- Al crear/editar el producto se ejecuta `ensureInventoryItemsForProduct()`, que crea
  un documento de inventario por variante.

## 3. Inventario: un documento por variante, lookup directo

Regla común a ambos modelos: **nunca se usan queries (`where`) para leer o
descontar inventario** — todo es acceso directo por ID de documento, calculado en
`getInventoryItemId()`:

| Tipo de item | ID de inventario |
|---|---|
| Pizza (por `massType`) | `${storeId}_pizzamass_${massType}` |
| Producto con variante | `${storeId}_${productId}_${variantId}` |
| Producto sin variante | `${storeId}_${productId}` |

Al crear un pedido, `deductInventoryInTransaction()` agrupa los items por ID de
inventario calculado y descuenta cada documento dentro de la misma transacción que
crea el pedido (nunca queda stock sin descontar si el pedido se confirma).

### Migración de datos legados

Si el inventario de una tienda quedó desincronizado (documentos con IDs viejos,
formato de nombre parseado, etc.), se reconstruye con:

```typescript
import { rebuildInventoryFromProducts } from "@/lib/firebase/firestore"
await rebuildInventoryFromProducts(storeId)
```

Esto borra los documentos de inventario existentes de la tienda y los recrea desde
`products` con el formato de ID actual. Los niveles de stock deben volver a
declararse manualmente en `/inventario` tras la reconstrucción.

## 4. Edición de pedidos e inventario

Ver [BUSINESS_RULES.md](./BUSINESS_RULES.md#edición-de-pedidos) para las reglas de
edición/cancelación de items y cómo afectan al inventario (restauración por delta).
