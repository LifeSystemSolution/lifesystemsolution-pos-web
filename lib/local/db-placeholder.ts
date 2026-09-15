/**
 * lib/local/db-placeholder.ts
 * ---------------------------------------------------------------------------
 * El shim (lib/local/firebase-shim/firestore.ts) ignora el primer argumento
 * de collection()/doc()/query()/etc. — antes ahí se pasaba el `db` real de
 * Firestore (ya inerte para el shim, pero necesario porque el código
 * original lo pasa). Este `db` reemplaza a ese import sin ninguna
 * dependencia de Firebase.
 * ---------------------------------------------------------------------------
 */
export const db = null
