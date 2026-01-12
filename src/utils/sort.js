export const sortProjects = (projects) => {
  return [...projects].sort((a, b) => {
    // 1. Sort by Code
    const codeA = (a.code || "").toString().toLowerCase();
    const codeB = (b.code || "").toString().toLowerCase();

    // Handle numeric codes correctly if possible, otherwise string sort
    const numA = parseInt(codeA.replace(/\D/g, ""));
    const numB = parseInt(codeB.replace(/\D/g, ""));

    if (codeA !== codeB) {
      // If both seem strictly numeric logic might be better, but codes can be "PRJ-01".
      // Let's stick to standard localeCompare for safety unless clearly numeric?
      // User asked "menor a mayor por sus códigos".
      // Let's try to be smart: if they look like numbers or string-numbers
      if (
        !isNaN(numA) &&
        !isNaN(numB) &&
        codeA.replace(/\d/g, "") === codeB.replace(/\d/g, "")
      ) {
        if (numA !== numB) return numA - numB;
      }
      return codeA.localeCompare(codeB, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }

    // 2. Sort by Recurrence
    const recA = (a.recurrence || "").toString().toLowerCase();
    const recB = (b.recurrence || "").toString().toLowerCase();
    return recA.localeCompare(recB, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
};
