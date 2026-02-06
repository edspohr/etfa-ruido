import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "fs";

// --- CONFIGURATION ---
// User indicated to assume default credentials or service account.
// If GOOGLE_APPLICATION_CREDENTIALS is set, initializeApp() works without args.
// Otherwise, we might need a key path. For now, we try default.

let app;
try {
  if (getApps().length === 0) {
    app = initializeApp();
    console.log("Firebase Admin initialized with default credentials.");
  } else {
    app = getApps()[0];
  }
} catch (e) {
  console.error(
    "Failed to initialize Firebase Admin. Ensure you have GOOGLE_APPLICATION_CREDENTIALS set or are logged in via gcloud.",
    e,
  );
  process.exit(1);
}

const db = getFirestore(app);

async function migrateProjects() {
  console.log("Starting migration: Backfilling 'code' and 'recurrence'...");

  try {
    const projectsRef = db.collection("projects");
    const snapshot = await projectsRef.get();

    if (snapshot.empty) {
      console.log("No projects found.");
      return;
    }

    let updatedCount = 0;
    let skippedCount = 0;
    let counter = 1;

    const updates = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const updatesForDoc = {};
      let needsUpdate = false;

      // 1. Check if 'code' exists
      if (!data.code) {
        // Generate code: PRJ-001, PRJ-002...
        // Padding with zeros
        const code = `PRJ-${String(counter).padStart(3, "0")}`;
        updatesForDoc.code = code;
        counter++;
        needsUpdate = true;
      }

      // 2. Check if 'recurrence' exists
      if (!data.recurrence) {
        // Default to 'Mensual' or 'Único'.
        // Prompt said "Default (ej: 'Único' o 'Mensual')".
        // Choosing 'Único' as a safe default for old projects unless client hints otherwise.
        // Let's use 'Único' to be safe, or 'Mensual' if that's more likely?
        // Given it's a billing system, 'Mensual' is common, but 'Único' is safer for legacy.
        // I will use 'Único' based on "Rendición de Gastos" context (often one-off).
        updatesForDoc.recurrence = "Único";
        needsUpdate = true;
      }

      // 3. Check 'billingStatus'
      if (!data.billingStatus) {
        updatesForDoc.billingStatus = "pending";
        needsUpdate = true;
      }

      if (needsUpdate) {
        // Pushing promise to array for parallel execution could be faster,
        // but serial is safer for logging and avoiding rate limits if huge.
        // Given "local script", let's do it individually but await.
        const updatePromise = projectsRef
          .doc(doc.id)
          .update(updatesForDoc)
          .then(() => {
            console.log(`[UPDATE] Project ${doc.id}:`, updatesForDoc);
          })
          .catch((err) => {
            console.error(`[ERROR] Failed to update ${doc.id}:`, err);
          });
        updates.push(updatePromise);
        updatedCount++;
      } else {
        skippedCount++;
        // console.log(`[SKIP] Project ${doc.id} already has fields.`);
      }
    }

    await Promise.all(updates);

    console.log("------------------------------------------------");
    console.log(`Migration Complete.`);
    console.log(`Updated: ${updatedCount}`);
    console.log(`Skipped: ${skippedCount}`);
    console.log("------------------------------------------------");
  } catch (error) {
    console.error("Migration fatal error:", error);
  }
}

migrateProjects();
