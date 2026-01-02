import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { db } from '../lib/firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { seedDatabase } from '../lib/seedData';
import { formatCurrency } from '../utils/format';
import { useAuth } from '../context/useAuth';
import { Database, Wallet } from 'lucide-react';

export default function AdminDashboard() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [cajaChicaBalance, setCajaChicaBalance] = useState(0);
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

            // 4. Fetch Caja Chica Balance
            // Try to find user 'user_caja_chica'
            try {
                const cajaRef = doc(db, "users", "user_caja_chica");
                const cajaSnap = await getDoc(cajaRef);
                if (cajaSnap.exists()) {
                    setCajaChicaBalance(cajaSnap.data().balance || 0);
                }
            } catch (err) {
                console.warn("Could not fetch user_caja_chica:", err);
            }

            // 5. Aggregate Data per Project
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

            // 6. Merge into Projects
            const finalProjects = projectsData.map(p => ({
                ...p,
                expenses: expensesByProject[p.id] || 0,
                assigned: budgetByProject[p.id] || 0 // New Logic: Budget is dynamic sum of allocations
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
      // ... (existing seed logic)
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
          window.location.reload(); 
      } catch (e) {
          console.error(e);
          alert("Error cargando datos: " + e.message);
      }
      setSeeding(false);
  };

  const totalAssigned = projects.reduce((acc, p) => acc + (p.assigned || 0), 0);

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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
             {/* Caja Chica Card */}
            <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100 relative overflow-hidden group hover:shadow-lg transition duration-300">
                <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition">
                    <Wallet className="w-16 h-16 text-teal-600" />
                </div>
                <h3 className="text-gray-500 text-sm font-bold uppercase tracking-wider mb-2">Fondo Caja Chica</h3>
                <p className="text-3xl font-extrabold text-teal-600 mb-4">{formatCurrency(cajaChicaBalance)}</p>
                <button 
                    onClick={() => {
                        const cajaProject = projects.find(p => p.name?.toLowerCase().includes("caja chica") || p.type === 'petty_cash');
                        if (cajaProject) {
                            navigate(`/admin/projects/${cajaProject.id}`);
                        } else {
                            navigate('/admin/balances');
                        }
                    }} 
                    className="text-xs font-bold text-white bg-teal-600 px-3 py-1.5 rounded hover:bg-teal-700 transition"
                >
                    RECARGAR / VER DETALLE
                </button>
            </div>



            <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100 flex flex-col justify-center">
                <h3 className="text-slate-500 text-sm font-semibold uppercase tracking-wide">Proyectos Activos</h3>
                <p className="text-3xl font-extrabold text-slate-800 mt-2">{projects.length}</p>
            </div>
            <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100 flex flex-col justify-center">
                <h3 className="text-slate-500 text-sm font-semibold uppercase tracking-wide">Total Asignado</h3>
                <p className="text-3xl font-extrabold text-slate-800 mt-2">{formatCurrency(totalAssigned)}</p>
            </div>
            <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100 flex flex-col justify-center">
                <h3 className="text-slate-500 text-sm font-semibold uppercase tracking-wide">Rendiciones Pendientes</h3>
                <p className="text-3xl font-extrabold text-orange-500 mt-2">{pendingCount}</p>
            </div>
        </div>

        <div className="mt-8">
            <h2 className="text-xl font-bold mb-4 text-gray-800">Resumen de Proyectos</h2>
            {projects.length === 0 ? (
                <p className="text-gray-500">No hay proyectos activos.</p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {projects.filter(p => !p.name.toLowerCase().includes('caja chica') && p.type !== 'petty_cash').map(p => {
                        const expenses = p.expenses || 0;
                        const assigned = p.assigned || 0;
                        const percentage = assigned > 0 ? (expenses / assigned) * 100 : 0;
                        
                        return (
                            <Link to={`/admin/projects/${p.id}`} key={p.id} className="block transition hover:scale-105 duration-200">
                            <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100 flex flex-col justify-between h-full hover:shadow-xl hover:-translate-y-1 transition duration-300">
                                <div>
                                    <h3 className="font-bold text-lg text-slate-800 mb-1 leading-tight">
                                        {p.code ? `[${p.code}] ` : ''}{p.name}{p.recurrence ? ` (${p.recurrence})` : ''}
                                    </h3>
                                    <p className="text-sm text-slate-500 mb-6 font-medium">{p.client}</p>
                                    
                                    <div className="flex justify-between items-end mb-3">
                                        <div>
                                            <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Asignado</p>
                                            <p className="text-lg font-bold text-slate-700">{formatCurrency(assigned)}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Rendido</p>
                                            <p className={`text-lg font-bold ${expenses > assigned ? 'text-red-500' : 'text-blue-600'}`}>
                                                {formatCurrency(expenses)}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-2">
                                    <div className="w-full bg-slate-100 rounded-full h-2 mb-2 overflow-hidden">
                                        <div 
                                            className={`h-2 rounded-full transition-all duration-1000 ${expenses > assigned ? 'bg-red-500' : 'bg-blue-500'}`} 
                                            style={{ width: `${Math.min(percentage, 100)}%` }}
                                        ></div>
                                    </div>
                                    <p className="text-xs text-right text-slate-400 font-medium">
                                        {percentage.toFixed(1)}% Ejecutado
                                    </p>
                                </div>
                            </div>
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    </Layout>
  );
}
