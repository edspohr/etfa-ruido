import { useState, useEffect, useMemo } from 'react';
import Layout from '../components/Layout';
import { db } from '../lib/firebase';
import {
  collection, getDocs, addDoc, setDoc, deleteDoc,
  doc, writeBatch,
} from 'firebase/firestore';
import { toast } from 'sonner';
import { Users, Plus, Pencil, Trash2, Search, GitMerge, X } from 'lucide-react';

function normalizeClientName(name) {
  return (name || '')
    .toLowerCase()
    .trim()
    .replace(/\./g, '')
    .replace(/\b(sa|spa|ltda|limitada|empresa|compania|cia|de|del|los|las|pasajeros)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const EMPTY_FORM = { razonSocial: '', rut: '', direccion: '', comuna: '', giro: '' };

export default function AdminClients() {
  const [clientDocs, setClientDocs] = useState([]);
  const [projects, setProjects] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // CRUD modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Unify modal
  const [unifyTarget, setUnifyTarget] = useState(null);
  const [unifyVariants, setUnifyVariants] = useState([]);
  const [unifyFinalName, setUnifyFinalName] = useState('');
  const [unifying, setUnifying] = useState(false);
  const [unifySearch, setUnifySearch] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const [clientsSnap, projectsSnap, invoicesSnap] = await Promise.all([
        getDocs(collection(db, 'clients')),
        getDocs(collection(db, 'projects')),
        getDocs(collection(db, 'invoices')),
      ]);
      setClientDocs(clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setProjects(projectsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setInvoices(invoicesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error(e);
      toast.error('Error al cargar datos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // Build unified list: registered clients + virtual entries from projects
  const unifiedList = useMemo(() => {
    const result = [];
    const registeredNames = new Set(
      clientDocs.map(c => (c.razonSocial || '').toLowerCase().trim())
    );

    clientDocs.forEach(c => {
      const projectCount = projects.filter(
        p => (p.client || '').toLowerCase().trim() === (c.razonSocial || '').toLowerCase().trim()
      ).length;
      result.push({ ...c, projectCount, isVirtual: false });
    });

    const seen = new Set();
    projects.forEach(p => {
      const name = (p.client || '').trim();
      if (!name || seen.has(name.toLowerCase())) return;
      if (registeredNames.has(name.toLowerCase())) return;
      seen.add(name.toLowerCase());
      const count = projects.filter(
        pp => (pp.client || '').toLowerCase().trim() === name.toLowerCase()
      ).length;
      result.push({
        id: null,
        razonSocial: name,
        rut: '',
        direccion: '',
        comuna: '',
        giro: '',
        projectCount: count,
        isVirtual: true,
      });
    });

    return result.sort((a, b) =>
      (a.razonSocial || '').localeCompare(b.razonSocial || '', 'es')
    );
  }, [clientDocs, projects]);

  // All name variations across both sources
  const allNames = useMemo(() => {
    const names = new Set();
    clientDocs.forEach(c => c.razonSocial && names.add(c.razonSocial.trim()));
    projects.forEach(p => p.client && names.add(p.client.trim()));
    return [...names];
  }, [clientDocs, projects]);

  // Group names by normalized form; groups with >1 entry are similar
  const similarGroups = useMemo(() => {
    const groups = {};
    allNames.forEach(name => {
      const key = normalizeClientName(name);
      if (!key) return;
      if (!groups[key]) groups[key] = [];
      groups[key].push(name);
    });
    return groups;
  }, [allNames]);

  const getSimilarVariants = (razonSocial) => {
    const key = normalizeClientName(razonSocial);
    const group = similarGroups[key] || [];
    return group.filter(n => n.toLowerCase() !== (razonSocial || '').toLowerCase());
  };

  const filteredList = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return unifiedList;
    return unifiedList.filter(c =>
      (c.razonSocial || '').toLowerCase().includes(q) ||
      (c.rut || '').toLowerCase().includes(q)
    );
  }, [unifiedList, search]);

  const openCreate = () => {
    setEditingClient(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (client) => {
    setEditingClient(client);
    setForm({
      razonSocial: client.razonSocial || '',
      rut: client.rut || '',
      direccion: client.direccion || '',
      comuna: client.comuna || '',
      giro: client.giro || '',
    });
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.razonSocial.trim()) { toast.error('La razón social es obligatoria'); return; }
    setSaving(true);
    try {
      const data = {
        razonSocial: form.razonSocial.trim(),
        rut: form.rut.trim(),
        direccion: form.direccion.trim(),
        comuna: form.comuna.trim(),
        giro: form.giro.trim(),
      };
      if (editingClient?.id) {
        await setDoc(doc(db, 'clients', editingClient.id), data, { merge: true });
      } else if (form.rut.trim()) {
        const cleanRut = form.rut.trim().replace(/\./g, '').replace(/-/g, '');
        await setDoc(doc(db, 'clients', cleanRut), data);
      } else {
        await addDoc(collection(db, 'clients'), data);
      }
      toast.success(editingClient ? 'Cliente actualizado' : 'Cliente creado');
      setModalOpen(false);
      await fetchData();
    } catch (err) {
      console.error(err);
      toast.error('Error al guardar cliente');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget?.id) { setDeleteTarget(null); return; }
    try {
      await deleteDoc(doc(db, 'clients', deleteTarget.id));
      toast.success('Cliente eliminado');
      setDeleteTarget(null);
      await fetchData();
    } catch (err) {
      console.error(err);
      toast.error('Error al eliminar cliente');
    }
  };

  const openUnify = (client) => {
    const autoDetected = getSimilarVariants(client.razonSocial);
    // Build list of ALL other client names (excluding the selected master)
    const allOtherNames = allNames
      .filter(n => n.toLowerCase() !== (client.razonSocial || '').toLowerCase())
      .sort((a, b) => a.localeCompare(b, 'es'));
    // Mark auto-detected as pre-checked, others unchecked
    setUnifyTarget(client);
    setUnifyVariants(allOtherNames.map(name => ({
      name,
      checked: autoDetected.some(v => v.toLowerCase() === name.toLowerCase()),
    })));
    setUnifyFinalName(client.razonSocial);
    setUnifySearch('');
  };

  const handleUnify = async () => {
    const checked = unifyVariants.filter(v => v.checked).map(v => v.name);
    if (checked.length === 0) { toast.error('Selecciona al menos una variante'); return; }
    const finalName = unifyFinalName.trim();
    if (!finalName) { toast.error('El nombre final no puede estar vacío'); return; }

    setUnifying(true);
    try {
      const batch = writeBatch(db);
      let projCount = 0, invCount = 0;

      // Update projects where client matches any checked variant
      projects.forEach(p => {
        if (checked.some(v => v.toLowerCase() === (p.client || '').toLowerCase())) {
          batch.update(doc(db, 'projects', p.id), { client: finalName });
          projCount++;
        }
      });

      // Update invoices where clientName matches any checked variant
      invoices.forEach(inv => {
        if (checked.some(v => v.toLowerCase() === (inv.clientName || '').toLowerCase())) {
          batch.update(doc(db, 'invoices', inv.id), { clientName: finalName });
          invCount++;
        }
      });

      // Delete merged client docs from collection
      clientDocs.forEach(c => {
        if (checked.some(v => v.toLowerCase() === (c.razonSocial || '').toLowerCase()) && c.id) {
          batch.delete(doc(db, 'clients', c.id));
        }
      });

      // Update target client doc razonSocial if it exists
      if (unifyTarget.id) {
        batch.update(doc(db, 'clients', unifyTarget.id), { razonSocial: finalName });
      }

      await batch.commit();

      // If target was virtual, create a new client doc
      if (!unifyTarget.id) {
        await addDoc(collection(db, 'clients'), {
          razonSocial: finalName,
          rut: unifyTarget.rut || '',
          direccion: unifyTarget.direccion || '',
          comuna: unifyTarget.comuna || '',
          giro: unifyTarget.giro || '',
        });
      }

      toast.success(`${projCount} proyecto(s) y ${invCount} factura(s) actualizados. Clientes unificados.`);
      setUnifyTarget(null);
      setUnifyVariants([]);
      await fetchData();
    } catch (err) {
      console.error(err);
      toast.error('Error al unificar clientes');
    } finally {
      setUnifying(false);
    }
  };

  if (loading) return <Layout title="Gestión de Clientes"><p className="p-8 text-gray-400">Cargando...</p></Layout>;

  const virtualCount = unifiedList.filter(c => c.isVirtual).length;

  return (
    <Layout title="Gestión de Clientes">
      {/* Header actions */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar por nombre o RUT..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-700 transition shadow"
        >
          <Plus className="w-4 h-4" />
          Nuevo Cliente
        </button>
      </div>

      {/* Summary */}
      <div className="flex items-center gap-4 mb-4 text-sm text-gray-500">
        <span className="flex items-center gap-1.5">
          <Users className="w-4 h-4" />
          {unifiedList.length} clientes en total
        </span>
        <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-0.5 rounded-full">
          {clientDocs.length} registrados
        </span>
        {virtualCount > 0 && (
          <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">
            {virtualCount} sin registrar
          </span>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="px-6 py-3 font-medium text-gray-500">Razón Social</th>
              <th className="px-6 py-3 font-medium text-gray-500">RUT</th>
              <th className="px-6 py-3 font-medium text-gray-500 text-center">Proyectos</th>
              <th className="px-6 py-3 font-medium text-gray-500">Estado</th>
              <th className="px-6 py-3 font-medium text-gray-500 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filteredList.length === 0 && (
              <tr>
                <td colSpan="5" className="px-6 py-10 text-center text-gray-400">
                  No se encontraron clientes.
                </td>
              </tr>
            )}
            {filteredList.map((c, idx) => {
              return (
                <tr key={c.id || `virtual-${idx}`} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-4">
                    <p className="font-medium text-gray-800">{c.razonSocial}</p>
                    {c.giro && <p className="text-xs text-gray-400 mt-0.5">{c.giro}</p>}
                  </td>
                  <td className="px-6 py-4 text-gray-500 font-mono text-xs">{c.rut || '—'}</td>
                  <td className="px-6 py-4 text-center">
                    <span className="bg-gray-100 text-gray-700 text-xs font-bold px-2.5 py-1 rounded-full">
                      {c.projectCount}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {c.isVirtual ? (
                      <span className="bg-amber-100 text-amber-700 border border-amber-200 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full">
                        Sin registrar
                      </span>
                    ) : (
                      <span className="bg-emerald-100 text-emerald-700 border border-emerald-200 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full">
                        Registrado
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openUnify(c)}
                        title="Unificar con otros clientes"
                        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-lg transition font-semibold"
                      >
                        <GitMerge className="w-3.5 h-3.5" />
                        Unificar
                      </button>
                      <button
                        onClick={() => openEdit(c)}
                        title="Editar"
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {!c.isVirtual && c.projectCount === 0 && (
                        <button
                          onClick={() => setDeleteTarget(c)}
                          title="Eliminar"
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="font-bold text-gray-800">
                {editingClient ? 'Editar Cliente' : 'Nuevo Cliente'}
              </h2>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-gray-600 transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Razón Social *</label>
                <input
                  type="text"
                  value={form.razonSocial}
                  onChange={e => setForm({ ...form, razonSocial: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Empresa de Ejemplo S.A."
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">RUT</label>
                <input
                  type="text"
                  value={form.rut}
                  onChange={e => setForm({ ...form, rut: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="12.345.678-9"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Dirección</label>
                  <input
                    type="text"
                    value={form.direccion}
                    onChange={e => setForm({ ...form, direccion: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Av. Ejemplo 123"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Comuna</label>
                  <input
                    type="text"
                    value={form.comuna}
                    onChange={e => setForm({ ...form, comuna: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Santiago"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Giro</label>
                <input
                  type="text"
                  value={form.giro}
                  onChange={e => setForm({ ...form, giro: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Transporte de pasajeros"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {saving ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h2 className="font-bold text-gray-800 mb-2">Eliminar Cliente</h2>
            <p className="text-sm text-gray-600 mb-6">
              ¿Eliminar a <strong>{deleteTarget.razonSocial}</strong>? Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 font-medium transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 text-white text-sm font-bold rounded-lg hover:bg-red-700 transition"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unify Modal */}
      {unifyTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="font-bold text-gray-800 flex items-center gap-2">
                <GitMerge className="w-5 h-5 text-indigo-600" />
                Unificar Cliente
              </h2>
              <button onClick={() => setUnifyTarget(null)} className="text-gray-400 hover:text-gray-600 transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Cliente base</p>
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-sm font-medium text-indigo-800">
                  {unifyTarget.razonSocial}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Clientes a fusionar (selecciona los que deseas unificar con el cliente base)
                </p>
                {unifyVariants.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No hay otros clientes para unificar.</p>
                ) : (
                  <>
                    <input
                      type="text"
                      placeholder="Buscar cliente..."
                      value={unifySearch}
                      onChange={e => setUnifySearch(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 mb-3"
                    />
                    <div className="space-y-1 max-h-64 overflow-y-auto border border-gray-100 rounded-lg p-2">
                      {(() => {
                        const q = unifySearch.toLowerCase();
                        const visible = unifyVariants
                          .map((v, originalIndex) => ({ ...v, originalIndex }))
                          .filter(v => !q || v.name.toLowerCase().includes(q));
                        const checkedItems = visible.filter(v => v.checked);
                        const uncheckedItems = visible.filter(v => !v.checked);

                        const toggleByName = (name) =>
                          setUnifyVariants(prev =>
                            prev.map(x => x.name === name ? { ...x, checked: !x.checked } : x)
                          );

                        const renderRow = (v) => (
                          <label key={v.originalIndex} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={v.checked}
                              onChange={() => toggleByName(v.name)}
                              className="rounded"
                            />
                            <span className="text-sm text-gray-700 flex-1">{v.name}</span>
                            <span className="text-xs text-gray-400 flex-shrink-0">
                              {projects.filter(p => (p.client || '').toLowerCase() === v.name.toLowerCase()).length} proy.
                            </span>
                          </label>
                        );

                        return (
                          <>
                            {checkedItems.length > 0 && (
                              <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-1">Posibles duplicados detectados</p>
                            )}
                            {checkedItems.map(renderRow)}
                            {uncheckedItems.length > 0 && (
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 mt-3">Todos los clientes</p>
                            )}
                            {uncheckedItems.map(renderRow)}
                            {visible.length === 0 && (
                              <p className="text-sm text-gray-400 italic px-2 py-1">Sin resultados.</p>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Nombre final
                </label>
                <input
                  type="text"
                  value={unifyFinalName}
                  onChange={e => setUnifyFinalName(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Este nombre reemplazará a todas las variantes seleccionadas en proyectos y facturas.
                </p>
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <button
                  onClick={() => setUnifyTarget(null)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 font-medium transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleUnify}
                  disabled={unifying}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 flex items-center gap-2"
                >
                  <GitMerge className="w-4 h-4" />
                  {unifying ? 'Unificando...' : 'Confirmar Unificación'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
