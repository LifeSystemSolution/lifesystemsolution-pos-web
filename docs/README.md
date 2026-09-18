# Índice de Documentación — LifeSystemSolution POS

> Reorganizado el 2026-09-17 tras la migración Firebase → Supabase/Postgres (ver
> [SQL_MIGRATION_PLAN.md](./SQL_MIGRATION_PLAN.md)). Se eliminó toda la
> documentación que describía la arquitectura Firebase/Firestore anterior
> (reglas de transacciones de Firestore, índices, reportes de avance puntuales) y
> se consolidaron las reglas de negocio que siguen vigentes en los documentos de
> abajo. Si vas a documentar algo nuevo, agrégalo al doc temático correspondiente
> en vez de crear un archivo nuevo por feature.

## Arquitectura y despliegue

- **[SQL_MIGRATION_PLAN.md](./SQL_MIGRATION_PLAN.md)** — Arquitectura actual:
  Postgres/Supabase vía el shim `firebase-shim/firestore.ts`, auth propia (JWT),
  aislamiento multi-empresa, reemplazo de `onSnapshot` por Realtime/SSE.
- **[VERCEL_SUPABASE_DEPLOYMENT.md](./VERCEL_SUPABASE_DEPLOYMENT.md)** — Cómo se
  despliega el proyecto (Vercel + Supabase).

## Reglas de negocio (dominio, no cambian con la persistencia)

- **[PRODUCT_MODEL.md](./PRODUCT_MODEL.md)** — Modelo de pizzas (sabor vs. tamaño
  vs. inventario) y de productos simples con variantes; cómo se calculan IDs de
  inventario y por qué nunca se usan queries para descontar stock.
- **[PRINT_SYSTEM.md](./PRINT_SYSTEM.md)** — Sistema de impresión térmica:
  plantillas de recibo/comanda/cierre de caja, perfiles de impresora, formato de
  fecha/hora.
- **[BUSINESS_RULES.md](./BUSINESS_RULES.md)** — Roles y matriz de permisos,
  modelo multi-tienda (`admin_global` / `assignedStores`), reglas de edición y
  cancelación de items de un pedido.
- **[FINANCIAL_RULES.md](./FINANCIAL_RULES.md)** — Tipos de caja (operativa,
  principal, fuerte), categorías de gasto, funciones transaccionales obligatorias
  para operaciones de dinero, reglas de auditoría.

## Estado actual del sistema

- **[TESTING_REPORT.md](./TESTING_REPORT.md)** — Qué se probó manualmente en
  producción tras la migración (login, pedidos, cocina, pagos, caja, SUNAT), bugs
  encontrados y corregidos, y qué queda sin probar.
- **[PENDING_FEATURES.md](./PENDING_FEATURES.md)** — Features pedidas por el
  negocio (pedido para llevar, comanda de ticketera, notas/alergias por ítem):
  alcance implementado y qué queda por pulir en cada una.

## Convención

Los documentos de reglas de negocio (`PRODUCT_MODEL`, `PRINT_SYSTEM`,
`BUSINESS_RULES`, `FINANCIAL_RULES`) describen *qué hace el sistema*, verificado
contra el código fuente actual — no describen la capa de persistencia. Si la
lógica de negocio cambia, actualiza el doc correspondiente en el mismo commit.
Evita crear un `.md` nuevo por cada fix o feature puntual: si es un reporte de
prueba, va en `TESTING_REPORT.md`; si es una feature pendiente, en
`PENDING_FEATURES.md`; si es una regla de negocio nueva, en el doc temático que
corresponda.
