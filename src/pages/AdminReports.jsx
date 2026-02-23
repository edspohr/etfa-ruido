import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs, doc, updateDoc, serverTimestamp, addDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { ClipboardList, CheckCircle, XCircle, Clock } from 'lucide-react';

export default function AdminReports() {
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(null);

    const fetchReports = async () => {
        try {
            setLoading(true);
            const rQuery = query(collection(db, "reports"), where("status", "==", "pending_review"));
            const snapshot = await getDocs(rQuery);
            const data = snapshot.docs.map(d => ({id: d.id, ...d.data()})).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
            setReports(data);
        } catch (e) {
            console.error(e);
            toast.error("Error cargando informes.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchReports();
    }, []);

    const handleAction = async (reportId, projectId, action) => {
        setProcessing(reportId);
        try {
            // Update Report Status
            const reportRef = doc(db, "reports", reportId);
            await updateDoc(reportRef, {
                status: action === 'approve' ? 'approved' : 'rejected',
                reviewedAt: serverTimestamp()
            });

            // Trigger Firebase update for Kanban Billing Pipeline
            if (action === 'approve' && projectId) {
                const projectRef = doc(db, "projects", projectId);
                await updateDoc(projectRef, {
                    billingStatus: 'report_issued',
                    lastBillingUpdate: serverTimestamp()
                });
                toast.success("Informe aprobado. Proyecto movido a 'Informe Emitido' en Kanban.");
                
                // Register in Bitacora
                await addDoc(collection(db, "projects", projectId, "logs"), {
                    type: 'status_change',
                    content: `Informe aprobado: Proyecto movido a 'Informe Emitido'`,
                    userName: 'Admin',
                    userRole: 'admin',
                    timestamp: serverTimestamp()
                });
            } else {
                toast.success("Informe rechazado.");
                if (projectId) {
                    // Register in Bitacora
                    await addDoc(collection(db, "projects", projectId, "logs"), {
                        type: 'status_change',
                        content: `Informe RECHAZADO por administración`,
                        userName: 'Admin',
                        userRole: 'admin',
                        timestamp: serverTimestamp()
                    });
                }
            }

            fetchReports();
        } catch (error) {
            console.error("Error updating report:", error);
            toast.error("Error al procesar la revisión.");
        } finally {
            setProcessing(null);
        }
    };

    if (loading) return <Layout title="Bandeja de Informes">Cargando...</Layout>;

    return (
        <Layout title="Bandeja de Informes (Terreno)">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="p-4 border-b border-slate-100 bg-teal-50 flex items-center gap-3">
                    <ClipboardList className="w-5 h-5 text-teal-600" />
                    <div>
                        <h3 className="font-bold text-teal-800">Informes Pendientes de Revisión</h3>
                        <p className="text-xs text-teal-600">Al aprobar un informe, el proyecto avanzará a facturación.</p>
                    </div>
                </div>

                <div className="p-6">
                    {reports.length === 0 ? (
                        <div className="text-center py-16">
                            <CheckCircle className="w-16 h-16 text-slate-200 mx-auto mb-4" />
                            <h3 className="text-lg font-bold text-slate-400">Todo al día</h3>
                            <p className="text-slate-500">No hay informes pendientes de revisión.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {reports.map(r => (
                                <div key={r.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition flex flex-col">
                                    
                                    <div className="flex justify-between items-start mb-4 border-b border-slate-100 pb-3">
                                        <div>
                                            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{r.date}</span>
                                            <h4 className="font-bold text-slate-800 text-lg mt-1">{r.projectCode ? `[${r.projectCode}] ` : ''}{r.projectName}</h4>
                                            <p className="text-sm font-medium text-teal-600">Por: {r.userName}</p>
                                        </div>
                                        <span className="bg-yellow-100 text-yellow-700 px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1">
                                            <Clock className="w-3 h-3" /> Revisión
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4 mb-4 flex-1">
                                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                                            <p className="text-xs font-semibold text-slate-500 mb-1">Equipo Usado</p>
                                            <p className="text-sm font-bold text-slate-700">{r.equipment}</p>
                                        </div>
                                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                                            <p className="text-xs font-semibold text-slate-500 mb-1">Nivel Equivalente</p>
                                            <p className="text-sm font-bold text-slate-700">{r.noiseLevel} dB(A)</p>
                                        </div>
                                        {r.observations && (
                                            <div className="col-span-2 bg-slate-50 p-3 rounded-xl border border-slate-100">
                                                <p className="text-xs font-semibold text-slate-500 mb-1">Observaciones</p>
                                                <p className="text-sm text-slate-700">{r.observations}</p>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex gap-3 mt-auto">
                                        <button 
                                            onClick={() => handleAction(r.id, r.projectId, 'reject')}
                                            disabled={processing === r.id}
                                            className="flex-1 py-2.5 px-4 rounded-xl font-bold text-red-600 bg-red-50 hover:bg-red-100 border border-red-100 transition flex items-center justify-center gap-2"
                                        >
                                            <XCircle className="w-4 h-4" /> Rechazar
                                        </button>
                                        <button 
                                            onClick={() => handleAction(r.id, r.projectId, 'approve')}
                                            disabled={processing === r.id}
                                            className="flex-1 py-2.5 px-4 rounded-xl font-bold text-white bg-teal-600 hover:bg-teal-700 shadow-md hover:shadow-lg transition flex items-center justify-center gap-2"
                                        >
                                            <CheckCircle className="w-4 h-4" /> Aprobar Reporte
                                        </button>
                                    </div>

                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </Layout>
    );
}
