export const mockUsers = {
  admin: {
    uid: "admin1",
    displayName: "Socio Administrador",
    email: "admin@etfa.cl",
    role: "admin",
  },
  user1: {
    uid: "user1",
    displayName: "Ana Contreras",
    email: "ana@etfa.cl",
    role: "professional",
    balance: 350000,
  },
  user2: {
    uid: "user2",
    displayName: "Carlos Rojas",
    email: "carlos@etfa.cl",
    role: "professional",
    balance: 200000,
  },
};

export const mockProjects = [
  {
    id: "p1",
    name: "Monitoreo Mina El Abra",
    client: "Freeport-McMoRan",
    budget: 45000000,
    expenses: 31000000,
    team: ["user1", "user2"],
  },
  {
    id: "p2",
    name: "Estudio de Impacto Acústico",
    client: "Constructora XYZ",
    budget: 18000000,
    expenses: 15500000,
    team: ["user1"],
  },
  {
    id: "p3",
    name: "Mediciones Central Nehuenco",
    client: "Colbún S.A.",
    budget: 32000000,
    expenses: 19000000,
    team: ["user1"],
  },
  {
    id: "p4",
    name: "Mapa de Ruido Santiago",
    client: "Gobierno Regional",
    budget: 25000000,
    expenses: 26500000,
    team: ["user2"],
  },
];

export const mockExpenses = [
  {
    id: "e1",
    userId: "user1",
    projectId: "p1",
    description: "Arriendo de sonómetro",
    amount: 120000,
    date: "2024-08-10",
    status: "approved",
  },
  {
    id: "e2",
    userId: "user1",
    projectId: "p1",
    description: "Cena equipo en Calama",
    amount: 45000,
    date: "2024-08-11",
    status: "approved",
  },
  {
    id: "e3",
    userId: "user1",
    projectId: "p2",
    description: "Transporte a terreno",
    amount: 25000,
    date: "2024-08-12",
    status: "pending",
  },
  {
    id: "e4",
    userId: "user2",
    projectId: "p4",
    description: "Alojamiento",
    amount: 80000,
    date: "2024-08-13",
    status: "pending",
  },
  {
    id: "e5",
    userId: "user1",
    projectId: "p3",
    description: "Combustible camioneta",
    amount: 55000,
    date: "2024-08-14",
    status: "pending",
  },
];

export const formatCurrency = (amount) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" }).format(
    amount
  );
