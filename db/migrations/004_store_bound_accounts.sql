-- Modelo de cuentas por nivel:
--   * Cuenta de EMPRESA (store_id NULL): el Super Admin de la empresa — ve
--     todos los locales de su empresa.
--   * Cuenta de LOCAL (store_id = <id de tienda>): la cuenta que usan los
--     empleados de ESE local (meseros, cajeros, cocina). Entran con ella y
--     luego colocan su PIN. Solo ve datos de ese local — el servidor
--     (app/api/db/route.ts) lo hace cumplir, no es solo cosa de la UI.
--
-- store_id no es FK porque las tiendas viven en `documents` (JSONB), no en
-- una tabla propia.
ALTER TABLE company_members ADD COLUMN IF NOT EXISTS store_id TEXT;
CREATE INDEX IF NOT EXISTS company_members_company_store_idx ON company_members (company_id, store_id);

-- Activar/desactivar una cuenta de login sin borrarla. Se chequea en cada
-- request (app/api/db/route.ts), así que desactivar corta el acceso de
-- inmediato aunque el JWT de sesión (7 días) siga vigente.
ALTER TABLE auth_accounts ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

-- Las 3 cuentas de local de la empresa demo ya existían como "una cuenta
-- por local" (local_1/2/3_demo) pero sin estar atadas a nada — se atan ahora.
UPDATE company_members SET store_id = '2WRBqHVkUMGpqNNybIX6'
  WHERE auth_account_id = 'acc_local1' AND company_id = 'lifesystemsolution' AND store_id IS NULL;
UPDATE company_members SET store_id = '9pNxdvda7nYri3JICsyO'
  WHERE auth_account_id = 'acc_local2' AND company_id = 'lifesystemsolution' AND store_id IS NULL;
UPDATE company_members SET store_id = 'Gvys2bvIlIbIA9CItJYK'
  WHERE auth_account_id = 'acc_local3' AND company_id = 'lifesystemsolution' AND store_id IS NULL;
