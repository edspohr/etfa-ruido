import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { db } from '../lib/firebase';
import { collection, getDocs, addDoc, query, where, doc, updateDoc, increment } from 'firebase/firestore';
import { formatCurrency } from '../lib/mockData';
import { Plus, DollarSign } from 'lucide-react';

export default function AdminProjects() {
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Form States
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [newProject, setNewProject] = useState({ name: '', client: '', budget: '' });
  
  const [viaticoUser, setViaticoUser] = useState('');
  const [viaticoProject, setViaticoProject] = useState('');
  const [viaticoAmount, setViaticoAmount] = useState('');

  const fetchData = async () => {
    try {
        setLoading(true);
        // data fetching logic
        const pSnap = await getDocs(collection(db, "projects"));
        const pData = pSnap.docs.map(d => ({id: d.id, ...d.data()}));
        setProjects(pData);

        const uQuery = query(collection(db, "users"), where("role", "==", "professional"));
        const uSnap = await getDocs(uQuery);
        const uData = uSnap.docs.map(d => ({id: d.id, ...d.data()}));
        setUsers(uData);
    } catch (e) {
        console.error("Error fetching admin data:", e);
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateProject = async (e) => {
    e.preventDefault();
    if (!newProject.name || !newProject.budget) return;

    try {
        await addDoc(collection(db, "projects"), {
            name: newProject.name,
            client: newProject.client,
            budget: Number(newProject.budget),
            expenses: 0,
            status: 'active',
            createdAt: new Date().toISOString()
        });
        alert("Proyecto creado exitosamente");
        setNewProject({ name: '', client: '', budget: '' });
        setShowProjectForm(false);
        fetchData();
    } catch (err) {
        console.error(err);
        alert("Error al crear proyecto");
    }
  };

  const handleAssignViatico = async (e) => {
      e.preventDefault();
      if (!viaticoUser || !viaticoAmount || !viaticoProject) return;

      try {
          const amount = Number(viaticoAmount);
          const user = users.find(u => u.id === viaticoUser);
          const project = projects.find(p => p.id === viaticoProject);

          // 1. Update User Balance
          const userRef = doc(db, "users", viaticoUser);
          await updateDoc(userRef, {
              balance: increment(amount)
          });

          // 2. Create Allocation Record
          await addDoc(collection(db, "allocations"), {
              userId: viaticoUser,
              userName: user?.displayName || 'Unknown',
              projectId: viaticoProject,
              projectName: project?.name || 'Unknown',
              amount: amount,
              date: new Date().toISOString(),
              createdAt: new Date().toISOString()
          });

          alert("Viático asignado exitosamente");
          setViaticoAmount('');
          setViaticoUser('');
          setViaticoProject('');
          fetchData(); 
      } catch (err) {
          console.error(err);
          alert("Error asignando viático");
      }
  };

  if (loading) return <Layout title="Gestión de Proyectos">Cargando...</Layout>;

  return (
    <Layout title="Gestión de Proyectos y Viáticos">
        {/* Actions Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
            
            {/* Create Project Section */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-gray-800">Crear Nuevo Proyecto</h2>
                    <button 
                        onClick={() => setShowProjectForm(!showProjectForm)}
                        className="text-blue-600 hover:text-blue-800"
                    >
                        {showProjectForm ? 'Cancelar' : <Plus className="w-5 h-5"/>}
                    </button>
                </div>
                
                {showProjectForm && (
                    <form onSubmit={handleCreateProject} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Nombre del Proyecto</label>
                            <input 
                                type="text" 
                                className="mt-1 w-full p-2 border rounded"
                                value={newProject.name}
                                onChange={e => setNewProject({...newProject, name: e.target.value})}
                                required 
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Cliente</label>
                            <input 
                                type="text" 
                                className="mt-1 w-full p-2 border rounded"
                                value={newProject.client}
                                onChange={e => setNewProject({...newProject, client: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Presupuesto ($)</label>
                            <input 
                                type="number" 
                                className="mt-1 w-full p-2 border rounded"
                                value={newProject.budget}
                                onChange={e => setNewProject({...newProject, budget: e.target.value})}
                                required 
                            />
                        </div>
                        <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700">
                            Guardar Proyecto
                        </button>
                    </form>
                )}
                {!showProjectForm && <p className="text-gray-500 text-sm">Haz clic en el icono + para desplegar el formulario.</p>}
            </div>

            {/* Assign Viatico Section */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                <div className="flex items-center mb-4 text-green-700">
                    <DollarSign className="w-5 h-5 mr-2" />
                    <h2 className="text-lg font-bold">Asignar Viático (Saldo)</h2>
                </div>
                <form onSubmit={handleAssignViatico} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Proyecto</label>
                        <select 
                            className="mt-1 w-full p-2 border rounded"
                            value={viaticoProject}
                            onChange={e => setViaticoProject(e.target.value)}
                            required
                        >
                            <option value="">Seleccionar Proyecto...</option>
                            {projects.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Profesional</label>
                        <select 
                            className="mt-1 w-full p-2 border rounded"
                            value={viaticoUser}
                            onChange={e => setViaticoUser(e.target.value)}
                            required
                        >
                            <option value="">Seleccionar Profesional...</option>
                            {users.map(u => (
                                <option key={u.id} value={u.id}>
                                    {u.displayName} (Saldo actual: {formatCurrency(u.balance || 0)})
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Monto a Cargar ($)</label>
                        <input 
                            type="number" 
                            className="mt-1 w-full p-2 border rounded"
                            value={viaticoAmount}
                            onChange={e => setViaticoAmount(e.target.value)}
                            required 
                        />
                    </div>
                    <button type="submit" className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700">
                        Cargar Saldo
                    </button>
                </form>
            </div>
        </div>

        {/* Projects List */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b bg-gray-50">
                <h3 className="font-bold text-gray-700">Listado de Proyectos</h3>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead>
                        <tr className="bg-gray-50 border-b">
                            <th className="px-6 py-3 font-medium text-gray-500">Proyecto</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Cliente</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Presupuesto</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Gastado</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Estado</th>
                        </tr>
                    </thead>
                    <tbody>
                        {projects.map(p => (
                            <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50">
                                <td className="px-6 py-4 font-medium">{p.name}</td>
                                <td className="px-6 py-4 text-gray-600">{p.client}</td>
                                <td className="px-6 py-4">{formatCurrency(p.budget)}</td>
                                <td className="px-6 py-4">{formatCurrency(p.expenses || 0)}</td>
                                <td className="px-6 py-4"><span className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs font-semibold">Activo</span></td>
                            </tr>
                        ))}
                        {projects.length === 0 && (
                            <tr>
                                <td colSpan="5" className="px-6 py-8 text-center text-gray-500">No hay proyectos registrados.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    </Layout>
  );
}
