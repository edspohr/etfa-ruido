import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { db } from '../lib/firebase';
import { collection, getDocs, addDoc, query, where, doc, updateDoc, increment, serverTimestamp, writeBatch, deleteDoc } from 'firebase/firestore';
import { formatCurrency, formatProjectLabel } from '../utils/format';
import { Plus, DollarSign, Trash2, ChevronDown, Pencil, GitMerge, AlertTriangle } from 'lucide-react';

import { sortProjects } from '../utils/sort';
import { isSystemUser } from '../utils/userUtils';
import { toast } from 'sonner';
import SearchableSelect from '../components/SearchableSelect';

const EMPTY_FORM = {
  name: '', code: '', recurrence: '', client: '',
  contactName: '', contactPhone: '', contactEmail: '', contactPosition: '',
  engineers: [], vehicle: '', equipment: '',
};

export default function AdminProjects() {
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [viaticoUser, setViaticoUser] = useState('');
  const [viaticoProject, setViaticoProject] = useState('');
  const [viaticoAmount, setViaticoAmount] = useState('');

  const [projectSearch, setProjectSearch] = useState('');
  const [allocationSearch, setAllocationSearch] = useState('');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [saving, setSaving] = useState(false);
  const [clients, setClients] = useState([]);
  const [engineersList, setEngineersList] = useState([]);
  const [showEngDropdown, setShowEngDropdown] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_FORM);

  // Detección/consolidación de proyectos duplicados (H6 — bug $5.569).
  const [dupModalOpen, setDupModalOpen] = useState(false);
  const [dupCanonicalByGroup, setDupCanonicalByGroup] = useState({});
  const [dupCounts, setDupCounts] = useState({}); // { projectId: {allocations, expenses, invoices, tasks, events, reports} }
  const [dupLoadingCounts, setDupLoadingCounts] = useState(false);
  const [dupConsolidatingKey, setDupConsolidatingKey] = useState(null);
  const [dupConfirmGroup, setDupConfirmGroup] = useState(null); // groupKey pendiente de confirmar

  const isEditing = Boolean(editingProject);

  const fetchData = async () => {
    try {
      setLoading(true);
      const qProjects = query(collection(db, 'projects'), where('status', '!=', 'deleted'));
      const pSnap = await getDocs(qProjects);
      const pData = pSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setProjects(sortProjects(pData));

      const uQuery = query(collection(db, 'users'), where('role', 'in', ['professional', 'admin']));
      const uSnap = await getDocs(uQuery);
      const uData = uSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => !isSystemUser(u));
      setUsers(uData);

      const [clientsSnap, projectsSnap] = await Promise.all([
        getDocs(collection(db, 'clients')),
        getDocs(collection(db, 'projects')),
      ]);
      const registeredClients = clientsSnap.docs.map(d => ({
        value: d.data().razonSocial || d.id,
        label: d.data().razonSocial || 'Sin nombre',
      }));
      const projectClients = [...new Set(projectsSnap.docs.map(d => d.data().client).filter(Boolean))].map(name => ({
        value: name, label: name,
      }));
      const combined = [...registeredClients, ...projectClients];
      const uniqueMap = new Map();
      combined.forEach(c => {
        const key = c.value.toLowerCase().trim();
        if (!uniqueMap.has(key)) uniqueMap.set(key, c);
      });
      setClients(Array.from(uniqueMap.values()).sort((a, b) => a.label.localeCompare(b.label)));
      setEngineersList(uData.map(d => ({ id: d.id, displayName: d.displayName || d.email || 'Usuario' })));
    } catch (e) {
      console.error('Error fetching admin data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleDeleteProject = async (projectId) => {
    const pin = prompt('Ingrese clave maestra para ELIMINAR este proyecto:');
    if (pin !== '1234') { alert('Clave incorrecta.'); return; }
    if (!confirm('El proyecto se ocultará pero los datos se conservan. ¿Confirmar?')) return;
    try {
      await updateDoc(doc(db, 'projects', projectId), { status: 'deleted' });
      await addDoc(collection(db, 'projects', projectId, 'logs'), {
        type: 'status_change',
        content: 'Proyecto marcado como ELIMINADO',
        userName: 'Admin',
        userRole: 'admin',
        timestamp: serverTimestamp(),
      });
      await addDoc(collection(db, 'audit_logs'), {
        type: 'project_deletion',
        entityId: projectId,
        entityName: projects.find(p => p.id === projectId)?.name || 'Unknown',
        adminName: 'Admin',
        details: { status: 'deleted', timestamp: new Date().toISOString() },
        createdAt: serverTimestamp(),
      });
      alert('Proyecto eliminado.');
      fetchData();
    } catch (e) {
      console.error(e);
      alert('Error al eliminar.');
    }
  };

  // ---------------------------------------------------------------------------
  // Detección y consolidación de proyectos duplicados (H6)
  // ---------------------------------------------------------------------------

  const normalizeName = (s) => String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');

  // Agrupa proyectos por nombre normalizado (o código si existe). Solo devuelve
  // grupos con más de un proyecto — esos son los candidatos a consolidar.
  const duplicateGroups = (() => {
    if (!dupModalOpen) return [];
    const byKey = new Map();
    projects.forEach(p => {
      const nameKey = normalizeName(p.name);
      if (!nameKey) return;
      // Preferimos agrupar por (nombre + recurrencia) para no unir "ETF-001 A"
      // con "ETF-001 B" que son proyectos distintos.
      const key = `name::${nameKey}::${(p.recurrence || '').trim().toLowerCase()}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(p);
    });
    // Además: si dos proyectos comparten código idéntico (y recurrencia), agruparlos.
    projects.forEach(p => {
      const codeKey = (p.code || '').trim().toLowerCase();
      if (!codeKey) return;
      const key = `code::${codeKey}::${(p.recurrence || '').trim().toLowerCase()}`;
      if (!byKey.has(key)) byKey.set(key, []);
      const arr = byKey.get(key);
      if (!arr.find(x => x.id === p.id)) arr.push(p);
    });
    return Array.from(byKey.entries())
      .filter(([, arr]) => arr.length > 1)
      .map(([key, arr]) => ({ key, projects: arr }));
  })();

  const openDuplicatesModal = async () => {
    setDupModalOpen(true);
    setDupCanonicalByGroup({});
    setDupCounts({});
    setDupLoadingCounts(true);
    try {
      // Contamos referencias en cada colección para todos los proyectos involucrados
      // en los grupos duplicados. Un solo pase por colección: filtramos en memoria.
      const projectIds = new Set();
      // Recomputamos duplicateGroups a partir de projects (dupModalOpen aún no fue leído).
      const byKey = new Map();
      projects.forEach(p => {
        const nameKey = normalizeName(p.name);
        if (!nameKey) return;
        const key = `name::${nameKey}::${(p.recurrence || '').trim().toLowerCase()}`;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(p);
      });
      byKey.forEach((arr) => {
        if (arr.length > 1) arr.forEach(p => projectIds.add(p.id));
      });

      if (projectIds.size === 0) {
        setDupLoadingCounts(false);
        return;
      }

      const counts = {};
      projectIds.forEach(pid => {
        counts[pid] = { allocations: 0, expenses: 0, invoices: 0, tasks: 0, calendar_events: 0, reports: 0 };
      });

      const countCollection = async (name) => {
        const snap = await getDocs(collection(db, name));
        snap.docs.forEach(d => {
          const pid = d.data().projectId;
          if (pid && counts[pid]) counts[pid][name] += 1;
        });
      };

      await Promise.all([
        countCollection('allocations'),
        countCollection('expenses'),
        countCollection('invoices'),
        countCollection('tasks'),
        countCollection('calendar_events'),
        countCollection('reports'),
      ]);

      setDupCounts(counts);
    } catch (err) {
      console.error('Error contando referencias:', err);
      toast.error('Error al detectar duplicados.');
    } finally {
      setDupLoadingCounts(false);
    }
  };

  const consolidateGroup = async (groupKey, group) => {
    const canonicalId = dupCanonicalByGroup[groupKey];
    if (!canonicalId) {
      toast.error('Elige el proyecto canónico primero.');
      return;
    }
    const canonical = group.projects.find(p => p.id === canonicalId);
    const duplicates = group.projects.filter(p => p.id !== canonicalId);
    if (!canonical || duplicates.length === 0) return;

    setDupConsolidatingKey(groupKey);
    try {
      const REFERENCED_COLLECTIONS = ['allocations', 'expenses', 'invoices', 'tasks', 'calendar_events', 'reports'];
      const dupIds = duplicates.map(d => d.id);

      // Traemos todos los documentos referenciando cualquiera de los proyectos duplicados
      // (una lectura por colección; filtramos en cliente para no requerir índices).
      const perCollectionDocs = {};
      for (const name of REFERENCED_COLLECTIONS) {
        const snap = await getDocs(collection(db, name));
        perCollectionDocs[name] = snap.docs.filter(d => dupIds.includes(d.data().projectId));
      }

      const totals = { allocations: 0, expenses: 0, invoices: 0, tasks: 0, calendar_events: 0, reports: 0 };

      // Actualizaciones en batches de 400 (patrón usado por handleWipeInvoices).
      const chunk = (arr, size) => {
        const out = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
      };

      for (const name of REFERENCED_COLLECTIONS) {
        const docs = perCollectionDocs[name];
        totals[name] = docs.length;
        for (const docs400 of chunk(docs, 400)) {
          const b = writeBatch(db);
          docs400.forEach(d => {
            const payload = { projectId: canonical.id };
            if (canonical.name) payload.projectName = canonical.name;
            if (canonical.code !== undefined) payload.projectCode = canonical.code || '';
            if (canonical.recurrence !== undefined) payload.projectRecurrence = canonical.recurrence || '';
            b.update(d.ref, payload);
          });
          await b.commit();
        }
      }

      // Log consolidado en la bitácora del proyecto canónico.
      const dupSummary = duplicates.map(d => `${d.name}${d.code ? ` [${d.code}]` : ''} (${d.id})`).join(', ');
      await addDoc(collection(db, 'projects', canonical.id, 'logs'), {
        type: 'status_change',
        content: `Consolidación de proyectos duplicados. Absorbidos: ${dupSummary}. ` +
          `Reasignados → asignaciones: ${totals.allocations}, gastos: ${totals.expenses}, facturas: ${totals.invoices}, ` +
          `tareas: ${totals.tasks}, eventos: ${totals.calendar_events}, informes: ${totals.reports}.`,
        userName: 'Admin',
        userRole: 'admin',
        timestamp: serverTimestamp(),
      });

      // Log global de auditoría.
      await addDoc(collection(db, 'audit_logs'), {
        type: 'project_merge',
        entityId: canonical.id,
        entityName: canonical.name,
        adminName: 'Admin',
        details: {
          canonical: { id: canonical.id, name: canonical.name, code: canonical.code || '' },
          duplicates: duplicates.map(d => ({ id: d.id, name: d.name, code: d.code || '' })),
          moved: totals,
        },
        createdAt: serverTimestamp(),
      });

      // Eliminación de los duplicados solo después de que todos los reassignments commiteen.
      for (const dupProject of duplicates) {
        await deleteDoc(doc(db, 'projects', dupProject.id));
      }

      toast.success(
        `Consolidado: ${totals.allocations} asignaciones, ${totals.expenses} gastos, ${totals.invoices} facturas movidas. ` +
        `Proyecto duplicado eliminado.`
      );
      setDupConfirmGroup(null);
      // Refrescamos data y recontamos.
      await fetchData();
      // Después de fetchData el grupo puede desaparecer; cerramos si ya no hay duplicados.
      openDuplicatesModal();
    } catch (err) {
      console.error('Error consolidando proyectos:', err);
      toast.error('Error al consolidar. Revisa la consola.');
    } finally {
      setDupConsolidatingKey(null);
    }
  };

  const handleAssignViatico = async (e) => {
    e.preventDefault();
    if (!viaticoUser || !viaticoAmount || !viaticoProject) return;
    if (submitting) return;
    setSubmitting(true);
    try {
      const amount = Number(viaticoAmount);
      const project = projects.find(p => p.id === viaticoProject);
      const user = users.find(u => u.id === viaticoUser);
      if (!user) { toast.error('Usuario no encontrado'); return; }
      const targetUserId = user.id;
      const targetUserName = user.displayName;

      await updateDoc(doc(db, 'users', targetUserId), { balance: increment(-amount) });
      await addDoc(collection(db, 'allocations'), {
        userId: targetUserId,
        userName: targetUserName || 'Unknown',
        projectId: viaticoProject,
        projectName: project?.name || 'Unknown',
        amount,
        date: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
      await addDoc(collection(db, 'projects', viaticoProject, 'logs'), {
        type: 'status_change',
        content: `Asignación de viático por ${formatCurrency(amount)} a ${targetUserName}`,
        userName: 'Admin',
        userRole: 'admin',
        timestamp: serverTimestamp(),
      });
      toast.success('Viático asignado exitosamente');
      setViaticoAmount('');
      setViaticoUser('');
      setViaticoProject('');
      fetchData();
    } catch (err) {
      console.error(err);
      toast.error('Error asignando viático');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveProject = async (e) => {
    e.preventDefault();
    if (!createForm.name.trim()) { toast.error('El nombre del proyecto es obligatorio.'); return; }
    if (!createForm.code.trim()) { toast.error('El código del proyecto es obligatorio.'); return; }
    const trimmedCode = createForm.code.trim();
    const trimmedRecurrence = createForm.recurrence.trim();
    setSaving(true);
    try {
      // Duplicate check: same code + recurrence combination (exclude current project when editing)
      const dupQ = query(collection(db, 'projects'), where('code', '==', trimmedCode));
      const dupSnap = await getDocs(dupQ);
      const dupExists = dupSnap.docs.some(d =>
        d.id !== (editingProject?.id || '') &&
        (d.data().recurrence || '') === trimmedRecurrence
      );
      if (dupExists) {
        toast.error('Ya existe un proyecto con ese código y recurrencia.');
        setSaving(false);
        return;
      }

      const payload = {
        name: createForm.name.trim(),
        code: trimmedCode,
        recurrence: trimmedRecurrence,
        client: createForm.client,
        contacto: {
          nombre: createForm.contactName.trim(),
          telefono: createForm.contactPhone.trim(),
          email: createForm.contactEmail.trim(),
          cargo: createForm.contactPosition.trim(),
        },
        recursos: {
          ingenieros: createForm.engineers,
          vehiculo: createForm.vehicle.trim(),
          equipamiento: createForm.equipment.trim(),
        },
      };

      if (isEditing) {
        await updateDoc(doc(db, 'projects', editingProject.id), payload);
        toast.success('Proyecto actualizado.');
      } else {
        await addDoc(collection(db, 'projects'), {
          ...payload,
          status: 'active',
          billingStatus: 'pending',
          expenses: 0,
          createdAt: serverTimestamp(),
        });
        toast.success('Proyecto creado exitosamente.');
      }

      setShowCreateModal(false);
      setEditingProject(null);
      setCreateForm(EMPTY_FORM);
      fetchData();
    } catch (err) {
      console.error(err);
      toast.error('Error al guardar el proyecto.');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (project) => {
    setEditingProject(project);
    setCreateForm({
      name: project.name || '',
      code: project.code || '',
      recurrence: project.recurrence || '',
      client: project.client || '',
      contactName: project.contacto?.nombre || project.contactName || '',
      contactPhone: project.contacto?.telefono || project.contactPhone || '',
      contactEmail: project.contacto?.email || project.contactEmail || '',
      contactPosition: project.contacto?.cargo || project.contactPosition || '',
      engineers: project.recursos?.ingenieros || project.engineers || [],
      vehicle: project.recursos?.vehiculo || project.vehicle || '',
      equipment: project.recursos?.equipamiento || project.equipment || '',
    });
    setShowCreateModal(true);
  };

  const closeModal = () => {
    setShowCreateModal(false);
    setEditingProject(null);
    setCreateForm(EMPTY_FORM);
    setShowEngDropdown(false);
  };

  const toggleCreateEngineer = (uid) => {
    setCreateForm(prev => ({
      ...prev,
      engineers: prev.engineers.includes(uid)
        ? prev.engineers.filter(id => id !== uid)
        : [...prev.engineers, uid],
    }));
  };

  if (loading) return <Layout title="Gestión de Proyectos">Cargando...</Layout>;

  return (
    <Layout title="Gestión de Proyectos y Viáticos">
      {/* Actions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        {/* Create Project */}
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold text-gray-800 mb-4">Crear Nuevo Proyecto</h2>
          <p className="text-gray-500 text-sm mb-4">
            Crea un proyecto con información básica y completa los detalles de recursos y contacto después.
          </p>
          <button
            onClick={() => { setEditingProject(null); setCreateForm(EMPTY_FORM); setShowCreateModal(true); }}
            className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Crear Nuevo Proyecto
          </button>
        </div>

        {/* Assign Viatico */}
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
                  return p.name.toLowerCase().includes(term) || (p.code && p.code.toLowerCase().includes(term));
                }).map(p => (
                  <option key={p.id} value={p.id}>{formatProjectLabel(p)}</option>
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
                  <option key={u.id} value={u.id}>{u.displayName} (Saldo: {formatCurrency(u.balance || 0)})</option>
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
          <div className="flex items-center gap-2 w-full md:w-auto">
            <input
              type="text"
              placeholder="Buscar por nombre, código o cliente..."
              className="px-4 py-2 border rounded-lg text-sm w-full md:w-64 focus:ring-2 focus:ring-blue-500 outline-none"
              value={projectSearch}
              onChange={e => setProjectSearch(e.target.value)}
            />
            <button
              type="button"
              onClick={openDuplicatesModal}
              className="flex items-center gap-1.5 text-amber-700 hover:text-amber-800 hover:bg-amber-50 px-3 py-2 rounded-lg text-xs font-medium border border-amber-200 transition whitespace-nowrap"
              title="Detectar y consolidar proyectos duplicados"
            >
              <GitMerge className="w-3.5 h-3.5" /> Detectar proyectos duplicados
            </button>
          </div>
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
                            {formatProjectLabel(cajaChica)}
                            <span className="ml-2 px-2 py-0.5 bg-amber-200 text-amber-800 text-[10px] uppercase rounded-full">Especial</span>
                          </Link>
                        </td>
                        <td className="px-6 py-4 text-amber-800 font-medium">{cajaChica.client}</td>
                        <td className="px-6 py-4 text-amber-800 font-mono font-bold">{formatCurrency(cajaChica.expenses || 0)}</td>
                        <td className="px-6 py-4"><span className="bg-amber-100 text-amber-800 px-2 py-1 rounded-full text-xs font-semibold">Fondo Fijo</span></td>
                        <td className="px-6 py-4"><span className="text-xs text-gray-400 italic">Sistema</span></td>
                      </tr>
                    )}
                    {otherProjects.map(p => (
                      <tr key={p.id} className="border-b last:border-0 hover:bg-slate-50 transition-colors group">
                        <td className="px-6 py-4 font-medium">
                          <Link to={`/admin/projects/${p.id}`} className="text-blue-600 hover:text-blue-800 hover:underline">
                            {formatProjectLabel(p)}
                          </Link>
                        </td>
                        <td className="px-6 py-4 text-gray-600">{p.client}</td>
                        <td className="px-6 py-4">{formatCurrency(p.expenses || 0)}</td>
                        <td className="px-6 py-4"><span className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs font-semibold">Activo</span></td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => openEdit(p)}
                              className="text-blue-500 hover:text-blue-700 p-1"
                              title="Editar Proyecto"
                            >
                              <Pencil className="w-5 h-5" />
                            </button>
                            <button
                              onClick={() => handleDeleteProject(p.id)}
                              className="text-red-500 hover:text-red-700 p-1"
                              title="Eliminar Proyecto"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </div>
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

      {/* Create / Edit Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-8 pt-8 pb-4 border-b border-slate-700">
              <h2 className="text-xl font-bold text-white">{isEditing ? 'Editar Proyecto' : 'Nuevo Proyecto'}</h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-white transition">✕</button>
            </div>
            <form onSubmit={handleSaveProject} className="px-8 py-6 space-y-6">

              {/* Información Básica */}
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Información Básica</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-semibold text-slate-300 mb-1">Nombre del proyecto *</label>
                    <input type="text" required value={createForm.name}
                      onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Ej: Medición de Ruido Planta Central" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-1">Código *</label>
                    <input type="text" required value={createForm.code}
                      onChange={e => setCreateForm(p => ({ ...p, code: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Ej: ETF-001" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-1">Recurrencia <span className="font-normal text-slate-500">(opcional)</span></label>
                    <input type="text" value={createForm.recurrence}
                      onChange={e => setCreateForm(p => ({ ...p, recurrence: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Ej: A, B, C" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-semibold text-slate-300 mb-1">Cliente</label>
                    <SearchableSelect options={clients} value={createForm.client}
                      onChange={val => setCreateForm(p => ({ ...p, client: val }))}
                      placeholder="Buscar o seleccionar cliente..." />
                  </div>
                </div>
              </div>

              {/* Contacto del Cliente */}
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Contacto del Cliente <span className="normal-case font-normal">(opcional)</span></p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-1">Nombre de contacto</label>
                    <input type="text" value={createForm.contactName}
                      onChange={e => setCreateForm(p => ({ ...p, contactName: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-1">Teléfono / WhatsApp <span className="font-normal text-slate-500">(opcional)</span></label>
                    <input type="text" value={createForm.contactPhone}
                      onChange={e => setCreateForm(p => ({ ...p, contactPhone: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-1">Email <span className="font-normal text-slate-500">(opcional)</span></label>
                    <input type="email" value={createForm.contactEmail}
                      onChange={e => setCreateForm(p => ({ ...p, contactEmail: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-1">Cargo <span className="font-normal text-slate-500">(opcional)</span></label>
                    <input type="text" value={createForm.contactPosition}
                      onChange={e => setCreateForm(p => ({ ...p, contactPosition: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
              </div>

              {/* Recursos */}
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Recursos <span className="normal-case font-normal">(opcional)</span></p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-1">Ingenieros</label>
                    <div className="relative">
                      <button type="button" onClick={() => setShowEngDropdown(p => !p)}
                        className="w-full flex items-center justify-between px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm text-left focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        <span>{createForm.engineers.length === 0 ? 'Seleccionar ingenieros...' : `${createForm.engineers.length} seleccionado(s)`}</span>
                        <ChevronDown className={`w-5 h-5 text-slate-500 transition-transform ${showEngDropdown ? 'rotate-180' : ''}`} />
                      </button>
                      {showEngDropdown && (
                        <div className="absolute z-50 w-full mt-2 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-h-48 overflow-y-auto">
                          {engineersList.map(eng => (
                            <label key={eng.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-800 cursor-pointer border-b border-slate-800 last:border-0">
                              <input type="checkbox" checked={createForm.engineers.includes(eng.id)}
                                onChange={() => toggleCreateEngineer(eng.id)}
                                className="w-4 h-4 rounded border-slate-600 text-indigo-600" />
                              <span className="text-slate-200 text-sm">{eng.displayName}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-1">Vehículo</label>
                    <input type="text" value={createForm.vehicle}
                      onChange={e => setCreateForm(p => ({ ...p, vehicle: e.target.value }))}
                      placeholder="Ej: Camioneta ETF-1"
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-1">Equipamiento</label>
                    <input type="text" value={createForm.equipment}
                      onChange={e => setCreateForm(p => ({ ...p, equipment: e.target.value }))}
                      placeholder="Ej: Sonómetro Class 1"
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
                <button type="button" onClick={closeModal}
                  className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm font-bold transition-all">
                  Cancelar
                </button>
                <button type="submit" disabled={saving}
                  className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50">
                  {saving ? 'Guardando...' : isEditing ? 'Guardar Cambios' : 'Crear Proyecto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Duplicates Detection & Consolidation Modal */}
      {dupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b">
              <div className="flex items-center gap-2">
                <GitMerge className="w-5 h-5 text-amber-600" />
                <h2 className="text-lg font-bold text-slate-800">Proyectos duplicados</h2>
              </div>
              <button onClick={() => { setDupModalOpen(false); setDupConfirmGroup(null); }} className="text-slate-400 hover:text-slate-700 transition">✕</button>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-slate-600 mb-4">
                Detectamos grupos de proyectos que comparten nombre normalizado y recurrencia. Elegí el proyecto canónico
                (el que se conserva) y confirmá la consolidación. Se reasignan asignaciones, gastos, facturas, tareas,
                eventos de calendario e informes al canónico; el duplicado se elimina al finalizar.
              </p>

              {dupLoadingCounts && (
                <p className="text-sm text-slate-500 italic">Analizando referencias...</p>
              )}

              {!dupLoadingCounts && duplicateGroups.length === 0 && (
                <div className="p-6 text-center text-slate-500 bg-slate-50 rounded-lg border border-slate-200">
                  No se encontraron proyectos duplicados.
                </div>
              )}

              <div className="space-y-4">
                {duplicateGroups.map(group => {
                  const canonicalId = dupCanonicalByGroup[group.key];
                  const canConsolidate = Boolean(canonicalId);
                  const isConsolidating = dupConsolidatingKey === group.key;
                  const isConfirming = dupConfirmGroup === group.key;
                  const canonical = group.projects.find(p => p.id === canonicalId);
                  const duplicates = group.projects.filter(p => p.id !== canonicalId);
                  return (
                    <div key={group.key} className="border border-slate-200 rounded-lg overflow-hidden">
                      <div className="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                        Grupo: {group.projects[0].name}{group.projects[0].recurrence ? ` (${group.projects[0].recurrence})` : ''} — {group.projects.length} proyectos
                      </div>
                      <div className="divide-y divide-slate-100">
                        {group.projects.map(p => {
                          const c = dupCounts[p.id] || {};
                          const totalRefs = (c.allocations || 0) + (c.expenses || 0) + (c.invoices || 0) + (c.tasks || 0) + (c.calendar_events || 0) + (c.reports || 0);
                          return (
                            <label key={p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer">
                              <input
                                type="radio"
                                name={`canonical-${group.key}`}
                                checked={canonicalId === p.id}
                                onChange={() => setDupCanonicalByGroup(prev => ({ ...prev, [group.key]: p.id }))}
                                className="w-4 h-4 text-indigo-600"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-800 truncate">
                                  {formatProjectLabel(p)}
                                </p>
                                <p className="text-[11px] text-slate-400 font-mono truncate">id: {p.id}</p>
                              </div>
                              <div className="text-[11px] text-slate-500 text-right whitespace-nowrap">
                                {dupLoadingCounts ? '...' : (
                                  <>
                                    <span className="font-bold text-slate-700">{totalRefs}</span> referencias
                                    <p className="text-[10px] text-slate-400">
                                      A:{c.allocations || 0} · G:{c.expenses || 0} · F:{c.invoices || 0} · T:{c.tasks || 0} · E:{c.calendar_events || 0} · I:{c.reports || 0}
                                    </p>
                                  </>
                                )}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                      <div className="bg-slate-50 px-4 py-3 flex items-center justify-between gap-3">
                        <p className="text-xs text-slate-500">
                          {canonicalId ? `Se eliminarán ${duplicates.length} duplicado(s) y todas sus referencias se moverán al canónico.` : 'Elegí un proyecto canónico.'}
                        </p>
                        {!isConfirming ? (
                          <button
                            type="button"
                            disabled={!canConsolidate || isConsolidating}
                            onClick={() => setDupConfirmGroup(group.key)}
                            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-lg text-sm font-bold transition"
                          >
                            Consolidar
                          </button>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                              <div className="text-[11px] text-rose-700">
                                <p className="font-bold">Confirmar consolidación</p>
                                <p>
                                  Canónico: <span className="font-mono">{canonical?.name}</span>.
                                  Se moverán referencias y se eliminarán {duplicates.length} proyecto(s).
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setDupConfirmGroup(null)}
                              disabled={isConsolidating}
                              className="px-3 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-xs font-medium transition"
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              disabled={isConsolidating}
                              onClick={() => consolidateGroup(group.key, group)}
                              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition disabled:opacity-50"
                            >
                              {isConsolidating ? 'Consolidando...' : 'Consolidar proyectos'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="px-6 py-4 border-t bg-slate-50 flex justify-end">
              <button
                type="button"
                onClick={() => { setDupModalOpen(false); setDupConfirmGroup(null); }}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-lg text-sm font-medium transition"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
