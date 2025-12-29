import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { db } from '../lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { seedDatabase } from '../lib/seedData';
import { formatCurrency } from '../lib/mockData'; // Reuse format helper, or move it to utils
import { Database } from 'lucide-react';

export default function AdminDashboard() {
  const [projects, setProjects] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  async function fetchData() {
      // Fetch Projects
      const projectsSnap = await getDocs(collection(db, "projects"));
      const projectsData = projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setProjects(projectsData);

      // Fetch Pending Expenses count
      const q = query(collection(db, "expenses"), where("status", "==", "pending"));
      const pendingSnap = await getDocs(q);
      setPendingCount(pendingSnap.size);

      setLoading(false);
  }

  useEffect(() => {
    fetchData();
  }, []);

  const handleSeed = async () => {
      if (!confirm("Esto borrará/sobrescribirá datos. ¿Estás seguro?")) return;
      setSeeding(true);
      try {
          await seedDatabase();
          alert("Datos cargados correctamente");
          fetchData(); // Refresh data
      } catch (e) {
          console.error(e);
          alert("Error cargando datos");
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
                {seeding ? 'Generando...' : 'Generar Datos de Prueba'}
            </button>
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
