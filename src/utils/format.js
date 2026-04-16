export const formatCurrency = (amount) => {
  if (amount === undefined || amount === null) return "$0";
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

/**
 * Returns a display label for a project: "[CODE] (RECURRENCE) Name"
 * Used consistently across all views.
 */
export const formatProjectLabel = (project) => {
  if (!project) return 'Sin Proyecto';
  const parts = [];
  if (project.code) parts.push(`[${project.code}]`);
  if (project.recurrence) parts.push(`(${project.recurrence})`);
  parts.push(project.name || 'Sin Nombre');
  return parts.join(' ');
};
