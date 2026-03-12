/**
 * sortProjects — ascending order by code (alphanumeric) then name.
 * Safe: handles nulls, missing fields, and mixed-case codes.
 * Use this everywhere a project list is rendered.
 */
export function sortProjects(projects) {
  if (!Array.isArray(projects)) return [];
  return [...projects].sort((a, b) => {
    // 1. Primary: code (alphanumeric, case-insensitive). Items without code go last.
    const codeA = (a?.code ?? '').trim().toUpperCase();
    const codeB = (b?.code ?? '').trim().toUpperCase();
    if (codeA && !codeB) return -1;
    if (!codeA && codeB) return 1;
    if (codeA !== codeB) {
      // Natural sort: "ET-10" > "ET-9" (not lexicographic)
      return codeA.localeCompare(codeB, 'es', { numeric: true });
    }
    // 2. Secondary: name (case-insensitive)
    const nameA = (a?.name ?? '').trim().toLowerCase();
    const nameB = (b?.name ?? '').trim().toLowerCase();
    return nameA.localeCompare(nameB, 'es', { numeric: true });
  });
}
