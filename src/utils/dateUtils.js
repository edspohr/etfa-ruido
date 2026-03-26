/**
 * Returns true if the given date is older than 60 days from today.
 * Accepts: ISO date strings (YYYY-MM-DD), ISO datetime strings, or Firestore Timestamps ({ seconds: number }).
 */
export const isOlderThan60Days = (dateStringOrTimestamp) => {
  if (!dateStringOrTimestamp) return false;
  const date = dateStringOrTimestamp?.seconds
    ? new Date(dateStringOrTimestamp.seconds * 1000)
    : new Date(dateStringOrTimestamp);
  if (isNaN(date.getTime())) return false;
  const diffMs = new Date() - date;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays > 60;
};
