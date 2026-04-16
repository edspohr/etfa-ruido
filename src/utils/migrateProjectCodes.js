import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';

/**
 * Migrates all projects to unified code format PXXXR.
 * Merges `code` + `recurrence` into a single `code` field.
 * Sets `recurrence` to empty string after migration.
 * Also updates related documents (expenses, invoices, tasks, calendar_events)
 * that store projectCode or projectRecurrence.
 *
 * Safe to run multiple times — skips already-migrated projects (recurrence already empty).
 */
export async function migrateProjectCodes() {
  const projSnap = await getDocs(collection(db, 'projects'));
  const projects = projSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  let migratedCount = 0;

  // Pre-fetch related collections once to avoid N×M queries
  const [expSnap, invSnap, taskSnap, calSnap] = await Promise.all([
    getDocs(collection(db, 'expenses')),
    getDocs(collection(db, 'invoices')),
    getDocs(collection(db, 'tasks')),
    getDocs(collection(db, 'calendar_events')),
  ]);

  for (const project of projects) {
    const oldCode = (project.code || '').trim();
    const oldRec  = (project.recurrence || '').trim();

    // Skip if no recurrence to merge, or already migrated
    if (!oldRec) continue;

    const newCode = `${oldCode}${oldRec}`;
    const batch   = writeBatch(db);

    // Update project
    batch.update(doc(db, 'projects', project.id), {
      code: newCode,
      recurrence: '',
    });

    // Update expenses that reference this project
    expSnap.docs.forEach(d => {
      const data = d.data();
      if (data.projectId === project.id && data.projectRecurrence) {
        batch.update(doc(db, 'expenses', d.id), { projectRecurrence: '' });
      }
    });

    // Update invoices
    invSnap.docs.forEach(d => {
      const data = d.data();
      if (data.projectId === project.id) {
        const updates = {};
        if (data.projectCode) updates.projectCode = newCode;
        if (data.projectRecurrence) updates.projectRecurrence = '';
        if (Object.keys(updates).length > 0) batch.update(doc(db, 'invoices', d.id), updates);
      }
    });

    // Update tasks
    taskSnap.docs.forEach(d => {
      if (d.data().projectId === project.id && d.data().projectCode) {
        batch.update(doc(db, 'tasks', d.id), { projectCode: newCode });
      }
    });

    // Update calendar_events
    calSnap.docs.forEach(d => {
      if (d.data().projectId === project.id && d.data().projectCode) {
        batch.update(doc(db, 'calendar_events', d.id), { projectCode: newCode });
      }
    });

    await batch.commit();
    migratedCount++;
  }

  return migratedCount;
}
