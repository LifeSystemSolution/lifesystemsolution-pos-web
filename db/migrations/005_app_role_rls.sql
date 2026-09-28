-- El rol con el que conecta DATABASE_URL (Neon: neondb_owner; Supabase:
-- postgres) tiene BYPASSRLS: se salta TODAS las políticas RLS, aunque la
-- tabla tenga FORCE ROW LEVEL SECURITY. Con ese rol, la política
-- documents_company_isolation no protegía nada.
--
-- Solución: un rol sin BYPASSRLS y sin login, con permisos SOLO sobre
-- `documents`. withCompanyScope() (lib/local/pg-client.ts) se cambia a este
-- rol con set_config('role', 'pos_app', true) — local a la transacción, así
-- que no se filtra a la siguiente conexión del pooler. No hace falta ninguna
-- contraseña nueva: la cuenta de conexión solo necesita ser miembro del rol.
--
-- Seguro de re-ejecutar. Ejecutar ANTES de desplegar la versión que usa el rol.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
    CREATE ROLE pos_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON documents TO pos_app;
GRANT pos_app TO CURRENT_USER;
