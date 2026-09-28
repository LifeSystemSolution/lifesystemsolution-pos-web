/**
 * scripts/lib/test-cleanup.mjs — compartido por smoke-test y load-test.
 * Todas las empresas de prueba se llaman "ZZ Prueba ..."; esto las borra por
 * SQL (documentos, cuentas de acceso y la empresa) si la API no pudo.
 */
// Respaldo: borra por SQL cualquier empresa de prueba que haya quedado.
export async function sqlCleanup(pool) {
  const c = await pool.connect()
  try {
    await c.query("BEGIN")
    await c.query("select set_config('app.is_platform_owner','true',true)")
    const ids = (await c.query("select id from companies where name like 'ZZ Prueba %'")).rows.map((r) => r.id)
    if (ids.length) {
      const accs = (await c.query(
        "select cm.auth_account_id from company_members cm join auth_accounts a on a.id = cm.auth_account_id where cm.company_id = any($1) and not a.is_platform_owner", [ids])).rows.map((r) => r.auth_account_id)
      await c.query("delete from documents where company_id = any($1)", [ids])
      await c.query("delete from company_members where company_id = any($1)", [ids])
      await c.query("delete from auth_accounts where id = any($1)", [accs])
      await c.query("delete from companies where id = any($1)", [ids])
      console.log(`limpieza SQL de respaldo: ${ids.length} empresa(s) de prueba`)
    }
    await c.query("COMMIT")
  } catch (e) {
    await c.query("ROLLBACK")
    throw e
  } finally {
    c.release()
  }
}
