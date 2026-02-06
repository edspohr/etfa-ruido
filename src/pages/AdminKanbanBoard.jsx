import { useState, useEffect } from 'react';
// import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'; 
// Note: Assuming drag-and-drop isn't strictly required yet or pkg not installed. 
// User request said "Crea una interfaz de tablero" but didn't explicitly demand DnD functionality install.
// However, the prompt implies "moving cards". 
// To allow "Manual Action: Emitir Informe", we can do button-based moves initially to be safe and light.
// If DnD is needed, we should check if a lib is installed. Package.json didn't show 'react-beautiful-dnd' or '@hello-pangea/dnd'.
// So I will implement a VISUAL Kanban with BUTTONS for transitions first, which is more robust without new heavy deps.
// Wait, user asked for "Tablero Kanban". Typically implies DnD. But I can't install huge libs without plan approval for them.
// I'll stick to button-based transitions as per "Action Manual: ... botón 'Emitir Informe'" description.

import Layout from '../components/Layout';
import InvoiceBulkUploader from '../components/InvoiceBulkUploader';
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
// import { formatCurrency } from '../utils/format';
import { FileText, CheckCircle, Clock, Banknote, Search, Upload, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

const COLUMNS = [
  { id: 'pending', title: 'Por Facturar', color: 'bg-slate-100', icon: Clock },
  { id: 'report_issued', title: 'Informe Emitido', color: 'bg-indigo-50', icon: FileText },
  { id: 'invoiced', title: 'Facturado', color: 'bg-blue-50', icon: CheckCircle },
  { id: 'paid', title: 'Pagado', color: 'bg-green-50', icon: Banknote }
];

export default function AdminKanbanBoard() {
  const [projects, setProjects] = useState([]);
  /* eslint-disable no-unused-vars */
  const [loading, setLoading] = useState(true);
  /* eslint-enable no-unused-vars */
  const [showUploader, setShowUploader] = useState(false);
  const [filter, setFilter] = useState('');

  // Real-time Fetch
  useEffect(() => {
    const q = query(collection(db, "projects"), where("status", "!=", "deleted"));
    
    // Using onSnapshot for real-time updates so uploader changes reflect immediately
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const projData = snapshot.docs.map(doc => {
            const data = doc.data();
            // NORMALIZE STATUS:
            // If billingStatus is missing, lookup logic:
            // If active -> 'pending'
            let status = data.billingStatus || 'pending';
            
            // Safety fallback if status is empty string
            if (!status) status = 'pending';

            return { id: doc.id, ...data, billingStatus: status };
        });
        setProjects(projData);
        setLoading(false);
    }, (error) => {
        console.error("Error fetching projects:", error);
        toast.error("Error cargando tablero");
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);


  // Transition Helpers
  const moveProject = async (projId, newStatus) => {
      try {
          const ref = doc(db, "projects", projId);
          await updateDoc(ref, {
              billingStatus: newStatus,
              lastBillingUpdate: serverTimestamp() 
          });
          toast.success("Estado actualizado");
      } catch (e) {
          console.error(e);
          toast.error("Error al actualizar estado");
      }
  };

  const filteredProjects = projects.filter(p => {
      if (!filter) return true;
      const term = filter.toLowerCase();
      return p.name.toLowerCase().includes(term) || 
             (p.client && p.client.toLowerCase().includes(term)) ||
             (p.code && p.code.toLowerCase().includes(term));
  });

  // Group by Status
  const columnsData = {
      pending: filteredProjects.filter(p => p.billingStatus === 'pending'),
      report_issued: filteredProjects.filter(p => p.billingStatus === 'report_issued'),
      invoiced: filteredProjects.filter(p => p.billingStatus === 'invoiced'),
      paid: filteredProjects.filter(p => p.billingStatus === 'paid')
  };

  return (
    <Layout title="Facturación de Proyectos" isFullWidth={true}>
        
        {/* Header Actions */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
            <div className="relative w-full md:w-96">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input 
                    type="text" 
                    placeholder="Filtrar por nombre, cliente o código..." 
                    className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm shadow-sm"
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                />
            </div>
            
            <button 
                onClick={() => setShowUploader(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-xl font-bold shadow-lg flex items-center gap-2 transition"
            >
                <Upload className="w-5 h-5" />
                Carga Masiva (PDF)
            </button>
        </div>

        {/* Uploader Modal Overlay */}
        {showUploader && (
            <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                 <div className="w-full max-w-2xl relative">
                     <InvoiceBulkUploader onClose={() => setShowUploader(false)} />
                 </div>
            </div>
        )}

        {/* Kanban Board */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 h-[calc(100vh-200px)] overflow-x-auto pb-4">
            {COLUMNS.map(col => {
                const items = columnsData[col.id] || [];
                const Icon = col.icon;
                
                return (
                    <div key={col.id} className="flex flex-col h-full min-w-[300px]">
                        {/* Column Header */}
                        <div className={`p-4 rounded-t-xl border-t border-x border-slate-200 ${col.color} flex justify-between items-center`}>
                            <div className="flex items-center gap-2">
                                <Icon className="w-4 h-4 text-slate-500 opacity-75" />
                                <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide">{col.title}</h3>
                            </div>
                            <span className="bg-white/50 text-slate-600 px-2.5 py-0.5 rounded-full text-xs font-bold shadow-sm">
                                {items.length}
                            </span>
                        </div>
                        
                        {/* Drop Zone / List */}
                        <div className="bg-slate-50/50 border-x border-b border-slate-200 rounded-b-xl p-3 flex-1 overflow-y-auto space-y-3">
                            {items.map(project => (
                                <div key={project.id} className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 hover:shadow-md transition group relative">
                                    
                                    {/* Card Header: Code & Recurrence */}
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex items-center gap-2">
                                            {project.code && (
                                                <span className="bg-slate-100 text-slate-600 text-[10px] font-bold px-1.5 py-0.5 rounded border border-slate-200">
                                                    {project.code}
                                                </span>
                                            )}
                                            {project.recurrence && (
                                                 <span className="bg-indigo-50 text-indigo-600 text-[10px] font-bold px-1.5 py-0.5 rounded border border-indigo-100">
                                                    {project.recurrence}
                                                 </span>
                                            )}
                                        </div>
                                    </div>
                                    
                                    {/* Main Content */}
                                    <h4 className="font-bold text-slate-800 text-sm mb-1 leading-snug">{project.name}</h4>
                                    <p className="text-xs text-slate-500 mb-3 truncate">{project.client}</p>
                                    
                                    {/* Actions */}
                                    <div className="pt-3 border-t border-slate-50 flex justify-end">
                                        {col.id === 'pending' && (
                                            <button 
                                                onClick={() => moveProject(project.id, 'report_issued')}
                                                className="text-indigo-600 text-xs font-bold hover:bg-indigo-50 px-2 py-1 rounded flex items-center transition"
                                                title="Marcar Informe como Emitido"
                                            >
                                                Emitir Informe <ArrowRight className="w-3 h-3 ml-1" />
                                            </button>
                                        )}
                                        
                                        {col.id === 'report_issued' && (
                                            <span className="text-[10px] text-slate-400 italic">
                                                Esperando Facturación (PDF)
                                            </span>
                                        )}

                                        {col.id === 'invoiced' && (
                                            <span className="text-[10px] text-slate-400 italic">
                                                Esperando Pago
                                            </span>
                                        )}
                                         
                                         {col.id === 'paid' && (
                                            <span className="text-[10px] text-green-500 font-bold flex items-center">
                                                <CheckCircle className="w-3 h-3 mr-1" /> Finalizado
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                            
                            {items.length === 0 && (
                                <div className="text-center py-10 opacity-40">
                                    <p className="text-xs">No hay proyectos</p>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    </Layout>
  );
}
