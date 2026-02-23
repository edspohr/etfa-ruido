import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { 
    MessageSquare, Clock, User, Send, X, 
    History, Tag, Activity, FileCheck 
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

import { useAuth } from '../context/useAuth';

export default function ProjectBitacora({ projectId, isOpen, onClose }) {
    const { currentUser, userRole } = useAuth();
    const [logs, setLogs] = useState([]);
    const [newComment, setNewComment] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!projectId || !isOpen) return;

        const q = query(
            collection(db, "projects", projectId, "logs"),
            orderBy("timestamp", "desc")
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const logsData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setLogs(logsData);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [projectId, isOpen]);

    const handleAddComment = async (e) => {
        e.preventDefault();
        if (!newComment.trim()) return;

        try {
            await addDoc(collection(db, "projects", projectId, "logs"), {
                type: 'comment',
                content: newComment.trim(),
                userName: currentUser?.displayName || 'Usuario',
                userRole: userRole || 'professional',
                timestamp: serverTimestamp()
            });
            setNewComment('');
        } catch (error) {
            console.error("Error adding comment to bitacora:", error);
        }
    };

    if (!isOpen) return null;

    const getTypeIcon = (type) => {
        switch (type) {
            case 'status_change': return <History className="w-4 h-4 text-amber-500" />;
            case 'expense_added': return <Tag className="w-4 h-4 text-blue-500" />;
            case 'report_issued': return <FileCheck className="w-4 h-4 text-emerald-500" />;
            case 'comment': return <MessageSquare className="w-4 h-4 text-indigo-500" />;
            default: return <Activity className="w-4 h-4 text-slate-400" />;
        }
    };

    const getTypeLabel = (type) => {
        switch (type) {
            case 'status_change': return 'Estado';
            case 'expense_added': return 'Gasto';
            case 'report_issued': return 'Informe';
            case 'comment': return 'Comentario';
            default: return 'Evento';
        }
    };

    return (
        <div className="fixed inset-0 z-50 overflow-hidden">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" onClick={onClose} />
            
            <div className="absolute inset-y-0 right-0 max-w-full flex">
                <div className="w-screen max-w-md transform transition ease-in-out duration-500 sm:duration-700 h-full">
                    <div className="h-full flex flex-col bg-white shadow-2xl rounded-l-3xl overflow-hidden border-l border-white/20">
                        {/* Header */}
                        <div className="px-6 py-6 bg-slate-900 text-white">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-indigo-500/20 rounded-xl">
                                        <History className="w-6 h-6 text-indigo-300" />
                                    </div>
                                    <h2 className="text-xl font-black tracking-tight">Bitácora de Proyecto</h2>
                                </div>
                                <button 
                                    onClick={onClose}
                                    className="p-2 hover:bg-white/10 rounded-full transition-colors"
                                >
                                    <X className="w-6 h-6" />
                                </button>
                            </div>
                            <p className="mt-2 text-slate-400 text-sm font-medium">Historial completo y comunicación en tiempo real.</p>
                        </div>

                        {/* Logs List */}
                        <div className="flex-1 overflow-y-auto px-6 py-8 space-y-6 bg-slate-50">
                            {loading ? (
                                <div className="flex justify-center py-10">
                                    <Activity className="w-8 h-8 text-indigo-600 animate-spin" />
                                </div>
                            ) : logs.length === 0 ? (
                                <div className="text-center py-20">
                                    <MessageSquare className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                                    <p className="text-slate-400 font-medium italic">No hay registros aún.</p>
                                </div>
                            ) : (
                                logs.map((log) => (
                                    <div key={log.id} className="relative pl-10 group">
                                        {/* Timeline Line */}
                                        <div className="absolute left-4 top-2 bottom-0 w-0.5 bg-slate-200 group-last:bg-transparent" />
                                        
                                        {/* Timeline Dot */}
                                        <div className={`absolute left-0 top-1 p-1.5 rounded-full bg-white border-2 shadow-sm z-10 ${
                                            log.type === 'comment' ? 'border-indigo-400' : 'border-slate-300'
                                        }`}>
                                            {getTypeIcon(log.type)}
                                        </div>

                                        <div className={`p-4 rounded-2xl border ${
                                            log.type === 'comment' 
                                                ? 'bg-white border-indigo-100 shadow-sm' 
                                                : 'bg-slate-100/50 border-transparent text-slate-600'
                                        }`}>
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-[10px] uppercase font-black px-2 py-0.5 rounded-full ${
                                                        log.type === 'comment' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-600'
                                                    }`}>
                                                        {getTypeLabel(log.type)}
                                                    </span>
                                                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1">
                                                        <User className="w-3 h-3 text-slate-400" /> {log.userName}
                                                    </span>
                                                </div>
                                                <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                                                    <Clock className="w-3 h-3" />
                                                    {log.timestamp?.seconds 
                                                        ? format(log.timestamp.toDate(), "d MMM, HH:mm", { locale: es })
                                                        : 'Reciente'}
                                                </span>
                                            </div>
                                            <p className={`text-sm ${log.type === 'comment' ? 'text-slate-700' : 'italic text-slate-500'}`}>
                                                {log.content}
                                            </p>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Input Area */}
                        <div className="p-6 bg-white border-t border-slate-100 shadow-[0_-10px_20px_rgba(0,0,0,0.02)]">
                            <form onSubmit={handleAddComment} className="relative">
                                <textarea
                                    className="w-full bg-slate-50 border-transparent focus:ring-2 focus:ring-indigo-500 rounded-2xl p-4 pr-16 text-sm font-medium transition-all resize-none min-h-[100px]"
                                    placeholder="Escribe un comentario..."
                                    value={newComment}
                                    onChange={(e) => setNewComment(e.target.value)}
                                />
                                <button
                                    type="submit"
                                    disabled={!newComment.trim()}
                                    className={`absolute bottom-4 right-4 p-3 rounded-xl shadow-lg transition-all ${
                                        newComment.trim() 
                                            ? 'bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-105 active:scale-95' 
                                            : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                    }`}
                                >
                                    <Send className="w-5 h-5" />
                                </button>
                            </form>
                            <p className="mt-4 text-[10px] text-center text-slate-400 font-bold uppercase tracking-widest">
                                Comentarios visibles para el equipo asignado
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
