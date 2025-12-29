import { db } from "./firebase";
import { collection, doc, setDoc, writeBatch } from "firebase/firestore";

export async function seedDatabase() {
  const batch = writeBatch(db);

  // 1. Create Mock Professionals
  const users = [
    {
      uid: "mock_user_1",
      email: "ana@etfa.cl",
      displayName: "Ana Contreras",
      role: "professional",
      balance: 350000,
    },
    {
      uid: "mock_user_2",
      email: "carlos@etfa.cl",
      displayName: "Carlos Rojas",
      role: "professional",
      balance: 200000,
    },
    {
      uid: "mock_user_3",
      email: "sofia@etfa.cl",
      displayName: "Sofia Mendoza",
      role: "professional",
      balance: 0,
    },
  ];

  users.forEach((user) => {
    const userRef = doc(db, "users", user.uid);
    batch.set(userRef, user);
  });

  // 2. Create Projects
  const projects = [
    {
      name: "Monitoreo Mina El Abra",
      client: "Freeport-McMoRan",
      budget: 45000000,
      expenses: 31000000,
      status: "active",
      createdAt: new Date().toISOString(),
    },
    {
      name: "Estudio de Impacto Acústico",
      client: "Constructora XYZ",
      budget: 18000000,
      expenses: 2500000,
      status: "active",
      createdAt: new Date().toISOString(),
    },
    {
      name: "Mediciones Central Nehuenco",
      client: "Colbún S.A.",
      budget: 32000000,
      expenses: 19000000,
      status: "active",
      createdAt: new Date().toISOString(),
    },
    {
      name: "Mapa de Ruido Santiago",
      client: "Gobierno Regional",
      budget: 25000000,
      expenses: 0,
      status: "active",
      createdAt: new Date().toISOString(),
    },
  ];

  // We need IDs for projects to link expenses
  const projectRefs = projects.map(() => doc(collection(db, "projects")));
  projectRefs.forEach((ref, index) => {
    batch.set(ref, { ...projects[index], id: ref.id });
  });

  // 3. Create Expenses (Approved and Pending)
  const expenses = [
    {
      userId: "mock_user_1",
      userName: "Ana Contreras",
      projectId: projectRefs[0].id,
      projectName: "Monitoreo Mina El Abra",
      description: "Arriendo de sonómetro",
      amount: 120000,
      date: "2024-08-10",
      status: "approved",
    },
    {
      userId: "mock_user_1",
      userName: "Ana Contreras",
      projectId: projectRefs[0].id,
      projectName: "Monitoreo Mina El Abra",
      description: "Cena equipo en Calama",
      amount: 45000,
      date: "2024-08-11",
      status: "approved",
    },
    {
      userId: "mock_user_1",
      userName: "Ana Contreras",
      projectId: projectRefs[1].id,
      projectName: "Estudio de Impacto Acústico",
      description: "Transporte a terreno",
      amount: 25000,
      date: "2024-08-12",
      status: "pending",
    },
    {
      userId: "mock_user_2",
      userName: "Carlos Rojas",
      projectId: projectRefs[3].id,
      projectName: "Mapa de Ruido Santiago",
      description: "Alojamiento",
      amount: 80000,
      date: "2024-08-13",
      status: "pending",
    },
    {
      userId: "mock_user_2",
      userName: "Carlos Rojas",
      projectId: projectRefs[3].id,
      projectName: "Mapa de Ruido Santiago",
      description: "Materiales de Oficina",
      amount: 15600,
      date: "2024-08-14",
      status: "pending",
    },
  ];

  expenses.forEach((expense) => {
    const expenseRef = doc(collection(db, "expenses"));
    batch.set(expenseRef, {
      ...expense,
      id: expenseRef.id,
      createdAt: new Date().toISOString(),
    });
  });

  await batch.commit();
  console.log("Database Seeded Successfully");
}
