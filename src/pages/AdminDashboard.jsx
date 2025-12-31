import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { db } from '../lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { seedDatabase } from '../lib/seedData';
import { formatCurrency } from '../utils/format';
import { useAuth } from '../context/useAuth';
import { Database } from 'lucide-react';

export default function AdminDashboard() {
  const { currentUser } = useAuth();
  const [projects, setProjects] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    async function fetchData() {
        try {
            // 1. Fetch Projects
            const projectsSnap = await getDocs(collection(db, "projects"));
            const projectsData = projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // 2. Fetch All Allocations (to sum up Assigned Budget)
            const allocationsSnap = await getDocs(collection(db, "allocations"));
            const allocationsDocs = allocationsSnap.docs.map(doc => doc.data());

            // 3. Fetch All Expenses (to sum up Rendered)
            const expensesSnap = await getDocs(collection(db, "expenses"));
            const expensesDocs = expensesSnap.docs.map(doc => doc.data());

            // 4. Aggregate Data per Project
            const expensesByProject = {};
            const budgetByProject = {};
            let pending = 0;

            // Sum Expenses
            expensesDocs.forEach(exp => {
                if (exp.status === 'pending') pending++;
                if (exp.status === 'approved' || exp.status === 'pending') {
                    expensesByProject[exp.projectId] = (expensesByProject[exp.projectId] || 0) + (Number(exp.amount) || 0);
                }
            });

            // Sum Allocations (Assigned Budget)
            allocationsDocs.forEach(alloc => {
                if (alloc.projectId) {
                    budgetByProject[alloc.projectId] = (budgetByProject[alloc.projectId] || 0) + (Number(alloc.amount) || 0);
                }
            });

            // 5. Merge into Projects
            const finalProjects = projectsData.map(p => ({
                ...p,
                expenses: expensesByProject[p.id] || 0,
                budget: budgetByProject[p.id] || 0 // Overwrite static budget with calculated sum
            }));

            setProjects(finalProjects);
            setPendingCount(pending);
        } catch (e) {
            console.error("Error loading dashboard:", e);
        } finally {
            setLoading(false);
        }
    }
    fetchData();
  }, []);

  const handleSeed = async () => {
      if (!confirm("Esto borrará/sobrescribirá datos. ¿Estás seguro?")) return;
      
      const pin = prompt("Ingrese la clave de seguridad para confirmar:");
      if (pin !== "1234") {
          alert("Clave incorrecta. Cancelando operación.");
          return;
      }

      setSeeding(true);
      try {
          await seedDatabase(currentUser.uid);
          alert("Datos cargados correctamente");
          
          // Refresh Data Manually
          const projectsSnap = await getDocs(collection(db, "projects"));
          const projectsData = projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setProjects(projectsData);

          const q = query(collection(db, "expenses"), where("status", "==", "pending"));
          const pendingSnap = await getDocs(q);
          setPendingCount(pendingSnap.size);
      } catch (e) {
          console.error(e);
          alert("Error cargando datos: " + e.message);
      }
      setSeeding(false);
  };

  const totalBudget = projects.reduce((acc, p) => acc + (p.budget || 0), 0);

  if (loading) return <Layout title="Dashboard General"><p className="p-8">Cargando...</p></Layout>;

  return (
    <Layout title="Dashboard General">
        <div className="flex justify-end mb-4">
            <button 
                onClick={handleSeed}
                disabled={seeding}
                className="flex items-center text-sm bg-gray-800 text-white px-3 py-2 rounded hover:bg-gray-700 disabled:opacity-50"
            >
                <Database className="w-4 h-4 mr-2" />
                {seeding ? 'Procesando...' : 'Reiniciar Base de Datos (Solo Usuarios)'}
            </button>
            <a 
                href="/admin/users-seeder" 
                className="ml-2 flex items-center text-sm bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700"
            >
                Crear Cuentas (Auth)
            </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                <h3 className="text-gray-500 text-sm font-medium">Proyectos Activos</h3>
                <p className="text-3xl font-bold text-gray-800">{projects.length}</p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                <h3 className="text-gray-500 text-sm font-medium">Presupuesto Total</h3>
                <p className="text-3xl font-bold text-gray-800">{formatCurrency(totalBudget)}</p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                <h3 className="text-gray-500 text-sm font-medium">Rendiciones Pendientes</h3>
                <p className="text-3xl font-bold text-orange-500">{pendingCount}</p>
            </div>
        </div>

        <div className="mt-8">
            <h2 className="text-xl font-bold mb-4 text-gray-800">Resumen de Proyectos</h2>
            {projects.length === 0 ? (
                <p className="text-gray-500">No hay proyectos activos.</p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {projects.map(p => {
                        const expenses = p.expenses || 0;
                        const budget = p.budget || 0;
                        const percentage = budget > 0 ? (expenses / budget) * 100 : 0;
                        
                        return (
                            <div key={p.id} className="bg-white p-5 rounded-lg shadow-sm border border-gray-100 flex flex-col justify-between h-full">
                                <div>
                                    <h3 className="font-bold text-lg text-gray-800 mb-1">{p.name}</h3>
                                    <p className="text-sm text-gray-500 mb-4">{p.client}</p>
                                    
                                    <div className="flex justify-between items-end mb-2">
                                        <div>
                                            <p className="text-xs text-gray-500 uppercase font-semibold">Asignado (Viático)</p>
                                            <p className="text-xl font-bold text-gray-800">{formatCurrency(budget)}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs text-gray-500 uppercase font-semibold">Rendido</p>
                                            <p className={`text-xl font-bold ${expenses > budget ? 'text-red-600' : 'text-blue-600'}`}>
                                                {formatCurrency(expenses)}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-2">
                                    <div className="w-full bg-gray-100 rounded-full h-2 mb-1">
                                        <div 
                                            className={`h-2 rounded-full ${expenses > budget ? 'bg-red-500' : 'bg-blue-500'}`} 
                                            style={{ width: `${Math.min(percentage, 100)}%` }}
                                        ></div>
                                    </div>
                                    <p className="text-xs text-right text-gray-400">
                                        {percentage.toFixed(1)}% Ejecutado
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    </Layout>
  );
}
