/**
 * Estados permitidos para un informe de terreno.
 * @type {Object}
 */
export const REPORT_STATUSES = {
  DRAFT:       'draft',
  SUBMITTED:   'submitted',
  IN_PROGRESS: 'in_progress',
  APPROVED:    'approved',
  REJECTED:    'rejected',
};

/**
 * Crea un objeto plano que representa un nuevo informe de terreno para Firestore.
 * 
 * @param {Object} params - Parámetros para crear el informe.
 * @param {string} params.calendarEventId - ID del evento del calendario relacionado.
 * @param {string} params.projectId - ID del proyecto.
 * @param {string} params.projectName - Nombre del proyecto.
 * @param {string} [params.projectCode] - Código opcional del proyecto.
 * @param {string} [params.recurrence] - Datos opcionales de recurrencia.
 * @param {string} params.authorId - UID del profesional que inició el informe.
 * @param {string} params.authorName - Nombre del profesional autor.
 * @returns {Object} Datos del informe para Firestore.
 */
export function createReportData({
  calendarEventId,
  projectId,
  projectName,
  projectCode = null,
  recurrence = null,
  authorId,
  authorName
}) {
  return {
    calendarEventId,
    projectId,
    projectName,
    projectCode,
    recurrence,
    authorId,
    authorName,
    assignedToId: authorId,
    assignedToName: authorName,
    status: REPORT_STATUSES.DRAFT,
    apuntes: [],
    attachmentURL: null,
    attachmentName: null,
    reviewComment: null,
    createdAt: null,
    updatedAt: null,
    submittedAt: null,
    approvedAt: null,
  };
}

/**
 * Crea un objeto plano para una nota incremental ("apunte") dentro de un informe.
 * 
 * @param {Object} params - Parámetros para el apunte.
 * @param {string} params.content - Texto transcrito o escrito.
 * @param {string} params.authorId - UID del autor de la nota.
 * @param {string} params.authorName - Nombre del autor de la nota.
 * @returns {Object} Datos del apunte.
 */
export function createApunteData({ content, authorId, authorName }) {
  return {
    content,
    authorId,
    authorName,
    createdAt: null,
  };
}
