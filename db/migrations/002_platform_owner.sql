-- Agrega el concepto de "dueño de plataforma" (SaaS): una cuenta que puede
-- ver información agregada de TODAS las empresas (nombre, plan, tiendas,
-- usuarios), sin que eso rompa el aislamiento normal entre empresas — un
-- admin/cajero/mesero/cocina de una empresa sigue sin poder ver nada de otra,
-- vía RLS, exactamente igual que antes.
--
-- Seguro de re-ejecutar (IF NOT EXISTS / DROP POLICY IF EXISTS).

-- 1. Marca de cuenta dueña de la plataforma. No se puede autoasignar desde la
--    API — solo se setea a mano en la base de datos (ver abajo).
ALTER TABLE auth_accounts
  ADD COLUMN IF NOT EXISTS is_platform_owner BOOLEAN NOT NULL DEFAULT false;

-- 2. Tabla de planes de suscripción — vive en el backend, sin RLS, igual que
--    `companies` (no se expone directo al cliente, solo vía /api/platform/*
--    verificando session.isPlatformOwner).
CREATE TABLE IF NOT EXISTS plans (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  max_stores     INTEGER NOT NULL,
  price_monthly  NUMERIC(10, 2),
  currency       TEXT NOT NULL DEFAULT 'PEN',
  active         BOOLEAN NOT NULL DEFAULT true,
  description    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. La política de `documents` gana una segunda condición: además de
--    "company_id coincide con la empresa de la sesión" (caso normal),
--    también deja pasar cuando la transacción setea
--    app.is_platform_owner = 'true' — lo hace withPlatformOwnerScope()
--    (lib/local/pg-client.ts), solo alcanzable desde rutas que ya verificaron
--    session.isPlatformOwner en el servidor. El resto del sistema (todo lo
--    que usa withCompanyScope) sigue funcionando exactamente igual.
DROP POLICY IF EXISTS documents_company_isolation ON documents;
CREATE POLICY documents_company_isolation ON documents
  USING (
    company_id = current_setting('app.company_id', true)
    OR current_setting('app.is_platform_owner', true) = 'true'
  )
  WITH CHECK (
    company_id = current_setting('app.company_id', true)
    OR current_setting('app.is_platform_owner', true) = 'true'
  );

-- 4. Marca la cuenta del dueño real del negocio como dueño de plataforma.
--    Ajustar el email si corresponde a otra cuenta.
UPDATE auth_accounts
SET is_platform_owner = true
WHERE email = 'johannsebastian789@gmail.com';
