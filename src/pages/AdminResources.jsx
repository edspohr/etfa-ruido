import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { db } from '../lib/firebase';
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp,
} from 'firebase/firestore';
import { Pencil, Trash2, Plus, X, Wrench } from 'lucide-react';
import { toast } from 'sonner';

const TYPE_LABELS = {
  sonometro: 'Sonómetro',
  vehiculo:  'Vehículo',
  otro:      'Otro',
};

const STATUS_STYLES = {
  disponible: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  en_uso:     'bg-amber-500/20  text-amber-400  border-amber-500/30',
  mantencion: 'bg-rose-500/20   text-rose-400   border-rose-500/30',
};
const STATUS_LABELS = {
  disponible: 'Disponible',
  en_uso:     'En uso',
  mantencion: 'Mantención',
};

const EMPTY_FORM = {
  type:   'sonometro',
  code:   '',
  name:   '',
  status: 'disponible',
  notes:  '',
};

const FILTER_TABS = [
  { key: 'all',       label: 'Todos'      },
  { key: 'sonometro', label: 'Sonómetros' },
  { key: 'vehiculo',  label: 'Vehículos'  },
  { key: 'otro',      label: 'Otros'      },
];

export default function AdminResources() {
  const [resources,    setResources]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [filter,       setFilter]       = useState('all');
  const [modalOpen,    setModalOpen]    = useState(false);
  const [editingDoc,   setEditingDoc]   = useState(null);
  const [formData,     setFormData]     = useState({ ...EMPTY_FORM });
  const [saving,       setSaving]       = useState(false);

  const fetchResources = async () => {
    const snap = await getDocs(collection(db, 'resources'));
    setResources(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => {
    setLoading(true);
    fetchResources().finally(() => setLoading(false));
  }, []);

  const openCreate = () => {
    setEditingDoc(null);
    setFormData({ ...EMPTY_FORM });
    setModalOpen(true);
  };

  const openEdit = (res) => {
    setEditingDoc(res);
    setFormData({
      type:   res.type   || 'sonometro',
      code:   res.code   || '',
      name:   res.name   || '',
      status: res.status || 'disponible',
      notes:  res.notes  || '',
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingDoc(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('El nombre es obligatorio.');
      return;
    }
    setSaving(true);
    try {
      if (editingDoc) {
        await updateDoc(doc(db, 'resources', editingDoc.id), {
          type:   formData.type,
          code:   formData.code.trim(),
          name:   formData.name.trim(),
          status: formData.status,
          notes:  formData.notes.trim(),
        });
        toast.success('Recurso actualizado.');
      } else {
        await addDoc(collection(db, 'resources'), {
          type:      formData.type,
          code:      formData.code.trim(),
          name:      formData.name.trim(),
          status:    formData.status,
          notes:     formData.notes.trim(),
          createdAt: serverTimestamp(),
        });
        toast.success('Recurso agregado.');
      }
      closeModal();
      await fetchResources();
    } catch (err) {
      console.error(err);
      toast.error('Error al guardar recurso.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (res) => {
    if (!window.confirm(`¿Eliminar "${res.name}"?`)) return;
    try {
      await deleteDoc(doc(db, 'resources', res.id));
      toast.success('Recurso eliminado.');
      await fetchResources();
    } catch (err) {
      console.error(err);
      toast.error('Error al eliminar recurso.');
    }
  };

  const filtered = filter === 'all'
    ? resources
    : resources.filter(r => r.type === filter);

  if (loading) return <Layout title="Gestión de Recursos">Cargando...</Layout>;

  return (
    <Layout title="Gestión de Recursos">

      {/* Header row */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        {/* Filter tabs */}
        <div className="flex gap-1.5 flex-wrap">
          {FILTER_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                filter === t.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-colors"
        >
          <Plus className="w-4 h-4" />
          Agregar Recurso
        </button>
      </div>

      {/* Table */}
      <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Wrench className="w-10 h-10 text-slate-600 mb-3" />
            <p className="text-slate-400 font-medium">Sin recursos en esta categoría.</p>
            <p className="text-slate-500 text-sm mt-1">Haz clic en "Agregar Recurso" para comenzar.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left">
                  <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Tipo</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Código</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Nombre</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Estado</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Notas</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {filtered.map(res => (
                  <tr key={res.id} className="hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-3 text-slate-300">{TYPE_LABELS[res.type] || res.type}</td>
                    <td className="px-4 py-3 font-mono text-indigo-400 text-xs">{res.code || '—'}</td>
                    <td className="px-4 py-3 text-white font-medium">{res.name}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${STATUS_STYLES[res.status] || STATUS_STYLES.disponible}`}>
                        {STATUS_LABELS[res.status] || res.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 max-w-xs truncate">{res.notes || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(res)}
                          className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition-colors"
                          title="Editar"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(res)}
                          className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={closeModal}
        >
          <div
            className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
              <h2 className="text-white font-bold text-lg">
                {editingDoc ? 'Editar Recurso' : 'Agregar Recurso'}
              </h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Tipo</label>
                  <select
                    value={formData.type}
                    onChange={e => setFormData(f => ({ ...f, type: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="sonometro">Sonómetro</option>
                    <option value="vehiculo">Vehículo</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Código</label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={e => setFormData(f => ({ ...f, code: e.target.value }))}
                    placeholder="Ej: SLM-01"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Nombre <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                  placeholder="Ej: Sonómetro Svantek 971"
                  required
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Estado</label>
                <select
                  value={formData.status}
                  onChange={e => setFormData(f => ({ ...f, status: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="disponible">Disponible</option>
                  <option value="en_uso">En uso</option>
                  <option value="mantencion">Mantención</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Notas</label>
                <textarea
                  value={formData.notes}
                  onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Observaciones, fecha de calibración, etc."
                  rows={3}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-700">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors"
                >
                  {saving ? 'Guardando...' : editingDoc ? 'Guardar cambios' : 'Agregar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
