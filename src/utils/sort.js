/**
 * sortProjects — ascending order by code, then recurrence, then name.
 * Safe: handles nulls, missing fields, and mixed-case codes.
 * Use this everywhere a project list is rendered.
 */
export function sortProjects(projects) {
  if (!Array.isArray(projects)) return [];
  return [...projects].sort((a, b) => {
    // 1. Primary: code (alphanumeric ascending). Items without code go last.
    const codeA = (a?.code ?? '').trim().toUpperCase();
    const codeB = (b?.code ?? '').trim().toUpperCase();
    if (codeA && !codeB) return -1;
    if (!codeA && codeB) return 1;
    if (codeA !== codeB) {
      return codeA.localeCompare(codeB, 'es', { numeric: true });
    }
    // 2. Secondary: recurrence (ascending). Items without recurrence go first.
    const recA = (a?.recurrence ?? '').trim().toUpperCase();
    const recB = (b?.recurrence ?? '').trim().toUpperCase();
    if (recA !== recB) {
      if (!recA && recB) return -1;
      if (recA && !recB) return 1;
      return recA.localeCompare(recB, 'es', { numeric: true });
    }
    // 3. Tertiary: name (ascending)
    const nameA = (a?.name ?? '').trim().toLowerCase();
    const nameB = (b?.name ?? '').trim().toLowerCase();
    return nameA.localeCompare(nameB, 'es', { numeric: true });
  });
}
