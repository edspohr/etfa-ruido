import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { parseISO, addDays, format } from 'date-fns';

/**
 * Idempotently creates a "Reporte Técnico" task linked to a closed calendar event.
 * Safe to call multiple times — exits early if the task already exists.
 *
 * @param {Object} calendarEvent  - Full calendar event object (must have .id)
 * @param {import('firebase/firestore').Firestore} db
 */
export async function generateReporteTecnicoTask(calendarEvent, db) {
  // 1. Guard: don't create duplicates for the same event
  const existing = await getDocs(
    query(collection(db, 'tasks'), where('calendarEventId', '==', calendarEvent.id))
  );
  if (existing.docs.some(d => d.data().type === 'reporte_tecnico')) return;

  // 2. dueDate = event end date + 4 calendar days
  const endDate = parseISO(calendarEvent.endDate);
  const dueDate = format(addDays(endDate, 4), 'yyyy-MM-dd');

  // 3. Create the task
  await addDoc(collection(db, 'tasks'), {
    type:            'reporte_tecnico',
    title:           `Reporte Técnico — ${calendarEvent.projectName}`,
    projectId:       calendarEvent.projectId       || '',
    projectName:     calendarEvent.projectName     || '',
    projectCode:     calendarEvent.projectCode     || '',
    assignedTo:      calendarEvent.ingenieros      || [],
    assignedToNames: calendarEvent.ingenierosNames || [],
    dueDate,
    status:          'pendiente',
    calendarEventId: calendarEvent.id,
    createdBy:       'system',
    createdAt:       serverTimestamp(),
    completedAt:     null,
    notes:           '',
  });
}
