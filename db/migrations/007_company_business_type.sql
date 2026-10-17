-- Rubro (tipo de negocio) de cada empresa: decide qué funciones usa el POS
-- (control de stock en la venta, cobrar sin esperar "entregado", caja fuerte,
-- boleta/factura, pantalla de cocina, conteo de stock al cerrar caja).
-- Valores y funciones: lib/business/profiles.ts. Lo cambia solo el dueño de
-- la plataforma (/plataforma/empresas/[id]). Seguro de re-ejecutar.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT 'completo';
