-- Formato de impresión por empresa (recibo de venta y comanda de cocina):
-- papel (58/80 mm, A5, A4, Carta), tamaño de letra, datos de cabecera y qué
-- secciones se imprimen. Forma del JSON: TicketConfig en
-- lib/print/ticket-config.ts. NULL = valores por defecto.
--
-- Solo lo edita el dueño de la plataforma (/plataforma/empresas/[id]); el POS
-- lo lee por GET /api/company/ticket-config. Seguro de re-ejecutar.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ticket_settings JSONB;
