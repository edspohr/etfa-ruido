import { db } from "./firebase";
import { collection, doc, writeBatch, getDocs } from "firebase/firestore";

export async function seedDatabase(currentUserId) {
  const batch = writeBatch(db);

  console.log("Starting data cleanup...");

  // 0. Clean existing data
  const collections = ["users", "projects", "expenses", "allocations"];
  for (const colName of collections) {
    const snap = await getDocs(collection(db, colName));
    snap.docs.forEach((d) => {
      // CRITICAL: PROTEGER AL ADMIN ACTUAL (si no, pierde permisos a mitad del proceso)
      if (colName === "users" && d.id === currentUserId) return;

      batch.delete(doc(db, colName, d.id));
    });
  }

  // Commit deletion first
  await batch.commit();
  console.log("Cleanup complete. Starting seeding...");

  const seedBatch = writeBatch(db);

  // 1. Create Real Users
  const users = [
    {
      uid: "user_paula",
      email: "pmontoya@etfa-ruido.cl",
      displayName: "Paula Montoya",
      role: "professional",
      code: "PMS",
      balance: 0,
      forcePasswordChange: true,
    },
    {
      uid: "user_gonzalo",
      email: "grivas@etfa-ruido.cl",
      displayName: "Gonzalo Rivas",
      role: "professional",
      code: "GRM",
      balance: 0,
      forcePasswordChange: true,
    },
    {
      uid: "user_francisco",
      email: "fgonzalez@etfa-ruido.cl",
      displayName: "Francisco Gonzalez",
      role: "professional",
      code: "FGG",
      balance: 0,
      forcePasswordChange: true,
    },
    {
      uid: "user_cristobal",
      email: "craipan@etfa-ruido.cl",
      displayName: "Cristobal Raipan",
      role: "professional",
      code: "CRR",
      balance: 0,
      forcePasswordChange: true,
    },
    {
      uid: "user_maria",
      email: "maguirre@etfa-ruido.cl",
      displayName: "María Verónica Aguirre",
      role: "admin",
      code: "MAS",
      balance: 0,
      forcePasswordChange: true,
    },
    {
      uid: "user_andres",
      email: "aguell@etfa-ruido.cl",
      displayName: "Andrés Güell",
      role: "admin",
      code: "AGS",
      balance: 0,
      forcePasswordChange: true,
    },
    {
      uid: "user_carlos",
      email: "cmunoz@etfa-ruido.cl",
      displayName: "Carlos Muñoz",
      role: "admin",
      code: "CML",
      balance: 0,
      forcePasswordChange: true,
    },
    {
      uid: "user_edmundo",
      email: "edmundo@spohr.cl",
      displayName: "Edmundo Spohr",
      role: "admin",
      code: "ESA",
      balance: 0,
      forcePasswordChange: true,
    },
    // Pseudo-User for Caja Chica Shared Balance
    {
      uid: "user_caja_chica",
      email: "caja-chica@system.local",
      displayName: "Fondo Caja Chica",
      role: "admin", // Admin role to be safe, but mostly internal
      code: "CCH",
      balance: 0,
      forcePasswordChange: false,
    },
    {
      uid: "user_demo",
      email: "espohr@gmail.com",
      displayName: "Usuario Demo",
      role: "professional",
      code: "DEM",
      balance: 0,
      forcePasswordChange: true,
    },
  ];

  // We will update balances as we create allocations
  const userBalances = {};
  users.forEach((u) => (userBalances[u.uid] = 0));

  // 2. Create Users in Firestore
  // We use set() to overwrite/create specific IDs
  for (const user of users) {
    await seedBatch.set(doc(db, "users", user.uid), user);
  }

  // 3. Create Default Projects
  const commonProjects = [
    {
      id: "project_caja_chica",
      name: "Caja Chica",
      client: "Interno",
      budget: 0,
      status: "active",
      type: "petty_cash", // Marker for logic
      createdAt: new Date().toISOString(),
    },
  ];

  for (const p of commonProjects) {
    await seedBatch.set(doc(db, "projects", p.id), p);
  }

  console.log("Skipping mock projects/expenses for Production/Demo mode.");

  await seedBatch.commit();
  console.log("Database Cleaned & Users Seeded (No Mock Data)");
}
