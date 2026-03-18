import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { db } from '../lib/firebase';
import { collection, getDocs, addDoc, query, where, doc, updateDoc, increment, serverTimestamp } from 'firebase/firestore';
import { formatCurrency } from '../utils/format';
import { Plus, DollarSign, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

import { sortProjects } from '../utils/sort';
import { toast } from 'sonner';
import SearchableSelect from '../components/SearchableSelect';

export default function AdminProjects() {
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false); // [NEW] Prevent double clicks

  // Form States
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [newProject, setNewProject] = useState({
    name: '',
    client: '',
    code: '',
    recurrence: '',
    contacto: { nombre: '', telefono: '', email: '', cargo: '' },
    recursos: { ingenieros: [], vehiculo: '', equipamiento: '' }
  });
  const [showContactoRecursos, setShowContactoRecursos] = useState(false);
  const [showIngenieroDropdown, setShowIngenieroDropdown] = useState(false);
  const [clients, setClients] = useState([]);
  
  const [viaticoUser, setViaticoUser] = useState('');
  const [viaticoProject, setViaticoProject] = useState('');
  const [viaticoAmount, setViaticoAmount] = useState('');
  
  const [projectSearch, setProjectSearch] = useState('');
  const [allocationSearch, setAllocationSearch] = useState('');

  const fetchData = async () => {
    try {
        setLoading(true);
        // data fetching logic
        const qProjects = query(collection(db, "projects"), where("status", "!=", "deleted"));
        const pSnap = await getDocs(qProjects);
        const pData = pSnap.docs.map(d => ({id: d.id, ...d.data()}));
        setProjects(sortProjects(pData));
        
        // Fetch ALL users (including admins/hidden) for internal use, or keep filtering?
        // We need 'user_caja_chica' if we want to manually assign?
        // Actually, for the SELECT, we only want professionals. 
        // Logic: If 'Caja Chica' project selected -> Auto-assign to hidden user. 
        const uQuery = query(collection(db, "users"), where("role", "in", ["professional", "admin"]));
        const uSnap = await getDocs(uQuery);
        const uData = uSnap.docs.map(d => ({id: d.id, ...d.data()}));
        setUsers(uData);

        // Fetch Clients for the dropdown
        const cSnap = await getDocs(collection(db, "clients"));
        const cData = cSnap.docs.map(d => ({
            id: d.id, 
            label: d.data().razonSocial || d.data().name || 'Sin Nombre',
            value: d.data().razonSocial || d.data().name || 'Sin Nombre',
            ...d.data()
        }));

        // Also extract existing unique clients from projects
        const existingClientsFromProjects = [...new Set(pData.map(p => p.client).filter(Boolean))];
        const uniqueValues = new Set(cData.map(c => c.value.toLowerCase()));
        
        existingClientsFromProjects.forEach(c => {
           if (!uniqueValues.has(c.toLowerCase())) {
               cData.push({ id: c, label: c, value: c });
               uniqueValues.add(c.toLowerCase());
           }
        });

        // Sort alphabetically
        cData.sort((a,b) => a.label.localeCompare(b.label));

        setClients(cData);
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
    if (!newProject.name) return;

    try {
        const projectRef = await addDoc(collection(db, "projects"), {
            name: newProject.name,
            code: newProject.code || '',
            recurrence: newProject.recurrence || '',
            isRecurrent: !!newProject.recurrence,
            client: newProject.client,
            expenses: 0,
            status: 'active',
            createdAt: new Date().toISOString(),
            contacto: {
                nombre: newProject.contacto.nombre || '',
                telefono: newProject.contacto.telefono || '',
                email: newProject.contacto.email || '',
                cargo: newProject.contacto.cargo || ''
            },
            recursos: {
                ingenieros: newProject.recursos.ingenieros || [],
                vehiculo: newProject.recursos.vehiculo || '',
                equipamiento: newProject.recursos.equipamiento || ''
            }
        });

        // Register in Bitacora
        await addDoc(collection(db, "projects", projectRef.id, "logs"), {
            type: 'status_change',
            content: `Proyecto creado: ${newProject.name}`,
            userName: 'Admin',
            userRole: 'admin',
            timestamp: serverTimestamp()
        });

        toast.success("Proyecto creado exitosamente");
        setNewProject({ name: '', client: '', code: '', recurrence: '', contacto: { nombre: '', telefono: '', email: '', cargo: '' }, recursos: { ingenieros: [], vehiculo: '', equipamiento: '' } });
        setShowContactoRecursos(false);
        setShowIngenieroDropdown(false);
        setShowProjectForm(false);
        fetchData();
    } catch (err) {
        console.error(err);
        toast.error("Error al crear proyecto");
    }
  };

  const handleDeleteProject = async (projectId) => {
      const pin = prompt("Ingrese clave maestra para ELIMINAR este proyecto:");
      if (pin !== "1234") {
          alert("Clave incorrecta.");
          return;
      }

      if (!confirm("El proyecto se ocultará pero los datos se conservan. ¿Confirmar?")) return;

      try {
          await updateDoc(doc(db, "projects", projectId), {
              status: 'deleted'
          });

          // Register in Project Bitacora
          await addDoc(collection(db, "projects", projectId, "logs"), {
              type: 'status_change',
              content: `Proyecto marcado como ELIMINADO`,
              userName: 'Admin',
              userRole: 'admin',
              timestamp: serverTimestamp()
          });

          // 2. Register in Global Audit Logs
          await addDoc(collection(db, "audit_logs"), {
              type: 'project_deletion',
              entityId: projectId,
              entityName: projects.find(p => p.id === projectId)?.name || 'Unknown',
              adminName: 'Admin',
              details: {
                  status: 'deleted',
                  timestamp: new Date().toISOString()
              },
              createdAt: serverTimestamp()
          });

          alert("Proyecto eliminado.");
          fetchData();
      } catch (e) {
          console.error(e);
          alert("Error al eliminar.");
      }
  };

  const handleAssignViatico = async (e) => {
      e.preventDefault();
      if (!viaticoUser || !viaticoAmount || !viaticoProject) return;
      if (submitting) return; // Prevent double submission

      setSubmitting(true);
      try {
          const amount = Number(viaticoAmount);
          const project = projects.find(p => p.id === viaticoProject);
          
          let targetUserId = viaticoUser;
          let targetUserName = '';

              const user = users.find(u => u.id === viaticoUser);
              if (!user) { toast.error("Usuario no encontrado"); return; }
              targetUserName = user.displayName;

          if (!targetUserId) return;

          // 1. Update User Balance
          const userRef = doc(db, "users", targetUserId);
          
          await updateDoc(userRef, {
              balance: increment(-amount)
          });

          // 2. Create Allocation Record
          await addDoc(collection(db, "allocations"), {
              userId: targetUserId,
              userName: targetUserName || 'Unknown',
              projectId: viaticoProject,
              projectName: project?.name || 'Unknown',
              amount: amount,
              date: new Date().toISOString(),
              createdAt: new Date().toISOString()
          });

          // 3. Register in Project Bitacora
          await addDoc(collection(db, "projects", viaticoProject, "logs"), {
              type: 'status_change',
              content: `Asignación de viático por ${formatCurrency(amount)} a ${targetUserName}`,
              userName: 'Admin', // o currentUser?.displayName si se pasara currentUser a este componente
              userRole: 'admin',
              timestamp: serverTimestamp()
          });

          toast.success("Viático asignado exitosamente");
          setViaticoAmount('');
          setViaticoUser('');
          setViaticoProject('');
          fetchData(); 
      } catch (err) {
          console.error(err);
          toast.error("Error asignando viático");
      } finally {
          setSubmitting(false);
      }
  };
  
  const formatProjectName = (p) => {
      let parts = [];
      if (p.code) parts.push(`[${p.code}]`);
      if (p.recurrence) parts.push(`(${p.recurrence})`);
      parts.push(p.name);
      return parts.join(' ');
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
                            <label className="block text-sm font-medium text-gray-700">Código de Proyecto</label>
                            <input 
                                type="text" 
                                className="mt-1 w-full p-2 border rounded"
                                value={newProject.code}
                                onChange={e => setNewProject({...newProject, code: e.target.value})}
                                placeholder="Ej: PRJ-001"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Recurrencia</label>
                            <input 
                                type="text" 
                                className="mt-1 w-full p-2 border rounded"
                                value={newProject.recurrence}
                                onChange={e => setNewProject({...newProject, recurrence: e.target.value})}
                                placeholder="Ej: A, B, C..."
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Cliente</label>
                            <SearchableSelect 
                                options={clients}
                                value={newProject.client}
                                onChange={(val) => setNewProject({...newProject, client: val})}
                                placeholder="Seleccionar cliente..."
                            />
                        </div>

                        {/* Contacto y Recursos - Collapsible */}
                        <div className="border border-gray-200 rounded-lg overflow-hidden">
                            <button
                                type="button"
                                onClick={() => setShowContactoRecursos(!showContactoRecursos)}
                                className="w-full flex justify-between items-center px-4 py-3 bg-gray-50 hover:bg-gray-100 text-sm font-semibold text-gray-700 transition-colors"
                            >
                                <span>Contacto y Recursos</span>
                                {showContactoRecursos ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                            {showContactoRecursos && (
                                <div className="px-4 py-4 space-y-4">
                                    {/* Subsección A: Contacto del cliente */}
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contacto del cliente</p>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Nombre de contacto</label>
                                        <input
                                            type="text"
                                            className="mt-1 w-full p-2 border rounded"
                                            value={newProject.contacto.nombre}
                                            onChange={e => setNewProject({...newProject, contacto: {...newProject.contacto, nombre: e.target.value}})}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Teléfono / WhatsApp</label>
                                        <input
                                            type="tel"
                                            className="mt-1 w-full p-2 border rounded"
                                            value={newProject.contacto.telefono}
                                            onChange={e => setNewProject({...newProject, contacto: {...newProject.contacto, telefono: e.target.value}})}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Email de contacto</label>
                                        <input
                                            type="email"
                                            className="mt-1 w-full p-2 border rounded"
                                            value={newProject.contacto.email}
                                            onChange={e => setNewProject({...newProject, contacto: {...newProject.contacto, email: e.target.value}})}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Cargo / Rol</label>
                                        <input
                                            type="text"
                                            className="mt-1 w-full p-2 border rounded"
                                            value={newProject.contacto.cargo}
                                            onChange={e => setNewProject({...newProject, contacto: {...newProject.contacto, cargo: e.target.value}})}
                                        />
                                    </div>

                                    {/* Subsección B: Recursos asignados */}
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-2">Recursos asignados</p>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Ingenieros asignados</label>
                                        <div className="relative">
                                            <button
                                                type="button"
                                                onClick={() => setShowIngenieroDropdown(!showIngenieroDropdown)}
                                                className="w-full p-2 border rounded text-left text-sm flex justify-between items-center bg-white"
                                            >
                                                <span className="text-gray-600">
                                                    {newProject.recursos.ingenieros.length === 0
                                                        ? 'Seleccionar ingenieros...'
                                                        : `${newProject.recursos.ingenieros.length} seleccionado(s)`}
                                                </span>
                                                {showIngenieroDropdown ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                                            </button>
                                            {showIngenieroDropdown && (
                                                <div className="absolute z-10 w-full bg-white border border-gray-200 rounded shadow-lg mt-1 max-h-40 overflow-y-auto">
                                                    {users.filter(u => u.role === 'professional').map(u => (
                                                        <label key={u.id} className="flex items-center px-3 py-2 hover:bg-gray-50 cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                className="mr-2"
                                                                checked={newProject.recursos.ingenieros.includes(u.id)}
                                                                onChange={(e) => {
                                                                    const updated = e.target.checked
                                                                        ? [...newProject.recursos.ingenieros, u.id]
                                                                        : newProject.recursos.ingenieros.filter(uid => uid !== u.id);
                                                                    setNewProject({...newProject, recursos: {...newProject.recursos, ingenieros: updated}});
                                                                }}
                                                            />
                                                            <span className="text-sm text-gray-700">{u.displayName}</span>
                                                        </label>
                                                    ))}
                                                    {users.filter(u => u.role === 'professional').length === 0 && (
                                                        <p className="px-3 py-2 text-sm text-gray-400">No hay profesionales disponibles.</p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Vehículo</label>
                                        <input
                                            type="text"
                                            className="mt-1 w-full p-2 border rounded"
                                            value={newProject.recursos.vehiculo}
                                            onChange={e => setNewProject({...newProject, recursos: {...newProject.recursos, vehiculo: e.target.value}})}
                                            placeholder="Ej: Auto arrendado KIA - Patente XY1234"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Equipamiento</label>
                                        <input
                                            type="text"
                                            className="mt-1 w-full p-2 border rounded"
                                            value={newProject.recursos.equipamiento}
                                            onChange={e => setNewProject({...newProject, recursos: {...newProject.recursos, equipamiento: e.target.value}})}
                                            placeholder="Ej: SLM5253 + KIA + GRM"
                                        />
                                    </div>
                                </div>
                            )}
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
                        <input 
                            type="text"
                            placeholder="Buscar proyecto..."
                            className="mt-1 w-full p-2 border rounded text-xs mb-2"
                            value={allocationSearch}
                            onChange={e => setAllocationSearch(e.target.value)}
                        />
                        <select 
                            className="mt-1 w-full p-2 border rounded"
                            value={viaticoProject}
                            onChange={e => setViaticoProject(e.target.value)}
                            required
                        >
                            <option value="">Seleccionar Proyecto...</option>
                            {projects.filter(p => {
                                if (!allocationSearch) return true;
                                const term = allocationSearch.toLowerCase();
                                return (p.name.toLowerCase().includes(term) || (p.code && p.code.toLowerCase().includes(term)));
                            }).map(p => (
                                <option key={p.id} value={p.id}>
                                    {formatProjectName(p)}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Show Professional Select ONLY if NOT Caja Chica */}
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
                                    {u.displayName} (Saldo: {formatCurrency(u.balance || 0)})
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
                    <button 
                        type="submit" 
                        disabled={submitting}
                        className={`w-full bg-green-600 text-white py-2 rounded hover:bg-green-700 ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {submitting ? 'Cargando...' : 'Cargar Saldo'}
                    </button>
                </form>
            </div>
        </div>

        {/* Projects List */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b bg-gray-50 flex flex-col md:flex-row justify-between items-center gap-4">
                <h3 className="font-bold text-gray-700">Listado de Proyectos</h3>
                <input 
                    type="text"
                    placeholder="Buscar por nombre, código o cliente..."
                    className="px-4 py-2 border rounded-lg text-sm w-full md:w-64 focus:ring-2 focus:ring-blue-500 outline-none"
                    value={projectSearch}
                    onChange={e => setProjectSearch(e.target.value)}
                />
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead>
                        <tr className="bg-gray-50 border-b">
                            <th className="px-6 py-3 font-medium text-gray-500">Proyecto</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Cliente</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Gastado</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Estado</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(() => {
                            // Filter Logic
                            const filtered = projects.filter(p => {
                                if (!projectSearch) return true;
                                const lower = projectSearch.toLowerCase();
                                return (
                                    p.name.toLowerCase().includes(lower) ||
                                    (p.code && p.code.toLowerCase().includes(lower)) ||
                                    (p.client && p.client.toLowerCase().includes(lower))
                                );
                            });

                            const cajaChica = filtered.find(p => p.type === 'petty_cash' || p.name.toLowerCase().includes('caja chica'));
                            const otherProjects = filtered.filter(p => p !== cajaChica);

                            return (
                                <>
                                    {cajaChica && (
                                        <tr key={cajaChica.id} className="border-b bg-amber-50 hover:bg-amber-100/50 border-l-4 border-l-amber-400">
                                            <td className="px-6 py-4 font-medium">
                                                <Link to={`/admin/projects/${cajaChica.id}`} className="text-amber-800 hover:text-amber-900 hover:underline font-bold flex items-center">
                                                    {formatProjectName(cajaChica)}
                                                    <span className="ml-2 px-2 py-0.5 bg-amber-200 text-amber-800 text-[10px] uppercase rounded-full">Especial</span>
                                                </Link>
                                            </td>
                                            <td className="px-6 py-4 text-amber-800 font-medium">{cajaChica.client}</td>
                                            <td className="px-6 py-4 text-amber-800 font-mono font-bold">{formatCurrency(cajaChica.expenses || 0)}</td>
                                            <td className="px-6 py-4"><span className="bg-amber-100 text-amber-800 px-2 py-1 rounded-full text-xs font-semibold">Fondo Fijo</span></td>
                                            <td className="px-6 py-4">
                                                 {/* Prevent deletion of Caja Chica easily */}
                                                 <span className="text-xs text-gray-400 italic">Sistema</span>
                                            </td>
                                        </tr>
                                    )}

                                    {otherProjects.map(p => (
                                        <tr key={p.id} className="border-b last:border-0 hover:bg-slate-50 transition-colors group">
                                            <td className="px-6 py-4 font-medium">
                                                <Link to={`/admin/projects/${p.id}`} className="text-blue-600 hover:text-blue-800 hover:underline">
                                                    {formatProjectName(p)}
                                                </Link>
                                            </td>
                                            <td className="px-6 py-4 text-gray-600">{p.client}</td>
                                            <td className="px-6 py-4">{formatCurrency(p.expenses || 0)}</td>
                                            <td className="px-6 py-4"><span className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs font-semibold">Activo</span></td>
                                            <td className="px-6 py-4">
                                                <button 
                                                    onClick={() => handleDeleteProject(p.id)}
                                                    className="text-red-500 hover:text-red-700 p-1"
                                                    title="Eliminar Proyecto"
                                                >
                                                    <Trash2 className="w-5 h-5" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </>
                            );
                        })()}
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
