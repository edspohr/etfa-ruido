import { db } from "./firebase";
import { collection, doc, writeBatch, getDocs } from "firebase/firestore";

export async function seedDatabase() {
  const batch = writeBatch(db);

  console.log("Starting data cleanup...");

  // 0. Clean existing data
  const collections = ["users", "projects", "expenses", "allocations"];
  for (const colName of collections) {
    const snap = await getDocs(collection(db, colName));
    snap.docs.forEach((d) => {
      batch.delete(doc(db, colName, d.id));
    });
  }

  // Commit deletion first
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
      balance: 0,
    },
    {
      uid: "user_carlos",
      email: "carlos@etfa.cl",
      displayName: "Carlos Rojas",
      role: "professional",
      balance: 0,
    },
    {
      uid: "user_sofia",
      email: "sofia@etfa.cl",
      displayName: "Sofía Mendoza",
      role: "professional",
      balance: 0,
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
      balance: 0,
    },
  ];

  // We will update balances as we create allocations
  const userBalances = {};
  users.forEach((u) => (userBalances[u.uid] = 0));

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
      // Budget field is less relevant now as it's a sum of allocations, but keeping for reference if needed
      budget: 0,
      status: "active",
      createdAt: new Date().toISOString(),
    });
  }

  const projectRefs = projects.map(() => doc(collection(db, "projects")));
  projectRefs.forEach((ref, index) => {
    seedBatch.set(ref, { ...projects[index], id: ref.id });
  });

  // 3. Create Allocations (Assign Viaticos)
  // Each project gets 2-4 allocations to different users
  for (let i = 0; i < projects.length; i++) {
    const projectRef = projectRefs[i];
    const numAllocations = Math.floor(Math.random() * 3) + 2; // 2 to 4 allocations

    for (let j = 0; j < numAllocations; j++) {
      const user = users[Math.floor(Math.random() * users.length)];
      const amount = (Math.floor(Math.random() * 20) + 5) * 100000; // 500k - 2.5M

      const allocRef = doc(collection(db, "allocations"));
      seedBatch.set(allocRef, {
        projectId: projectRef.id,
        projectName: projects[i].name,
        userId: user.uid,
        userName: user.displayName,
        amount: amount,
        date: new Date().toISOString(),
      });

      // Track balance
      userBalances[user.uid] += amount;
    }
  }

  // Update Users with calculated balances
  users.forEach((user) => {
    user.balance = userBalances[user.uid];
    seedBatch.set(doc(db, "users", user.uid), user);
  });

  // 4. Create 50 Expenses
  const statuses = ["approved", "approved", "pending", "pending", "rejected"];
  for (let i = 0; i < 50; i++) {
    const user = users[i % users.length];
    const projectRef = projectRefs[i % projectRefs.length];
    const project = projects[i % projects.length];
    const status = statuses[i % statuses.length];
    const amount = (Math.floor(Math.random() * 20) + 1) * 5000; // 5000 - 100000

    // Deduct from balance if approved/pending (simulation logic)
    // users are already set, so we don't update them here again in this batch for simplicity,
    // assuming 'balance' in users collection is 'current available balance'.
    // ideally we would deduct, but for seeding let's just leave the initial allocation as the "loaded" amount.

    const expenseRef = doc(collection(db, "expenses"));
    seedBatch.set(expenseRef, {
      id: expenseRef.id,
      userId: user.uid,
      userName: user.displayName,
      projectId: projectRef.id,
      projectName: project.name,
      description: `Gasto simulado #${i + 1} - ${status}`,
      amount: amount,
      date: new Date(2024, 0, i + 1).toISOString().split("T")[0],
      status: status,
      createdAt: new Date().toISOString(),
    });
  }

  await seedBatch.commit();
  console.log("Database Seeded Successfully with Allocations");
}
