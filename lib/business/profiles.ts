/**
 * lib/business/profiles.ts
 * ---------------------------------------------------------------------------
 * Rubros (tipo de negocio) de cada empresa — companies.business_type — y qué
 * funciones del POS activa cada uno. Un solo código para todos los rubros:
 * las pantallas y transacciones preguntan por la FUNCIÓN (features.*), nunca
 * por el nombre del rubro, así agregar un rubro nuevo es agregar una fila acá.
 *
 * Lo usan servidor (validar al guardar, /api/company/settings) y navegador
 * (lib/business/client.ts) — no importa nada de Node.
 * ---------------------------------------------------------------------------
 */

export const BUSINESS_TYPES = ["completo", "comida_rapida"] as const
export type BusinessType = (typeof BUSINESS_TYPES)[number]
export const DEFAULT_BUSINESS_TYPE: BusinessType = "completo"

export interface BusinessFeatures {
  /** Descontar stock al pedir y bloquear la venta sin stock. */
  stockControl: boolean
  /** El pedido tiene que estar "entregado" (desde cocina) para poder cobrarlo. */
  requireDeliveredToCharge: boolean
  /** Caja fuerte: distribución de efectivo al cierre y gastos desde caja fuerte. */
  safeBox: boolean
  /** Boleta y factura (SUNAT). Sin esto, solo nota de venta. */
  sunatDocs: boolean
  /** Pantalla de cocina. Sin esto la cocina trabaja solo con la comanda impresa. */
  kitchenScreen: boolean
  /** Conteo de stock (checklist) al cerrar caja, con ticket para las compras del día siguiente. */
  closingStockCount: boolean
}

export const BUSINESS_PROFILES: Record<
  BusinessType,
  { label: string; description: string; features: BusinessFeatures }
> = {
  completo: {
    label: "Restaurante completo (pizzería, restaurante)",
    description:
      "Mesas, cocina con pantalla, control de stock en cada venta, caja fuerte, boleta y factura.",
    features: {
      stockControl: true,
      requireDeliveredToCharge: true,
      safeBox: true,
      sunatDocs: true,
      kitchenScreen: true,
      closingStockCount: false,
    },
  },
  comida_rapida: {
    label: "Comida rápida",
    description:
      "Básico: el mesero toma el pedido, cocina recibe la comanda impresa y se cobra en caja de inmediato con nota de venta. Vende sin depender del stock; el stock se cuenta al cerrar caja y se imprime para las compras del día siguiente.",
    features: {
      stockControl: false,
      requireDeliveredToCharge: false,
      safeBox: false,
      sunatDocs: false,
      kitchenScreen: false,
      closingStockCount: true,
    },
  },
}

export function normalizeBusinessType(v: unknown): BusinessType {
  return BUSINESS_TYPES.includes(v as BusinessType) ? (v as BusinessType) : DEFAULT_BUSINESS_TYPE
}

export function featuresFor(type: unknown): BusinessFeatures {
  return BUSINESS_PROFILES[normalizeBusinessType(type)].features
}
