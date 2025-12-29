import { db } from "./firebase";
import { collection, doc, writeBatch, getDocs } from "firebase/firestore";

export async function seedDatabase() {
  const batch = writeBatch(db);

  console.log("Starting data cleanup...");

  // 0. Clean existing data
  const collections = ["users", "projects", "expenses"];
  for (const colName of collections) {
    const snap = await getDocs(collection(db, colName));
    snap.docs.forEach((d) => {
      batch.delete(doc(db, colName, d.id));
    });
  }

  // Commit deletion first to avoid batch limit issues if many docs
  // But for now, we'll try to do it all in one go or separate batches if needed.
  // Given "clean" might be large, let's commit clean up first.
  await batch.commit();
  console.log("Cleanup complete. Starting seeding...");

  const seedBatch = writeBatch(db);

  // 1. Create Mock Professionals
  const users = [
    {
      uid: "user_ana",
      email: "ana@etfa.cl",
      displayName: "Ana Contreras",
      role: "professional",
      balance: 150000,
    },
    {
      uid: "user_carlos",
      email: "carlos@etfa.cl",
      displayName: "Carlos Rojas",
      role: "professional",
      balance: 80000,
    },
    {
      uid: "user_sofia",
      email: "sofia@etfa.cl",
      displayName: "Sofía Mendoza",
      role: "professional",
      balance: 320000,
    },
    {
      uid: "user_miguel",
      email: "miguel@etfa.cl",
      displayName: "Miguel Ángel",
      role: "professional",
      balance: 0,
    },
    {
      uid: "user_laura",
      email: "laura@etfa.cl",
      displayName: "Laura Vicuña",
      role: "professional",
      balance: 500000,
    },
  ];

  users.forEach((user) => {
    seedBatch.set(doc(db, "users", user.uid), user);
  });

  // 2. Create 15 Projects
  const clients = [
    "Minera Escondida",
    "Codelco",
    "Constructora SALFA",
    "Gobierno Regional",
    "Aguas Andinas",
  ];
  const projectNames = [
    "Monitoreo Ruido",
    "Estudio Impacto",
    "Línea Base",
    "Vigilancia Ocupacional",
    "Modelación Acústica",
  ];
  const projects = [];

  for (let i = 0; i < 15; i++) {
    const client = clients[i % clients.length];
    const type = projectNames[i % projectNames.length];
    projects.push({
      name: `${type} - ${client} ${i + 1}`,
      client: client,
      budget: 10000000 + Math.floor(Math.random() * 50) * 1000000, // 10M - 60M
      expenses: 0, // Will update based on expenses for realism? Or just mock basic stats
      status: "active",
      createdAt: new Date().toISOString(),
    });
  }

  const projectRefs = projects.map(() => doc(collection(db, "projects")));
  projectRefs.forEach((ref, index) => {
    seedBatch.set(ref, { ...projects[index], id: ref.id });
  });

  // 3. Create 40 Expenses
  const statuses = ["approved", "approved", "pending", "pending", "rejected"]; // Weighted
  for (let i = 0; i < 50; i++) {
    const user = users[i % users.length];
    const projectRef = projectRefs[i % projectRefs.length];
    const project = projects[i % projects.length];
    const status = statuses[i % statuses.length];
    const amount = (Math.floor(Math.random() * 20) + 1) * 5000; // 5000 - 100000

    const expenseRef = doc(collection(db, "expenses"));
    seedBatch.set(expenseRef, {
      id: expenseRef.id,
      userId: user.uid,
      userName: user.displayName,
      projectId: projectRef.id,
      projectName: project.name,
      description: `Gasto simulado #${i + 1} - ${status}`,
      amount: amount,
      date: new Date(2024, 0, i + 1).toISOString().split("T")[0], // Spread dates
      status: status,
      createdAt: new Date().toISOString(),
    });
  }

  await seedBatch.commit();
  console.log("Database Seeded Successfully with 50+ records");
}
