import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';

export default function useNotificationCounts() {
  const [pendingExpenses, setPendingExpenses] = useState(0);
  const [pendingReports,  setPendingReports]  = useState(0);

  useEffect(() => {
    if (!db) return;

    const unsubExpenses = onSnapshot(
      query(collection(db, 'expenses'), where('status', '==', 'pending')),
      snap => setPendingExpenses(snap.size),
      err  => console.error('Notification count error (expenses):', err)
    );

    const unsubReports = onSnapshot(
      query(collection(db, 'reports'), where('status', '==', 'submitted')),
      snap => setPendingReports(snap.size),
      err  => console.error('Notification count error (reports):', err)
    );

    return () => { unsubExpenses(); unsubReports(); };
  }, []);

  return { pendingExpenses, pendingReports };
}
