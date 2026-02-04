import { useState, useEffect } from 'react';
import { X, FileText, AlertTriangle, Trash2 } from 'lucide-react';
import { doc, getDocs, collection, query, where, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { formatCurrency } from '../utils/format';

export default function InvoiceDetailModal({ invoice, isOpen, onClose, onUpdate }) {
    const [expenses, setExpenses] = useState([]);
    const [loading, setLoading] = useState(false);
    const [processing, setProcessing] = useState(false);

    useEffect(() => {
        if (isOpen && invoice) {
            const fetchExpenses = async () => {
                setLoading(true);
                try {
                    const q = query(collection(db, "expenses"), where("invoiceId", "==", invoice.id));
                    const snap = await getDocs(q);
                    setExpenses(snap.docs.map(d => ({id: d.id, ...d.data()})));
                } catch (error) {
                    console.error("Error loading invoice expenses", error);
                } finally {
                    setLoading(false);
                }
            };
            fetchExpenses();
        }
    }, [isOpen, invoice]);

    const handleVoidInvoice = async () => {
        if (!confirm("¿Estás seguro de que deseas ANULAR esta pre-factura? Desaparecerá de todos los listados y los gastos volverán a estar disponibles para facturar.")) return;

        setProcessing(true);
        try {
            const batch = writeBatch(db);

            // 1. Mark Invoice as Void
            const invRef = doc(db, "invoices", invoice.id);
            batch.update(invRef, { 
                status: 'void', 
                paymentStatus: 'void',
                voidedAt: serverTimestamp() 
            });

            // 2. Release Expenses
            // query all related expenses (we already fetched them)
            expenses.forEach(exp => {
                const expRef = doc(db, "expenses", exp.id);
                // Reset to approved so they can be invoiced again
                batch.update(expRef, { 
                    invoiceId: null, 
                    invoiceStatus: 'approved' 
                });
            });

            await batch.commit();
            onClose();
            if (onUpdate) onUpdate(); // Refresh parent list
            
        } catch (error) {
            console.error("Error voiding invoice:", error);
            alert("Error al anular la factura.");
        } finally {
            setProcessing(false);
        }
    };

    if (!isOpen || !invoice) return null;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in duration-200">
                
                {/* Header */}
                <div className="p-6 border-b border-slate-100 flex justify-between items-start bg-slate-50">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            <FileText className="w-5 h-5 text-indigo-600" /> Pre-Factura detalles
                        </h2>
                        <p className="text-sm text-slate-500 mt-1">{invoice.clientName} • {invoice.projectName}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1 space-y-6">
                    
                    {/* Invoice Meta */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-100 text-sm">
                        <div>
                            <p className="text-xs text-slate-400 uppercase font-bold">Fecha Emisión</p>
                            <p className="font-bold text-slate-700">
                                {invoice.createdAt?.seconds ? new Date(invoice.createdAt.seconds * 1000).toLocaleDateString() : 'N/A'}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-400 uppercase font-bold">Estado Pago</p>
                            <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                                invoice.paymentStatus === 'paid' ? 'bg-green-100 text-green-700' : 
                                invoice.paymentStatus === 'void' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                            }`}>
                                {invoice.paymentStatus === 'paid' ? 'Pagada' : invoice.paymentStatus === 'void' ? 'Anulada' : 'Pendiente'}
                            </span>
                        </div>
                        <div>
                            <p className="text-xs text-slate-400 uppercase font-bold">Total Factura</p>
                            <p className="font-bold text-slate-800 text-lg">{formatCurrency(invoice.totalAmount)}</p>
                        </div>
                         <div>
                            <p className="text-xs text-slate-400 uppercase font-bold">Tipo Doc</p>
                            <p className="font-medium text-slate-700 capitalize">{invoice.documentType?.replace('_', ' ') || 'Factura'}</p>
                        </div>
                    </div>

                    {/* Expenses List */}
                    <div>
                        <h3 className="font-bold text-slate-800 mb-3 text-sm uppercase tracking-wide">Gastos Incluidos</h3>
                        {loading ? (
                            <p className="text-center py-4 text-slate-400 text-sm">Cargando gastos...</p>
                        ) : expenses.length === 0 ? (
                            <p className="text-center py-4 text-slate-400 text-sm italic">Sin gastos registrados.</p>
                        ) : (
                            <div className="border border-slate-100 rounded-xl overflow-hidden">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-100">
                                        <tr>
                                            <th className="px-4 py-2">Fecha</th>
                                            <th className="px-4 py-2">Descripción</th>
                                            <th className="px-4 py-2 text-right">Monto</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {expenses.map(exp => (
                                            <tr key={exp.id}>
                                                <td className="px-4 py-2 text-slate-600">
                                                    {exp.date?.seconds ? new Date(exp.date.seconds * 1000).toLocaleDateString() : (exp.date || 'S/F')}
                                                </td>
                                                <td className="px-4 py-2 text-slate-800">{exp.description}</td>
                                                <td className="px-4 py-2 text-right font-mono">{formatCurrency(exp.amount)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* Custom Items */}
                    {invoice.customItems && invoice.customItems.length > 0 && (
                         <div>
                            <h3 className="font-bold text-slate-800 mb-3 text-sm uppercase tracking-wide">Items Adicionales</h3>
                            <div className="border border-slate-100 rounded-xl overflow-hidden">
                                <table className="w-full text-sm text-left">
                                    <tbody className="divide-y divide-slate-100">
                                        {invoice.customItems.map((item, i) => (
                                            <tr key={i}>
                                                <td className="px-4 py-2 text-slate-800">{item.description}</td>
                                                <td className="px-4 py-2 text-right font-mono">{formatCurrency(item.amount)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                         </div>
                    )}
                    
                    {/* Payment Metadata (if matched) */}
                    {invoice.paymentMetadata && (
                        <div className="bg-green-50 p-4 rounded-xl border border-green-100">
                             <h3 className="font-bold text-green-800 mb-2 text-xs uppercase tracking-wide flex items-center gap-2">
                                <FileText className="w-3 h-3" /> Información de Conciliación
                             </h3>
                             <div className="grid grid-cols-2 text-sm gap-y-2">
                                 <p><span className="text-green-600 font-medium">Banco:</span> {invoice.paymentMetadata.bank}</p>
                                 <p><span className="text-green-600 font-medium">Fecha Tx:</span> {invoice.paymentMetadata.transactionDate}</p>
                                 <p className="col-span-2"><span className="text-green-600 font-medium">Glosa Banco:</span> {invoice.paymentMetadata.transactionDescription}</p>
                                 <p className="col-span-2 text-xs text-green-500 mt-1">Conciliado el: {new Date(invoice.paymentMetadata.reconciledAt).toLocaleString()}</p>
                             </div>
                        </div>
                    )}

                </div>

                {/* Footer Actions */}
                <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
                    <button 
                         onClick={handleVoidInvoice}
                         disabled={processing || invoice.status === 'void'}
                         className="flex items-center gap-2 text-red-500 hover:text-red-700 px-3 py-2 rounded-lg hover:bg-red-50 transition font-medium text-sm"
                    >
                        {processing ? <div className="animate-spin w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full" /> : <Trash2 className="w-4 h-4" />}
                        Anular Pre-Factura
                    </button>

                    <button 
                        onClick={onClose}
                        className="bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 font-medium text-sm transition"
                    >
                        Cerrar
                    </button>
                </div>
            </div>
        </div>
    );
}
