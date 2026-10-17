"use client"

import { useMemo, useState } from "react"
import { usePOS } from "@/contexts/pos-context"
import { useAuth } from "@/contexts/auth-context"
import type { Product, ProductVariant, PizzaMassType } from "@/lib/firebase/firestore"
import {
  PIZZA_MASS_TYPES,
  PIZZA_SIZE_LABELS,
  PIZZA_INVENTORY_CODES,
  getInventoryItemId,
} from "@/lib/firebase/firestore"
import { useStoreStock, quantityByInventory } from "@/lib/hooks/use-store-stock"
import { useBusinessFeatures } from "@/lib/business/client"
import { useStoreCremas } from "@/lib/hooks/use-store-cremas"
import { CremasDialog } from "./cremas-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { Search, Plus, ChevronDown, ChevronUp, Pizza } from "lucide-react"

// Umbral para avisar "quedan pocas" (en ámbar) antes de que se agote.
const LOW_STOCK = 3

type PizzaOptions = { massType: PizzaMassType; flavor?: string; price: number }

interface ProductListProps {
  /** notes: p. ej. lo elegido en "¿Qué cremas lleva?" (va a la comanda). */
  onAddProduct: (product: Product, variant?: ProductVariant, pizzaOptions?: PizzaOptions, notes?: string) => void
}

export function ProductList({ onAddProduct }: ProductListProps) {
  const { products, cart } = usePOS()
  // Productos con "Lleva cremas": antes de agregarlos se pregunta qué cremas.
  const [pendingCremas, setPendingCremas] = useState<{ product: Product; variant?: ProductVariant; pizzaOptions?: PizzaOptions } | null>(null)
  const { currentStoreId } = useAuth()
  const [search, setSearch] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null)
  
  // Pizza size selector modal state
  const [showPizzaSizeModal, setShowPizzaSizeModal] = useState(false)
  const [selectedPizzaFlavor, setSelectedPizzaFlavor] = useState<Product | null>(null)

  // Stock en vivo del local. null = todavía no cargó (no se marca nada como
  // agotado mientras tanto). Crear un pedido sin stock falla en el servidor
  // ("Stock insuficiente"), así que acá se avisa y se bloquea antes.
  // Rubros que venden sin control de stock (comida rápida): no se marca ni bloquea nada.
  const { stockControl } = useBusinessFeatures()
  const stock = useStoreStock(stockControl ? currentStoreId : null)
  const { cremas } = useStoreCremas(currentStoreId)

  /** Agrega al carrito, o primero pregunta las cremas si el producto las lleva. */
  const addProduct = (product: Product, variant?: ProductVariant, pizzaOptions?: PizzaOptions) => {
    if (product.allowsCremas) {
      setPendingCremas({ product, variant, pizzaOptions })
      return
    }
    onAddProduct(product, variant, pizzaOptions)
  }

  // Lo que ya está en el carrito también cuenta: si quedan 2 y hay 2 en el
  // carrito, no se puede agregar un tercero.
  const inCart = useMemo(
    () => (currentStoreId ? quantityByInventory(currentStoreId, cart) : new Map<string, number>()),
    [cart, currentStoreId]
  )

  /** Unidades disponibles para agregar; null si aún no se sabe. */
  const available = (invId: string): number | null => {
    if (!stock) return null
    return (stock.get(invId) ?? 0) - (inCart.get(invId) || 0)
  }
  const simpleId = (p: Product) => getInventoryItemId(currentStoreId || "", { productId: p.id!, category: p.category })
  const variantId = (p: Product, v: ProductVariant) =>
    getInventoryItemId(currentStoreId || "", { productId: p.id!, variantId: v.id, category: p.category })
  const pizzaId = (massType: PizzaMassType) =>
    getInventoryItemId(currentStoreId || "", {
      productId: PIZZA_INVENTORY_CODES[massType],
      category: "pizzas",
      productType: "pizza",
      massType,
    })

  /** Lo más que se puede agregar del producto (la mejor de sus opciones). */
  const productAvailable = (p: Product): number | null => {
    let options: (number | null)[]
    if (p.category?.toLowerCase() === "pizzas") {
      options = PIZZA_MASS_TYPES.filter((mt) => (p.priceMap?.[mt] ?? 0) > 0).map((mt) => available(pizzaId(mt)))
    } else if (p.variants && p.variants.length > 0) {
      options = p.variants.map((v) => available(variantId(p, v)))
    } else {
      options = [available(simpleId(p))]
    }
    if (options.length === 0 || options.some((o) => o === null)) return null
    return Math.max(...(options as number[]))
  }
  const isOut = (n: number | null) => n !== null && n <= 0
  const isLow = (n: number | null) => n !== null && n > 0 && n <= LOW_STOCK

  // Get unique categories
  const categories = [...new Set(products.map((p) => p.category))].sort()

  // Filter products
  const filteredProducts = products.filter((product) => {
    const matchesSearch = product.name.toLowerCase().includes(search.toLowerCase())
    const matchesCategory = !selectedCategory || product.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  // Group by category
  const groupedProducts = filteredProducts.reduce((acc, product) => {
    if (!acc[product.category]) {
      acc[product.category] = []
    }
    acc[product.category].push(product)
    return acc
  }, {} as Record<string, Product[]>)

  // Check if product has variants
  const hasVariants = (product: Product) => {
    return product.variants && product.variants.length > 0
  }

  // Check if product is a pizza flavor
  const isPizzaProduct = (product: Product) => {
    return product.category?.toLowerCase() === 'pizzas'
  }

  // Handle product click
  const handleProductClick = (product: Product) => {
    if (isOut(productAvailable(product))) return
    if (isPizzaProduct(product)) {
      // PIZZA: Open size selector modal
      setSelectedPizzaFlavor(product)
      setShowPizzaSizeModal(true)
    } else if (hasVariants(product)) {
      // NON-PIZZA with variants: Toggle expansion
      setExpandedProductId(expandedProductId === product.id ? null : product.id!)
    } else {
      // NON-PIZZA without variants: Add directly
      addProduct(product)
    }
  }

  // Handle variant selection (for non-pizza products)
  const handleVariantSelect = (product: Product, variant: ProductVariant) => {
    if (isOut(available(variantId(product, variant)))) return
    addProduct(product, variant)
    setExpandedProductId(null)
  }

  // Handle pizza size selection
  const handlePizzaSizeSelect = (massType: PizzaMassType) => {
    if (!selectedPizzaFlavor) return
    if (isOut(available(pizzaId(massType)))) return
    
    // Get price from product's priceMap (sabor-specific pricing)
    const price = selectedPizzaFlavor.priceMap?.[massType]
    if (!price || price <= 0) {
      console.warn(`No price configured for ${selectedPizzaFlavor.name} size ${massType}`)
      return
    }
    
    // Add pizza with explicit massType, flavor, and price from product.priceMap
    addProduct(selectedPizzaFlavor, undefined, {
      massType,
      flavor: selectedPizzaFlavor.name,
      price,
    })
    
    // Close modal
    setShowPizzaSizeModal(false)
    setSelectedPizzaFlavor(null)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar producto..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 bg-input border-border"
        />
      </div>

      {/* Categories */}
      <div className="flex gap-2 mb-3 sm:mb-4 overflow-x-auto pb-2 scrollbar-hide flex-nowrap">
        <Button
          variant={selectedCategory === null ? "default" : "outline"}
          size="sm"
          onClick={() => setSelectedCategory(null)}
          className="flex-shrink-0 h-9 sm:h-8"
        >
          Todos
        </Button>
        {categories.map((category) => (
          <Button
            key={category}
            variant={selectedCategory === category ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedCategory(category)}
            className={cn(
              "flex-shrink-0 h-9 sm:h-8",
              category.toLowerCase() === 'pizzas' && "bg-orange-500/10 border-orange-500/30 hover:bg-orange-500/20"
            )}
          >
            {category.toLowerCase() === 'pizzas' && <Pizza className="h-3 w-3 mr-1" />}
            {category}
          </Button>
        ))}
      </div>

      {/* Products Grid */}
      <div className="flex-1 overflow-y-auto space-y-6">
        {Object.entries(groupedProducts).map(([category, categoryProducts]) => (
          <div key={category}>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider flex items-center gap-2">
              {category.toLowerCase() === 'pizzas' && <Pizza className="h-4 w-4 text-orange-500" />}
              {category}
              {category.toLowerCase() === 'pizzas' && (
                <span className="text-[10px] font-normal text-orange-500">(Selecciona sabor, luego tamano)</span>
              )}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {categoryProducts.map((product) => {
                const left = productAvailable(product)
                const out = isOut(left)
                return (
                <div key={product.id} className="space-y-1">
                  {/* Product Button */}
                  <button
                    onClick={() => handleProductClick(product)}
                    aria-disabled={out}
                    className={cn(
                      "w-full text-left p-3 rounded-lg border transition-colors",
                      "bg-card hover:bg-accent border-border",
                      expandedProductId === product.id && "ring-2 ring-primary",
                      isPizzaProduct(product) && "border-orange-500/30 hover:border-orange-500/50",
                      out && "border-destructive/60 bg-destructive/10 hover:bg-destructive/10 cursor-not-allowed"
                    )}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <p className="font-medium text-sm flex items-center gap-1">
                          {isPizzaProduct(product) && <Pizza className="h-3 w-3 text-orange-500" />}
                          <span className={cn(out && "text-destructive")}>{product.name}</span>
                          {out && (
                            <span className="ml-1 rounded bg-destructive px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              Sin stock
                            </span>
                          )}
                          {isLow(left) && (
                            <span className="ml-1 text-[10px] font-semibold text-amber-500">Quedan {left}</span>
                          )}
                        </p>
                        {/* For non-pizza products, show price info */}
                        {!isPizzaProduct(product) && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {hasVariants(product)
                              ? `${product.variants!.length} tamanos`
                              : `S/ ${product.price?.toFixed(2)}`}
                          </p>
                        )}
                        {/* For pizza, show hint */}
                        {isPizzaProduct(product) && (
                          <p className="text-[10px] text-orange-500/80 mt-1">
                            Toca para seleccionar tamano
                          </p>
                        )}
                      </div>
                      {/* Expand/collapse indicator for non-pizza with variants */}
                      {!isPizzaProduct(product) && hasVariants(product) && (
                        <div className="text-muted-foreground">
                          {expandedProductId === product.id ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </div>
                      )}
                    </div>
                  </button>

                  {/* Variant Expansion (NON-PIZZA only) */}
                  {!isPizzaProduct(product) && expandedProductId === product.id && hasVariants(product) && (
                    <div className="pl-2 space-y-1">
                      {product.variants!.map((variant) => {
                        const vLeft = available(variantId(product, variant))
                        const vOut = isOut(vLeft)
                        return (
                        <button
                          key={variant.id || variant.name}
                          onClick={() => handleVariantSelect(product, variant)}
                          aria-disabled={vOut}
                          className={cn(
                            "w-full flex items-center justify-between p-2 rounded-md bg-muted/50 hover:bg-muted transition-colors text-sm",
                            vOut && "bg-destructive/10 hover:bg-destructive/10 text-destructive cursor-not-allowed"
                          )}
                        >
                          <span>
                            {variant.name}
                            {vOut && <span className="ml-2 text-[10px] font-semibold">Sin stock</span>}
                            {isLow(vLeft) && (
                              <span className="ml-2 text-[10px] font-semibold text-amber-500">Quedan {vLeft}</span>
                            )}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">
                              S/ {variant.price.toFixed(2)}
                            </span>
                            {!vOut && <Plus className="h-4 w-4 text-primary" />}
                          </div>
                        </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ¿Qué cremas lleva? (productos con "Lleva cremas") */}
      <CremasDialog
        open={!!pendingCremas}
        productLabel={
          pendingCremas
            ? `${pendingCremas.product.name}${pendingCremas.variant ? ` - ${pendingCremas.variant.name}` : ""}`
            : ""
        }
        cremas={cremas}
        onCancel={() => setPendingCremas(null)}
        onConfirm={(note) => {
          if (pendingCremas) onAddProduct(pendingCremas.product, pendingCremas.variant, pendingCremas.pizzaOptions, note)
          setPendingCremas(null)
        }}
      />

      {/* Pizza Size Selector Modal */}
      <Dialog open={showPizzaSizeModal} onOpenChange={setShowPizzaSizeModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pizza className="h-5 w-5 text-orange-500" />
              {selectedPizzaFlavor?.name}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              Selecciona el tamano de la pizza
            </p>
          </DialogHeader>
          
          <div className="space-y-2 py-4">
            {selectedPizzaFlavor ? (
              PIZZA_MASS_TYPES
                .map((massType) => ({
                  massType,
                  price: selectedPizzaFlavor.priceMap?.[massType] ?? 0,
                }))
                .filter(({ price }) => price > 0)
                .map(({ massType, price }) => {
                  const invCode = PIZZA_INVENTORY_CODES[massType]
                  const sLeft = available(pizzaId(massType))
                  const sOut = isOut(sLeft)

                  return (
                    <button
                      key={massType}
                      onClick={() => handlePizzaSizeSelect(massType)}
                      aria-disabled={sOut}
                      className={cn(
                        "w-full flex items-center justify-between p-3 rounded-lg border transition-colors",
                        "bg-card hover:bg-orange-500/10 border-orange-500/30 hover:border-orange-500",
                        sOut && "bg-destructive/10 border-destructive/60 hover:bg-destructive/10 hover:border-destructive/60 cursor-not-allowed"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className="text-left">
                          <p className={cn("font-medium", sOut && "text-destructive")}>
                            {PIZZA_SIZE_LABELS[massType]}
                            {sOut && <span className="ml-2 text-[10px] font-semibold">Sin masa</span>}
                            {isLow(sLeft) && (
                              <span className="ml-2 text-[10px] font-semibold text-amber-500">Quedan {sLeft}</span>
                            )}
                          </p>
                          <p className="text-[10px] text-muted-foreground font-mono">{invCode}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={cn("font-semibold text-orange-600", sOut && "text-destructive")}>
                          S/ {price.toFixed(2)}
                        </span>
                        {!sOut && <Plus className="h-4 w-4 text-orange-500" />}
                      </div>
                    </button>
                  )
                })
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                Selecciona un sabor...
              </p>
            )}
            {selectedPizzaFlavor && !PIZZA_MASS_TYPES.some((massType) => (selectedPizzaFlavor.priceMap?.[massType] ?? 0) > 0) && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Este sabor no tiene tamaños disponibles. Agrega al menos un precio en Admin.
              </p>
            )}
          </div>
          
          {/* Info about inventory */}
          <div className="text-[10px] text-muted-foreground text-center border-t pt-3">
            El inventario se descuenta del producto operacional por tamano
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
