import { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import Layout from '../components/Layout';
import InvoiceBulkUploader from '../components/InvoiceBulkUploader';
import { 
  FaFileContract, FaCheckCircle, FaMoneyBillWave, FaClock, 
  FaSearch, FaCloudUploadAlt, FaTimes, FaExternalLinkAlt, FaFileInvoiceDollar
} from 'react-icons/fa';
import { toast } from 'sonner';

// --- CONFIGURATION ---
const COLUMNS = [
  { id: 'pending', title: 'Por Facturar', color: 'bg-slate-100', icon: FaClock },
  { id: 'report_issued', title: 'Informe Emitido', color: 'bg-indigo-50', icon: FaFileContract },
  { id: 'invoiced', title: 'Facturado', color: 'bg-blue-50', icon: FaFileInvoiceDollar },
  { id: 'paid', title: 'Pagado', color: 'bg-green-50', icon: FaMoneyBillWave }
];

// --- SUB-COMPONENTS ---

const KanbanCard = ({ project, index, onClick }) => {
    return (
        <Draggable draggableId={project.id} index={index}>
            {(provided, snapshot) => (
                <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    onClick={() => onClick(project)}
                    className={`
                        bg-white p-3 rounded-lg shadow-sm border border-slate-200 mb-2 cursor-pointer 
                        hover:shadow-md hover:border-indigo-300 transition-all group
                        ${snapshot.isDragging ? 'shadow-lg rotate-2 ring-2 ring-indigo-400 z-50' : ''}
                    `}
                >
                    {/* Header: Code & Recurrence */}
                    <div className="flex justify-between items-start mb-1.5">
                        <div className="flex items-center gap-1.5">
                            {project.code ? (
                                <span className="bg-slate-800 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                                    {project.code}
                                </span>
                            ) : (
                                <span className="bg-red-100 text-red-600 text-[10px] font-bold px-1.5 py-0.5 rounded">S/C</span>
                            )}
                            {project.recurrence && (
                                <span className="bg-indigo-100 text-indigo-700 text-[10px] font-bold px-1.5 py-0.5 rounded border border-indigo-200">
                                    {project.recurrence}
                                </span>
                            )}
                        </div>
                    </div>
                    
                    {/* Main Info */}
                    <h4 className="font-bold text-slate-800 text-xs leading-tight mb-1 line-clamp-2">
                        {project.name}
                    </h4>
                    <p className="text-[10px] text-slate-500 truncate font-medium">
                        {project.client || 'Cliente Sin Nombre'}
                    </p>
                </div>
            )}
        </Draggable>
    );
};

const ProjectDetailModal = ({ project, isOpen, onClose }) => {
    if (!isOpen || !project) return null;

    const handleAction = async () => {
        try {
            const ref = doc(db, "projects", project.id);
            // Move to 'report_issued' manually
            await updateDoc(ref, {
                billingStatus: 'report_issued',
                lastBillingUpdate: serverTimestamp()
            });
            toast.success("Informe emitido registrado");
            onClose();
        } catch (e) {
            console.error(e);
            toast.error("Error al actualizar");
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all scale-100">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-slate-800">Detalle del Proyecto</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
                        <FaTimes />
                    </button>
                </div>
                
                <div className="p-6 space-y-4">
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Proyecto</label>
                        <p className="font-bold text-slate-800 text-lg leading-tight mt-1">{project.name}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Código</label>
                            <p className="font-mono text-sm font-semibold text-indigo-600 mt-1 bg-indigo-50 inline-block px-2 py-1 rounded">
                                {project.code || 'N/A'}
                            </p>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Recurrencia</label>
                            <p className="text-sm font-medium text-slate-700 mt-1">{project.recurrence || 'Único'}</p>
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Cliente</label>
                        <p className="text-sm font-medium text-slate-700 mt-1">{project.client}</p>
                    </div>

                    <div>
                         <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Estado Actual</label>
                         <div className="mt-1">
                            <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                                project.billingStatus === 'paid' ? 'bg-green-100 text-green-700' :
                                project.billingStatus === 'invoiced' ? 'bg-blue-100 text-blue-700' :
                                project.billingStatus === 'report_issued' ? 'bg-indigo-100 text-indigo-700' :
                                'bg-slate-100 text-slate-700'
                            }`}>
                                {COLUMNS.find(c => c.id === project.billingStatus)?.title || project.billingStatus}
                            </span>
                         </div>
                    </div>
                </div>

                <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                    {/* Action Button: Only visible if 'pending' */}
                    {project.billingStatus === 'pending' && (
                        <button 
                            onClick={handleAction}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-bold text-sm shadow-md transition flex items-center gap-2"
                        >
                            <FaFileContract /> Emitir Informe
                        </button>
                    )}
                 
                    {/* Link to Project (Optional) */}
                    {/* <Link to={`/admin/projects/${project.id}`} ... /> */}
                </div>
            </div>
        </div>
    );
};


// --- MAIN COMPONENT ---

export default function AdminKanbanBoard() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showUploader, setShowUploader] = useState(false);
  const [filter, setFilter] = useState('');
  
  // Modal State
  const [selectedProject, setSelectedProject] = useState(null);

  // Real-time Fetch
  useEffect(() => {
    const q = query(collection(db, "projects"), where("status", "!=", "deleted"));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const projData = snapshot.docs.map(doc => {
            const data = doc.data();
            // Default to 'pending' if no status
            let status = data.billingStatus || 'pending';
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

  // Filter Logic
  const filteredProjects = projects.filter(p => {
      if (!filter) return true;
      const term = filter.toLowerCase();
      return (p.name && p.name.toLowerCase().includes(term)) || 
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

  // Drag & Drop Handler
  const onDragEnd = async (result) => {
      const { destination, source, draggableId } = result;

      // 1. Dropped outside or same place -> Do nothing
      if (!destination) return;
      if (destination.droppableId === source.droppableId && destination.index === source.index) return;

      const newStatus = destination.droppableId;
      const oldStatus = source.droppableId;

      // 2. Optimistic UI Update
      // We manually update the local state before Firestore confirms to make it snappy
      const projectIndex = projects.findIndex(p => p.id === draggableId);
      if (projectIndex === -1) return;

      const updatedProject = { ...projects[projectIndex], billingStatus: newStatus };
      const newProjects = [...projects];
      newProjects[projectIndex] = updatedProject;
      
      setProjects(newProjects); // Instant update

      // 3. Firestore Update
      try {
          const ref = doc(db, "projects", draggableId);
          await updateDoc(ref, {
              billingStatus: newStatus,
              lastBillingUpdate: serverTimestamp()
          });
          // Success: No further action needed as snapshot listener will sync eventually
      } catch (error) {
          console.error("Drag update failed:", error);
          toast.error("Error al mover la tarjeta");
          // Revert Optimistic Update
          const revertedProjects = [...projects];
          revertedProjects[projectIndex] = { ...projects[projectIndex], billingStatus: oldStatus };
          setProjects(revertedProjects);
      }
  };

  return (
    <Layout title="Tablero de Facturación" isFullWidth={true}>
        
        {/* Header Actions */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
            <div className="relative w-full md:w-96">
                <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                <input 
                    type="text" 
                    placeholder="Buscar por nombre, cliente o código..." 
                    className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm shadow-sm"
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                />
            </div>
            
            <button 
                onClick={() => setShowUploader(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-xl font-bold shadow-md flex items-center gap-2 transition text-sm"
            >
                <FaCloudUploadAlt className="w-4 h-4" />
                Carga Masiva (PDF)
            </button>
        </div>

        {/* Uploader Modal */}
        {showUploader && (
            <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                 <div className="w-full max-w-2xl relative animate-in zoom-in-95 duration-200">
                     <InvoiceBulkUploader onClose={() => setShowUploader(false)} />
                 </div>
            </div>
        )}

        {/* Detail Modal */}
        <ProjectDetailModal 
            project={selectedProject} 
            isOpen={!!selectedProject} 
            onClose={() => setSelectedProject(null)} 
        />

        {/* Kanban Board Area */}
        {/* Using h-full logic to ensure scrolling within columns if needed */}
        <DragDropContext onDragEnd={onDragEnd}>
            <div className="flex gap-4 h-[calc(100vh-180px)] overflow-x-auto pb-2 items-start">
                {COLUMNS.map(col => {
                    const items = columnsData[col.id] || [];
                    const Icon = col.icon;
                    
                    return (
                        <div key={col.id} className="flex flex-col h-full min-w-[280px] w-[280px] md:w-1/4 rounded-xl bg-slate-50/50 border border-slate-200 shadow-sm">
                            
                            {/* Column Header */}
                            <div className={`p-3 rounded-t-xl border-b border-slate-200 ${col.color} flex justify-between items-center sticky top-0 z-10`}>
                                <div className="flex items-center gap-2 text-slate-700">
                                    <Icon className="text-slate-500 opacity-80" />
                                    <h3 className="font-bold text-xs uppercase tracking-wide">{col.title}</h3>
                                </div>
                                <span className="bg-white/60 text-slate-600 px-2 py-0.5 rounded-md text-[10px] font-bold border border-slate-200/50">
                                    {items.length}
                                </span>
                            </div>
                            
                            {/* Droppable Area */}
                            <Droppable droppableId={col.id}>
                                {(provided, snapshot) => (
                                    <div
                                        {...provided.droppableProps}
                                        ref={provided.innerRef}
                                        className={`flex-1 p-2 overflow-y-auto transition-colors ${snapshot.isDraggingOver ? 'bg-indigo-50/50' : ''}`}
                                    >
                                        {items.map((project, index) => (
                                            <KanbanCard 
                                                key={project.id} 
                                                project={project} 
                                                index={index} 
                                                onClick={setSelectedProject}
                                            />
                                        ))}
                                        {provided.placeholder}
                                        
                                        {items.length === 0 && !snapshot.isDraggingOver && (
                                            <div className="text-center py-8 opacity-40 select-none">
                                                <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Vacío</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </Droppable>
                        </div>
                    );
                })}
            </div>
        </DragDropContext>
    </Layout>
  );
}
