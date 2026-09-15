-- db/schema.sql
-- ---------------------------------------------------------------------------
-- Esquema PostgreSQL (Supabase) para LifeSystemSolution POS — versión SaaS
-- multi-empresa, multi-sede.
--
-- Mismo enfoque "document store" ya probado en lifesystem-pos-desktop: una
-- tabla `documents` (collection, id, data JSONB) para reutilizar TAL CUAL la
-- lógica de negocio de lib/firebase/firestore.ts (~4500 líneas), sin
-- rediseñar ~24 tablas relacionales a mano. Ver docs/SQL_MIGRATION_PLAN.md.
--
-- Diferencias respecto a la versión desktop (pensada para UNA sola empresa):
--   1. Tabla `companies` nueva — cada empresa cliente del SaaS.
--   2. `documents` gana la columna `company_id`, poblada en cada escritura,
--      para que RLS e índices no tengan que abrir el JSONB en cada query.
--   3. RLS activo: cada request setea `app.company_id` (ver plan) y Postgres
--      rechaza cualquier fila fuera de esa empresa, incluso si el código de
--      la app tuviera un bug de scoping (segunda capa de defensa, además del
--      filtrado que se agrega en lib/firebase/firestore.ts).
--   4. SÍ incluye `auth_accounts` (a diferencia de una primera versión de
--      este archivo que seguía usando Firebase Auth para el Paso 1) — el
--      login de correo/contraseña también es Postgres, con scrypt, igual
--      que en el desktop. Cero dependencias de Firebase en todo el proyecto.
-- ---------------------------------------------------------------------------

-- Cuentas de login (Paso 1: correo/contraseña). Reemplaza a Firebase Auth.
-- password_hash con scrypt (node:crypto, sin dependencias nativas) — mismo
-- esquema que usaba lifesystem-pos-desktop en master_accounts.
CREATE TABLE IF NOT EXISTS auth_accounts (
  id             TEXT PRIMARY KEY,
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Empresas clientes del SaaS. Antes de esto, "stores" era un pool plano sin
-- ningún nivel superior — este es el nivel que faltaba.
CREATE TABLE IF NOT EXISTS companies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'trial',
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Qué cuenta de login pertenece a qué empresa. Es la ÚNICA consulta del
-- sistema que por diseño es "sin filtrar por empresa" — es, literalmente, la
-- que responde esa pregunta antes de poder filtrar cualquier otra cosa. Una
-- misma cuenta nunca pertenece a más de una empresa (eso rompería el
-- aislamiento); una empresa sí puede tener varias (varios admins/sedes con
-- login propio).
CREATE TABLE IF NOT EXISTS company_members (
  auth_account_id  TEXT PRIMARY KEY REFERENCES auth_accounts(id),
  company_id       TEXT NOT NULL REFERENCES companies(id),
  email            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_members_company_idx ON company_members (company_id);

CREATE TABLE IF NOT EXISTS documents (
  collection  TEXT NOT NULL,
  id          TEXT NOT NULL,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
);

CREATE INDEX IF NOT EXISTS documents_collection_idx ON documents (collection);
CREATE INDEX IF NOT EXISTS documents_company_idx ON documents (company_id);
CREATE INDEX IF NOT EXISTS documents_collection_company_idx ON documents (collection, company_id);
CREATE INDEX IF NOT EXISTS documents_data_gin_idx ON documents USING gin (data);

-- ---------------------------------------------------------------------------
-- Row Level Security — segunda capa de aislamiento entre empresas.
--
-- El backend (Next.js API routes, usando la conexión con privilegios de
-- servidor) resuelve `company_id` a partir del JWT propio YA verificado
-- (ver app/api/auth/login), y al abrir cada conexión/transacción hace:
--
--   SELECT set_config('app.company_id', '<company_id>', true);
--
-- Esta política rechaza cualquier fila que no coincida, así que aunque una
-- función de lib/firebase/firestore.ts se olvide de filtrar por compañía
-- (el bug que encontramos en getAllStores/getUserByPin/getStoreByCode),
-- Postgres no deja que se filtren datos de otra empresa.
--
-- IMPORTANTE — FORCE es obligatorio acá: la conexión que usa el backend
-- (DATABASE_URL) entra como el rol `postgres`, que es el DUEÑO de esta
-- tabla (la creó al correr este script). Por default, Postgres deja que el
-- dueño de una tabla se salte sus propias políticas RLS — con ENABLE nada
-- más, esta política no protegería nada. FORCE es lo que efectivamente la
-- aplica también al dueño.
-- ---------------------------------------------------------------------------
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;

CREATE POLICY documents_company_isolation ON documents
  USING (company_id = current_setting('app.company_id', true))
  WITH CHECK (company_id = current_setting('app.company_id', true));

-- companies: solo el backend con privilegios de servidor la toca (alta de
-- empresas nuevas, panel de ustedes como dueños de la plataforma) — sin RLS
-- por ahora, no se expone directo al cliente.

-- Habilita Supabase Realtime (postgres_changes) sobre esta tabla. El relay
-- que reemplaza a onSnapshot (ver plan) escucha esto con la service role key
-- desde el servidor, nunca desde el navegador.
ALTER PUBLICATION supabase_realtime ADD TABLE documents;
