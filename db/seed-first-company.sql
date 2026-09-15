-- db/seed-first-company.sql
-- ---------------------------------------------------------------------------
-- Alta de la primera empresa (bootstrap). Esta es la ÚNICA vez que se hace a
-- mano por SQL Editor — cuando haya panel de plataforma, esto se reemplaza
-- por un botón "Nueva empresa" que hace lo mismo desde código.
--
-- UID/correo tomados de Firebase Auth (Consola → Authentication → Users).
-- ---------------------------------------------------------------------------

INSERT INTO companies (id, name, plan, active)
VALUES ('lifesystemsolution', 'LifeSystemSolution', 'trial', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO company_members (firebase_uid, company_id, email)
VALUES ('WEn9FizKDSMPKm8IE0y0I742B8G2', 'lifesystemsolution', 'admin@lifesystemsolution.com')
ON CONFLICT (firebase_uid) DO NOTHING;

-- Verificación rápida:
-- SELECT * FROM companies;
-- SELECT * FROM company_members;
