/**
 * lib/business/cremas.ts
 * ---------------------------------------------------------------------------
 * Cremas (salsas) para los productos que las llevan (product.allowsCremas).
 * La lista es por local (store_settings/{storeId}_cremas, editable en Admin);
 * si el local no la configuró, se usa DEFAULT_CREMAS.
 *
 * Lo elegido viaja como NOTA del ítem ("Cremas: Mayonesa, Ketchup (aparte)"
 * o "Sin cremas"): así sale en la comanda impresa, en la pantalla de cocina y
 * en el carrito sin cambiar el modelo de pedidos.
 * ---------------------------------------------------------------------------
 */

export const DEFAULT_CREMAS = ["Mayonesa", "Tártara", "Aceituna", "Ketchup", "Mostaza", "Crema de rocoto", "Golf"]

export type CremasPlacement = "encima" | "aparte"

export function cremasDocId(storeId: string) {
  return `${storeId}_cremas`
}

/** Texto de la nota del ítem. Vacío = no se eligió nada (no debería pasar). */
export function cremasNote(selected: string[], placement: CremasPlacement, none: boolean): string {
  if (none || selected.length === 0) return "Sin cremas"
  return `Cremas: ${selected.join(", ")}${placement === "aparte" ? " (aparte)" : ""}`
}

/** Normaliza una lista guardada: textos limpios, sin repetidos, máx. 30. */
export function normalizeCremas(list: unknown): string[] {
  if (!Array.isArray(list)) return DEFAULT_CREMAS
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of list) {
    const name = String(v ?? "").trim().slice(0, 40)
    const key = name.toLocaleLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
    if (out.length >= 30) break
  }
  return out
}
