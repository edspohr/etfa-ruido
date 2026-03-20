import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { db } from '../lib/firebase';
import { collection, addDoc, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
import { toast } from 'sonner';
import { ClipboardList, PlusCircle, CheckCircle, AlertTriangle, Clock } from 'lucide-react';
import { sortProjects } from '../utils/sort';
import SearchableSelect from '../components/SearchableSelect';

export default function UserReports() {
    const { currentUser } = useAuth();
    const [projects, setProjects] = useState([]);
    const [myReports, setMyReports] = useState([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    
    // Form State
    const [formData, setFormData] = useState({
        projectId: '',
        date: new Date().toISOString().split('T')[0],
        equipment: '',
        noiseLevel: '',
        observations: ''
    });

    const fetchData = async () => {
        try {
            setLoading(true);
            
            // Bring active projects (or pending billing)
            const pQuery = query(collection(db, "projects"), where("status", "!=", "deleted"));
            const pSnap = await getDocs(pQuery);
            const pData = pSnap.docs
                .map(d => ({id: d.id, ...d.data()}))
                .filter(p => !['paid', 'invoiced'].includes(p.billingStatus)); // Only projects that can be reported
            
            setProjects(sortProjects(pData));

            // Bring user's reports
            if (currentUser) {
                const rQuery = query(collection(db, "reports"), where("userId", "==", currentUser.uid));
                const rSnap = await getDocs(rQuery);
                const rData = rSnap.docs.map(d => ({id: d.id, ...d.data()})).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
                setMyReports(rData);
            }
        } catch (e) {
            console.error("Error fetching data:", e);
            toast.error("Error cargando datos.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [currentUser]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if(!formData.projectId || !formData.date || !formData.equipment || !formData.noiseLevel) {
            toast.error("Por favor completa los campos obligatorios.");
            return;
        }

        setSubmitting(true);
        try {
            const project = projects.find(p => p.id === formData.projectId);
            
            await addDoc(collection(db, "reports"), {
                userId: currentUser.uid,
                userName: currentUser.displayName || 'Profesional',
                projectId: project.id,
                projectName: project.name,
                projectCode: project.code || '',
                date: formData.date,
                equipment: formData.equipment,
                noiseLevel: formData.noiseLevel,
                observations: formData.observations,
                status: 'pending_review',
                createdAt: serverTimestamp()
            });

            toast.success("Medición enviada exitosamente para revisión.");
            setFormData({
                ...formData,
                projectId: '',
                noiseLevel: '',
                observations: ''
            });
            fetchData();
        } catch (error) {
            console.error("Error al enviar reporte:", error);
            toast.error("Error al enviar medición.");
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <Layout title="Mis Mediciones">Cargando...</Layout>;

    return (
        <Layout title="Mis Mediciones en Terreno">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                
                {/* Formulario */}
                <div className="md:col-span-1">
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-2 text-teal-700">
                                <ClipboardList className="w-5 h-5" />
                                <h2 className="text-lg font-bold">Registrar Medición</h2>
                            </div>
                            <Link 
                                to="/informes/nuevo"
                                className="bg-teal-50 text-teal-700 hover:bg-teal-100 px-3 py-1.5 rounded-lg border border-teal-200 text-xs font-bold transition-all flex items-center gap-1.5"
                            >
                                <PlusCircle className="w-3.5 h-3.5" />
                                Dictado Manual
                            </Link>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Proyecto *</label>
                                <SearchableSelect
                                    options={projects.map(p => ({
                                        value: p.id,
                                        label: `${p.code ? `[${p.code}] ` : ''}${p.name || 'Sin Nombre'}`
                                    }))}
                                    value={formData.projectId}
                                    onChange={(val) => setFormData({...formData, projectId: val})}
                                    placeholder="Buscar proyecto..."
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Fecha de Medición *</label>
                                <input 
                                    type="date" 
                                    className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50 text-sm focus:ring-2 focus:ring-teal-500 outline-none"
                                    value={formData.date}
                                    onChange={e => setFormData({...formData, date: e.target.value})}
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Equipo Usado *</label>
                                <input 
                                    type="text" 
                                    className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50 text-sm focus:ring-2 focus:ring-teal-500 outline-none"
                                    placeholder="Ej: Sonómetro 1"
                                    value={formData.equipment}
                                    onChange={e => setFormData({...formData, equipment: e.target.value})}
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Nivel Equivalente (dB) *</label>
                                <input 
                                    type="number" 
                                    step="0.1"
                                    className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50 text-sm focus:ring-2 focus:ring-teal-500 outline-none"
                                    placeholder="Ej: 65.5"
                                    value={formData.noiseLevel}
                                    onChange={e => setFormData({...formData, noiseLevel: e.target.value})}
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Observaciones</label>
                                <textarea 
                                    className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50 text-sm focus:ring-2 focus:ring-teal-500 outline-none"
                                    placeholder="Condiciones climáticas, fuentes de ruido, etc."
                                    rows="3"
                                    value={formData.observations}
                                    onChange={e => setFormData({...formData, observations: e.target.value})}
                                ></textarea>
                            </div>

                            <button 
                                type="submit" 
                                disabled={submitting}
                                className={`w-full bg-teal-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-teal-700 transition shadow-md ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                <PlusCircle className="w-5 h-5" />
                                {submitting ? 'Enviando...' : 'Enviar Informe'}
                            </button>
                        </form>
                    </div>
                </div>

                {/* Historial */}
                <div className="md:col-span-2">
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden h-full flex flex-col">
                        <div className="p-4 border-b border-slate-100 bg-slate-50">
                            <h3 className="font-bold text-slate-800">Historial de Mediciones Enviadas</h3>
                        </div>
                        
                        <div className="p-4 flex-1 overflow-auto">
                            {myReports.length === 0 ? (
                                <div className="text-center py-12 text-slate-400">
                                    <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-20" />
                                    <p>No has enviado mediciones aún.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {myReports.map(report => (
                                        <div key={report.id} className="p-4 rounded-xl border border-slate-100 hover:shadow-md transition bg-white flex justify-between items-center group">
                                            <div>
                                                <p className="text-xs text-slate-400 font-medium mb-1">{report.date} • {report.equipment}</p>
                                                <h4 className="font-bold text-slate-800 text-sm">{report.projectCode ? `[${report.projectCode}] ` : ''}{report.projectName}</h4>
                                                <p className="text-sm text-slate-600 mt-1"><span className="font-semibold">{report.noiseLevel} dB(A)</span></p>
                                            </div>
                                            <div className="text-right flex flex-col items-end">
                                                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase flex items-center gap-1 ${
                                                    report.status === 'approved' ? 'bg-green-100 text-green-700' : 
                                                    report.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                                                }`}>
                                                    {report.status === 'approved' && <CheckCircle className="w-3 h-3"/>}
                                                    {report.status === 'rejected' && <AlertTriangle className="w-3 h-3"/>}
                                                    {report.status === 'pending_review' && <Clock className="w-3 h-3"/>}
                                                    {
                                                        report.status === 'approved' ? 'Aprobado' : 
                                                        report.status === 'rejected' ? 'Rechazado' : 'En Revisión'
                                                    }
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

            </div>
        </Layout>
    );
}
