-- Ejecutar una sola vez en Supabase SQL Editor ANTES de desplegar la versión
-- que usa ON CONFLICT (company_id, collection, id). Corrige el esquema de
-- instalaciones creadas con una versión anterior de db/schema.sql.
--
-- No borra datos: solo cambia la clave primaria para permitir que dos
-- empresas tengan documentos con el mismo collection/id sin colisionar.

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_pkey;
ALTER TABLE documents
  ADD CONSTRAINT documents_pkey PRIMARY KEY (company_id, collection, id);
