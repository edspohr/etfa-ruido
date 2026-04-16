import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

/**
 * Creates a notification for a user.
 * @param {string} userId - Target user UID
 * @param {object} data - { type, title, message, link? }
 * Types: 'expense_approved', 'expense_rejected', 'viatico_assigned', 'calendar_assigned', 'task_assigned'
 */
export async function createNotification(userId, { type, title, message, link }) {
  if (!db || !userId) return;
  try {
    await addDoc(collection(db, 'notifications'), {
      userId,
      type,
      title,
      message,
      link: link || null,
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('Error creating notification:', err);
  }
}
