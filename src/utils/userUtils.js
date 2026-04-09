/**
 * Returns true if the user is a system/phantom account that should be hidden
 * from professional-facing views (balances, dropdowns, etc.).
 */
export function isSystemUser(user) {
  if (!user) return false;
  const email = (user.email || '').toLowerCase();
  const uid = (user.uid || user.id || '').toLowerCase();
  const name = (user.displayName || '').toLowerCase();

  if (email.endsWith('@system.local')) return true;
  if (uid === 'user_caja_chica' || uid === 'user_demo') return true;
  if (uid === 'company_expense') return true;
  if (name === 'fondo caja chica') return true;

  return false;
}
