import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import {
  Upload, FileSpreadsheet, CheckCircle, AlertTriangle, ArrowRight,
  Save, RefreshCw, X, Link, ChevronDown, ChevronUp, AlertCircle, Trash2
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  collection, query, where, getDocs, writeBatch, doc,
  serverTimestamp, getDoc, orderBy
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { formatCurrency } from '../utils/format';
import { parseBankData } from '../utils/parseBankStatement';
import { sortProjects } from '../utils/sort';
import InvoiceDetailModal from '../components/InvoiceDetailModal';
import { toast } from 'sonner';

// Helper: generate a deterministic document ID for a bank movement
const generateMovementId = (bankName, date, amount, description, index) => {
  const sanitize = (s) =>
    String(s || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().substring(0, 40);
  return `${sanitize(bankName)}_${sanitize(date)}_${Math.round(Math.abs(amount))}_${sanitize(description).substring(0, 20)}_${index}`;
};

// Parse "DD/MM/YYYY" → Date object (for smart matching date proximity)
const parseDisplayDate = (dateStr) => {
  if (!dateStr || dateStr === 'S/F') return null;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts.map(Number);
  const d = new Date(yyyy, mm - 1, dd);
  return isNaN(d.getTime()) ? null : d;
};

export default function AdminInvoicingReconciliation() {
  const [movements, setMovements]           = useState([]);
  const [matches, setMatches]               = useState([]);
  const [pendingInvoices, setPendingInvoices] = useState([]);
  const [bankStatements, setBankStatements]   = useState([]);
  const [loading, setLoading]               = useState(false);
  const [loadingMovements, setLoadingMovements] = useState(true);
  const [processing, setProcessing]         = useState(false);
  const [suggestions, setSuggestions]       = useState({});
  const [expandedMovement, setExpandedMovement] = useState(null);

  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [isModalOpen, setIsModalOpen]       = useState(false);

  const [manualMatchOpen, setManualMatchOpen] = useState(false);
  const [activeMovement, setActiveMovement]  = useState(null);

  const [projects, setProjects] = useState([]);

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      await fetchPending();
      await fetchMovements();
      await fetchBankStatements();
      try {
        const qProj = query(collection(db, 'projects'), where('status', '!=', 'deleted'));
        const snapProj = await getDocs(qProj);
        setProjects(sortProjects(snapProj.docs.map((d) => ({ id: d.id, ...d.data() }))));
      } catch (e) { console.error('Error fetching projects:', e); }
    };
    init();
  }, []);

  useEffect(() => {
    if (movements.length > 0 && pendingInvoices.length > 0) {
      runSmartMatching(movements, pendingInvoices);
    }
  }, [movements, pendingInvoices, runSmartMatching]);

  // ── Data fetching ─────────────────────────────────────────────────────────
  const fetchPending = async () => {
    const q = query(collection(db, 'invoices'), where('paymentStatus', '==', 'pending'));
    const snapshot = await getDocs(q);
    setPendingInvoices(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  const fetchMovements = async () => {
    setLoadingMovements(true);
    try {
      const snapshot = await getDocs(collection(db, 'bank_movements'));
      const movs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      movs.sort((a, b) => {
        const dA = parseDisplayDate(a.date);
        const dB = parseDisplayDate(b.date);
        if (!dA || !dB) return 0;
        return dB - dA;
      });
      setMovements(movs);
    } catch (e) {
      console.error('Error fetching movements:', e);
      toast.error('Error al cargar movimientos bancarios.');
    } finally {
      setLoadingMovements(false);
    }
  };

  const fetchBankStatements = async () => {
    try {
      const q = query(collection(db, 'bank_statements'), orderBy('uploadedAt', 'desc'));
      const snapshot = await getDocs(q);
      setBankStatements(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error('Error fetching bank statements:', e);
    }
  };

  // ── File Upload ───────────────────────────────────────────────────────────
  const handleFileUpload = (e, bankName) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;
    setLoading(true);

    const reader = new FileReader();

    reader.onload = async (evt) => {
      try {
        const arrayBuffer = evt.target.result;
        let workbook;

        // Detect HTML-disguised XLS (some Chilean banks export HTML tables as .xls)
        const firstBytes = new Uint8Array(arrayBuffer.slice(0, 100));
        const headerStr  = String.fromCharCode(...firstBytes).toLowerCase();
        const isHtml     = headerStr.includes('<html') || headerStr.includes('<table') || headerStr.includes('<!doctype');

        try {
          workbook = XLSX.read(arrayBuffer, { type: 'array', raw: isHtml });
        } catch {
          try {
            workbook = XLSX.read(arrayBuffer, { type: 'array', raw: true });
          } catch {
            toast.error(
              `El formato del archivo de ${bankName} no es reconocido. ` +
              `Exporta desde el banco como Excel (.xlsx) con columnas de Fecha, Descripción y Abono.`
            );
            setLoading(false);
            return;
          }
        }

        const wsname = workbook.SheetNames[0];
        const ws     = workbook.Sheets[wsname];
        const rows   = XLSX.utils.sheet_to_json(ws, { header: 1 });

        // ── Use the new robust parser ──
        const { movements: parsed, warnings, errors } = parseBankData(rows, bankName);

        // Surface parser errors/warnings to the user
        errors.forEach((msg)   => toast.error(msg,   { duration: 8000 }));
        warnings.forEach((msg) => toast.warning(msg, { duration: 6000 }));

        if (parsed.length === 0) {
          setLoading(false);
          return;
        }

        // Persist to Firestore (with duplicate detection)
        const batch = writeBatch(db);
        let newCount  = 0;
        let dupeCount = 0;
        const newMovs = [];

        // Create the statement document reference
        const statementDocRef = doc(collection(db, 'bank_statements'));
        const statementId = statementDocRef.id;

        for (let i = 0; i < parsed.length; i++) {
          const mov   = parsed[i];
          const docId = generateMovementId(bankName, mov.date, mov.amount, mov.description, i);
          const docRef = doc(db, 'bank_movements', docId);

          const existing = await getDoc(docRef);
          if (existing.exists()) { dupeCount++; continue; }

          const movData = {
            date:        mov.date,
            description: String(mov.description || ''),
            amount:      mov.amount,
            bank:        bankName,
            createdAt:   serverTimestamp(),
            reconciled:  false,
            statementId: statementId
          };
          batch.set(docRef, movData);
          newMovs.push({ id: docId, ...movData });
          newCount++;
        }

        if (newCount > 0) {
          // Record the loaded statement metadata
          batch.set(statementDocRef, {
            filename: selectedFile.name,
            bank: bankName,
            movementsCount: newCount,
            uploadedAt: serverTimestamp()
          });
          await batch.commit();
        }

        if (newCount > 0) {
          toast.success(
            `${newCount} movimientos nuevos de ${bankName}.` +
            (dupeCount > 0 ? ` (${dupeCount} duplicados omitidos)` : '')
          );
        } else if (dupeCount > 0) {
          toast.info(`Todos los movimientos de ${bankName} ya estaban cargados.`);
        }

        await fetchMovements();
        await fetchBankStatements();
      } catch (error) {
        console.error('Error parsing Excel:', error);
        toast.error(`Error al procesar el archivo de ${bankName}: ${error.message}`);
      } finally {
        setLoading(false);
      }
    };

    reader.onerror = () => {
      toast.error('Error al leer el archivo. Intente nuevamente.');
      setLoading(false);
    };

    reader.readAsArrayBuffer(selectedFile);
    // Reset input so the same file can be re-uploaded if needed
    e.target.value = '';
  };

  // ── Delete Cartola ────────────────────────────────────────────────────────
  const handleDeleteStatement = async (statement) => {
    if (!window.confirm(`¿Estás seguro de eliminar la cartola "${statement.filename}"? Esto borrará ${statement.movementsCount} movimientos asociados y desenlazará las facturas correspondientes.`)) return;
    
    setLoading(true);
    try {
      // 1. Delete all bank movements that belong to this statement
      const q = query(collection(db, 'bank_movements'), where('statementId', '==', statement.id));
      const snap = await getDocs(q);
      
      const batch = writeBatch(db);
      snap.docs.forEach((d) => {
        batch.delete(doc(db, 'bank_movements', d.id));
      });
      // 2. Delete the statement itself
      batch.delete(doc(db, 'bank_statements', statement.id));
      
      await batch.commit();
      toast.success(`Cartola eliminada y ${snap.size} movimientos borrados.`);
      
      await fetchMovements();
      await fetchBankStatements();
    } catch (e) {
      console.error('Error deleting statement:', e);
      toast.error('Error al eliminar la cartola.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm('¿ELIMINAR TODO? Esta acción borrará TODOS los movimientos bancarios y el historial de cartolas de la base de datos. Esta acción no se puede deshacer.')) return;
    
    setLoading(true);
    try {
      const batch = writeBatch(db);
      
      // Delete all movements
      const movsSnap = await getDocs(collection(db, 'bank_movements'));
      movsSnap.docs.forEach(d => batch.delete(d.ref));
      
      // Delete all statements
      const statesSnap = await getDocs(collection(db, 'bank_statements'));
      statesSnap.docs.forEach(d => batch.delete(d.ref));
      
      await batch.commit();
      toast.success('Base de datos de conciliación limpiada.');
      setMovements([]);
      setBankStatements([]);
      setSuggestions({});
      setMatches([]);
    } catch (e) {
      console.error('Error deleting all data:', e);
      toast.error('Error al limpiar la base de datos.');
    } finally {
      setLoading(false);
    }
  };

  // ── Smart Matching ────────────────────────────────────────────────────────
  const runSmartMatching = useCallback((bankMovements, invoices) => {
    const newSuggestions = {};
    const autoMatches    = [];

    bankMovements.forEach((mov) => {
      if (matches.some((m) => m.movement.id === mov.id)) return;

      const scored = [];

      invoices.forEach((inv) => {
        if (matches.some((m) => m.invoice.id === inv.id)) return;

        let score = 0;
        const reasons = [];

        // 1. Amount: exact ±10 → +50, ±100 → +25
        const amountDiff = Math.abs(Number(inv.totalAmount) - mov.amount);
        if (amountDiff < 10)  { score += 50; reasons.push('Monto exacto'); }
        else if (amountDiff < 100) { score += 25; reasons.push('Monto similar'); }

        // 2. Date proximity
        const movDate = parseDisplayDate(mov.date);
        let invDate   = null;
        if (inv.issueDate) {
          const [y, m, d] = inv.issueDate.split('-').map(Number);
          invDate = new Date(y, m - 1, d);
        } else if (inv.createdAt?.seconds) {
          invDate = new Date(inv.createdAt.seconds * 1000);
        }

        if (movDate && invDate && !isNaN(movDate) && !isNaN(invDate)) {
          const days = Math.abs((movDate - invDate) / 86_400_000);
          if (days <= 5)  { score += 20; reasons.push(`Fecha cercana (${Math.round(days)}d)`); }
          else if (days <= 15) { score += 10; reasons.push(`Fecha próxima (${Math.round(days)}d)`); }
        }

        // 3. Text: client name or project code in bank description
        const descLower   = String(mov.description || '').toLowerCase();
        const clientName  = String(inv.clientName  || '').toLowerCase();
        const projectName = String(inv.projectName || '').toLowerCase();
        let projectCode   = '';
        if (inv.projectId) {
          const proj = projects.find((p) => p.id === inv.projectId);
          if (proj?.code) projectCode = proj.code.toLowerCase();
        }

        if (clientName.length > 2 && descLower.includes(clientName)) {
          score += 30; reasons.push('Nombre cliente en descripción');
        } else if (projectCode.length > 2 && descLower.includes(projectCode)) {
          score += 30; reasons.push('Código proyecto en descripción');
        } else if (projectName.length > 3 && descLower.includes(projectName)) {
          score += 20; reasons.push('Nombre proyecto en descripción');
        }

        if (score > 0) scored.push({ invoice: inv, score, reasons });
      });

      scored.sort((a, b) => b.score - a.score);

      if (scored.length > 0) {
        if (
          scored[0].score >= 70 &&
          (scored.length === 1 || scored[0].score > scored[1].score + 20)
        ) {
          autoMatches.push({
            movement: mov,
            invoice:  scored[0].invoice,
            confidence: 'high',
            reason:   scored[0].reasons.join(' + '),
          });
        }
        const relevant = scored.filter((s) => s.score > 30);
        if (relevant.length > 0) newSuggestions[mov.id] = relevant;
      }
    });

    setSuggestions(prev => {
      const nextStr = JSON.stringify(newSuggestions);
      if (JSON.stringify(prev) === nextStr) return prev;
      return newSuggestions;
    });

    if (autoMatches.length > 0) {
      setMatches((prev) => {
        const existing = new Set(prev.map((m) => m.movement.id));
        const filtered = autoMatches.filter((m) => !existing.has(m.movement.id));
        if (filtered.length === 0) return prev;
        return [...prev, ...filtered];
      });
    }
  }, [projects, matches]);

  // ── Manual match ──────────────────────────────────────────────────────────
  const startManualMatch  = (mov) => { setActiveMovement(mov); setManualMatchOpen(true); };
  const cancelManualMatch = ()    => { setActiveMovement(null); setManualMatchOpen(false); };
  const confirmManualMatch = (invoice) => {
    if (!activeMovement) return;
    setMatches((prev) => [...prev, { movement: activeMovement, invoice, confidence: 'manual', reason: 'Selección Manual' }]);
    cancelManualMatch();
  };
  const confirmSuggestion = (movement, invoice) => {
    setMatches((prev) => [...prev, { movement, invoice, confidence: 'smart', reason: 'Coincidencia Inteligente' }]);
    setExpandedMovement(null);
  };
  const removeMatch = (index) => setMatches((prev) => prev.filter((_, i) => i !== index));

  // ── Confirm reconciliation ────────────────────────────────────────────────
  const handleConfirmMatches = async () => {
    setProcessing(true);
    try {
      const batch = writeBatch(db);

      matches.forEach((m) => {
        const invRef = doc(db, 'invoices', m.invoice.id);
        batch.update(invRef, {
          paymentStatus:    'paid',
          paidAt:           serverTimestamp(),
          paymentReference: `Conciliación: ${m.movement.description}`,
          paymentAmount:    m.movement.amount,
          paymentMetadata:  {
            bank:                   m.movement.bank,
            transactionDate:        m.movement.date,
            transactionDescription: m.movement.description,
            reconciledAt:           new Date().toISOString(),
          },
        });

        if (m.invoice.projectId) {
          batch.update(doc(db, 'projects', m.invoice.projectId), {
            billingStatus:   'paid',
            lastPaymentDate: serverTimestamp(),
          });
        }

        if (m.movement.id) {
          batch.update(doc(db, 'bank_movements', m.movement.id), {
            reconciled:         true,
            reconciledInvoiceId: m.invoice.id,
            reconciledAt:       serverTimestamp(),
          });
        }
      });

      await batch.commit();
      toast.success(`${matches.length} facturas conciliadas exitosamente.`);
      setMatches([]);
      setSuggestions({});
      await fetchPending();
      await fetchMovements();
    } catch (e) {
      console.error('Error confirming matches:', e);
      toast.error('Error al guardar conciliación.');
    } finally {
      setProcessing(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Layout title="Cuenta Corriente Unificada" isFullWidth={true}>
      <div className="flex flex-col gap-6">

        {/* Upload + Cartolas + Summary */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Box 1: Cargar Cartolas y Listado (Span 3) */}
          <div className="lg:col-span-3 bg-white p-6 rounded-2xl shadow-soft border border-slate-100 flex flex-col sm:flex-row gap-6">
            
            {/* Upload Section */}
            <div className="flex-1">
              <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                <Upload className="w-5 h-5 text-indigo-600" /> Cargar Cartolas
              </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {['Itaú', 'Santander'].map((bank) => {
                const colors = bank === 'Itaú'
                  ? { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', icon: 'text-orange-500' }
                  : { bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-700',    icon: 'text-red-500'    };
                return (
                  <div
                    key={bank}
                    className={`border-2 border-dashed rounded-xl p-4 text-center transition cursor-pointer relative group border-slate-200 hover:${colors.bg}`}
                  >
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={(e) => handleFileUpload(e, bank)}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      title={`Cargar Cartola ${bank}`}
                    />
                    <div className="flex items-center justify-center gap-2">
                        <FileSpreadsheet className={`w-5 h-5 ${colors.icon}`} />
                        <span className={`font-bold text-slate-600 text-sm`}>Sincronizar {bank}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {loading && <p className="text-center text-sm text-indigo-600 mt-3 font-medium animate-pulse">Procesando...</p>}
            </div>

            {/* Listado de Cartolas Cargadas (New Feature) */}
            <div className="flex-1 flex flex-col border-t sm:border-t-0 sm:border-l border-slate-100 pt-6 sm:pt-0 sm:pl-6">
              <h3 className="font-bold text-slate-800 mb-3 text-sm flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-slate-400" /> Últimas Cartolas Cargadas
              </h3>
              <div className="flex-1 min-h-[100px] max-h-[140px] overflow-y-auto space-y-2 pr-1">
                {bankStatements.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No hay cartolas recientes.</p>
                ) : (
                  bankStatements.map((st) => (
                    <div key={st.id} className="group flex justify-between items-center bg-slate-50 p-2.5 rounded-lg border border-slate-100 hover:border-slate-300 transition-colors">
                      <div className="min-w-0 mr-2">
                        <p className="font-bold text-xs text-slate-700 truncate" title={st.filename}>{st.filename}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          {st.bank} • {st.movementsCount} movs • {st.uploadedAt?.seconds ? new Date(st.uploadedAt.seconds * 1000).toLocaleDateString() : ''}
                        </p>
                      </div>
                      <button 
                        onClick={() => handleDeleteStatement(st)}
                        className="p-1.5 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-md transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                        title="Eliminar cartola y sus movimientos"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Box 2: Summary (Span 1) */}
          <div className="lg:col-span-1 bg-white p-6 rounded-2xl shadow-soft border border-slate-100 flex flex-col justify-center">
            <h3 className="font-bold text-slate-800 mb-3">Resumen</h3>
            <div className="space-y-3 text-sm">
              {[
                ['Facturas Pendientes', pendingInvoices.length, ''],
                ['Movimientos', movements.length, ''],
                ['Conciliaciones', matches.length, 'text-green-600'],
                ['Sugerencias', Object.keys(suggestions).length, 'text-amber-600'],
              ].map(([label, value, cls]) => (
                <div key={label} className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">{label}:</span>
                  <span className={`font-bold ${cls}`}>{value}</span>
                </div>
              ))}
            </div>
            
            <button 
              onClick={handleDeleteAll}
              className="mt-4 text-[10px] text-slate-400 hover:text-red-500 font-bold uppercase tracking-wider flex items-center justify-center gap-1 transition-colors"
            >
              <Trash2 className="w-3 h-3" /> Limpiar Todo (Pruebas)
            </button>
          </div>
        </div>

        {/* Confirmed matches */}
        {matches.length > 0 && (
          <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-green-50/50">
              <div>
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" /> Conciliaciones Sugeridas
                </h3>
                <p className="text-xs text-slate-500 mt-1">Revisa y confirma los pagos detectados.</p>
              </div>
              <button
                onClick={handleConfirmMatches}
                disabled={processing}
                className="bg-green-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-green-700 transition flex items-center gap-2 shadow-sm"
              >
                {processing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Confirmar Conciliación
              </button>
            </div>

            <div className="divide-y divide-slate-100">
              {matches.map((match, idx) => (
                <div key={idx} className="p-4 flex flex-col md:flex-row items-center gap-4 hover:bg-slate-50 transition relative group">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-400 uppercase font-bold mb-1">Movimiento Banco</p>
                    <p className="font-bold text-slate-800 text-sm truncate">{match.movement.description}</p>
                    <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${match.movement.bank === 'Itaú' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'}`}>
                      {match.movement.bank}
                    </span>
                    <p className="text-green-600 font-mono font-bold mt-1">+ {formatCurrency(match.movement.amount)}</p>
                    <p className="text-xs text-slate-400 mt-1">{match.movement.date}</p>
                  </div>

                  <div className="flex flex-col items-center gap-1 flex-shrink-0">
                    <ArrowRight className="text-slate-300 w-5 h-5" />
                    <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full ${
                      match.confidence === 'high'   ? 'bg-green-100 text-green-700' :
                      match.confidence === 'smart'  ? 'bg-blue-100 text-blue-700'  :
                                                      'bg-slate-100 text-slate-600'
                    }`}>
                      {match.reason || match.confidence}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-400 uppercase font-bold mb-1">Factura Detectada</p>
                    <p className="font-bold text-slate-800 text-sm truncate">{match.invoice.clientName}</p>
                    <p className="text-indigo-600 text-xs truncate mb-1">{match.invoice.projectName}</p>
                    <p className="text-slate-800 font-bold">{formatCurrency(match.invoice.totalAmount)}</p>
                  </div>

                  <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition">
                    <button onClick={() => removeMatch(idx)} className="text-red-400 hover:text-red-600 p-2 hover:bg-red-50 rounded-lg" title="Rechazar coincidencia">
                      <AlertTriangle className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Data workspaces */}
        {/* Adjusted grid layout: 12 cols total -> 9 for bank, 3 for invoices */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-[calc(100vh-320px)] min-h-[600px]">

          {/* Movements table */}
          <div className="lg:col-span-9 bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden flex flex-col h-full">
            <div className="p-4 border-b border-slate-100 bg-slate-50 sticky top-0 z-10">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-slate-500" /> Movimientos Bancarios
              </h3>
              <p className="text-xs text-slate-500">Persistidos en Firestore · Itaú y Santander</p>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-500 font-medium sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3">Banco</th>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3">Descripción</th>
                    <th className="px-4 py-3 text-right">Monto</th>
                    <th className="px-4 py-3 text-center">Estado</th>
                    <th className="px-4 py-3 text-center">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingMovements ? (
                    <tr><td colSpan="6" className="px-4 py-10 text-center text-slate-400 text-sm animate-pulse">Cargando movimientos...</td></tr>
                  ) : movements.length === 0 ? (
                    <tr><td colSpan="6" className="px-4 py-10 text-center text-slate-400">Sube archivos para ver movimientos.</td></tr>
                  ) : (
                    movements.map((mov, i) => {
                      const isMatched     = matches.some((m) => m.movement.id === mov.id) || mov.reconciled;
                      const movSuggestions = suggestions[mov.id] || [];
                      const isExpanded    = expandedMovement === mov.id;

                      return (
                        <tr key={mov.id || i} className="group">
                          <td colSpan="6" className="p-0">
                            <div className={`flex items-center transition ${
                              manualMatchOpen && activeMovement?.id === mov.id
                                ? 'bg-indigo-50 border-l-4 border-indigo-600 shadow-inner'
                                : manualMatchOpen ? 'opacity-40 grayscale'
                                : isMatched ? 'bg-green-50/50'
                                : 'hover:bg-slate-50'
                            }`}>
                              <div className="px-4 py-3 w-24 shrink-0">
                                <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded-full ${mov.bank === 'Itaú' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'}`}>
                                  {mov.bank}
                                </span>
                              </div>
                              <div className="px-4 py-3 text-slate-600 w-24 shrink-0">{mov.date}</div>
                              <div className="px-4 py-3 text-slate-700 flex-1 min-w-0 truncate" title={mov.description}>{mov.description}</div>
                              <div className="px-4 py-3 text-right font-bold text-green-600 font-mono w-32 shrink-0">
                                + {formatCurrency(mov.amount)}
                              </div>
                              <div className="px-4 py-3 text-center w-20 shrink-0">
                                {isMatched && <CheckCircle className="w-4 h-4 text-green-500 mx-auto" />}
                              </div>
                              <div className="px-4 py-3 text-center w-24 shrink-0 flex items-center justify-center gap-1">
                                {!isMatched && (
                                  <>
                                    <button onClick={() => startManualMatch(mov)} className="text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 p-1.5 rounded-full transition" title="Enlazar manualmente">
                                      <Link className="w-4 h-4" />
                                    </button>
                                    {movSuggestions.length > 0 && (
                                      <button
                                        onClick={() => setExpandedMovement(isExpanded ? null : mov.id)}
                                        className={`p-1.5 rounded-full transition ${isExpanded ? 'bg-amber-100 text-amber-700' : 'text-amber-500 hover:text-amber-700 hover:bg-amber-50'}`}
                                        title={`${movSuggestions.length} facturas sugeridas`}
                                      >
                                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>

                            {isExpanded && movSuggestions.length > 0 && (
                              <div className="bg-amber-50/50 border-t border-amber-100 px-6 py-3">
                                <p className="text-[10px] uppercase font-bold text-amber-700 tracking-wider mb-2">Facturas Sugeridas ({movSuggestions.length})</p>
                                <div className="space-y-2">
                                  {movSuggestions.map((sug, sIdx) => (
                                    <div key={sIdx} className="flex items-center justify-between bg-white p-3 rounded-xl border border-amber-200 hover:border-indigo-300 hover:shadow-sm transition">
                                      <div className="flex-1 min-w-0">
                                        <p className="font-bold text-sm text-slate-800 truncate">{sug.invoice.clientName}</p>
                                        <p className="text-xs text-slate-500 truncate">{sug.invoice.projectName}</p>
                                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                                          <span className="font-bold text-sm text-slate-700">{formatCurrency(sug.invoice.totalAmount)}</span>
                                          <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full ${sug.score >= 70 ? 'bg-green-100 text-green-700' : sug.score >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                                            {sug.score} pts
                                          </span>
                                          {sug.reasons.map((r, ri) => (<span key={ri} className="text-[9px] text-slate-400">{r}</span>))}
                                        </div>
                                      </div>
                                      <button onClick={() => confirmSuggestion(mov, sug.invoice)} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-indigo-700 transition shrink-0 ml-3">
                                        Vincular
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pending invoices */}
          <div className="lg:col-span-3 bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden flex flex-col h-full">
            <div className="p-4 border-b border-slate-100 bg-slate-50 sticky top-0 z-10">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-slate-500" /> Facturas Emitidas (Por Cobrar)
              </h3>
              <p className="text-xs text-slate-500">Documentos pendientes de pago</p>
            </div>
            <div className="overflow-y-auto p-4 space-y-3 flex-1 relative">
              {manualMatchOpen && activeMovement && (
                <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 text-white p-4 rounded-xl shadow-lg border border-indigo-400/30 sticky top-0 z-20 mb-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-[10px] uppercase font-bold tracking-wider opacity-80 mb-1">Seleccionando factura para:</p>
                      <p className="font-bold text-sm truncate max-w-[180px]">{activeMovement.description}</p>
                      <p className="font-mono text-xl font-bold mt-1">+ {formatCurrency(activeMovement.amount)}</p>
                    </div>
                    <button onClick={cancelManualMatch} className="bg-white/20 hover:bg-white/30 text-white p-1.5 rounded-lg transition">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              )}

              {pendingInvoices.length === 0 ? (
                <p className="text-center text-slate-400 text-sm py-10">No hay facturas pendientes.</p>
              ) : (
                [...pendingInvoices]
                  .sort((a, b) => {
                    if (manualMatchOpen && activeMovement) {
                      return Math.abs(Number(a.totalAmount) - activeMovement.amount) -
                             Math.abs(Number(b.totalAmount) - activeMovement.amount);
                    }
                    return 0;
                  })
                  .map((inv, i) => {
                    const isMatched       = matches.some((m) => m.invoice.id === inv.id);
                    const isExactCandidate = manualMatchOpen && activeMovement && Math.abs(Number(inv.totalAmount) - activeMovement.amount) < 100;
                    let cls = 'p-3 rounded-lg border transition duration-200 relative ';
                    if (manualMatchOpen) {
                      cls += 'cursor-pointer hover:ring-2 hover:ring-indigo-500 hover:shadow-md ';
                      cls += isExactCandidate ? 'bg-indigo-50 border-indigo-500 shadow-md ring-1 ring-indigo-200 ' : 'bg-white border-slate-200 opacity-90 ';
                    } else {
                      cls += isMatched ? 'bg-green-50 border-green-200 opacity-60 cursor-default ' : 'bg-white border-slate-100 hover:border-slate-300 hover:shadow-sm cursor-pointer ';
                    }
                    return (
                      <div key={i} className={cls} onClick={() => manualMatchOpen ? confirmManualMatch(inv) : (setSelectedInvoice(inv), setIsModalOpen(true))}>
                        {isExactCandidate && (
                          <span className="absolute -top-2 -right-2 bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm animate-bounce">Coincidencia</span>
                        )}
                        <div className="flex justify-between items-start mb-1">
                          <span className="text-xs font-bold text-indigo-600 truncate max-w-[150px]">{inv.clientName}</span>
                          <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                            {inv.createdAt?.seconds ? new Date(inv.createdAt.seconds * 1000).toLocaleDateString() : 'N/A'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 truncate mb-2">{inv.projectName}</p>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-800 font-bold text-sm">{formatCurrency(inv.totalAmount)}</span>
                          {isMatched && <span className="text-[10px] font-bold text-green-600 flex items-center"><CheckCircle className="w-3 h-3 mr-1" /> Matched</span>}
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>

        </div>
      </div>

      <InvoiceDetailModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        invoice={selectedInvoice}
        onUpdate={fetchPending}
      />
    </Layout>
  );
}
