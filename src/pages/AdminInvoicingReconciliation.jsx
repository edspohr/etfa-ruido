import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import {
  Upload, FileSpreadsheet, CheckCircle, AlertTriangle, ArrowRight,
  Save, RefreshCw, X, Link, ChevronDown, ChevronUp, AlertCircle, Trash2,
  Search, Filter, Info, Zap, Eye
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

// Parse "DD/MM/YYYY" → Date object
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

  // Filters
  const [movementFilter, setMovementFilter] = useState('all'); // all, credits, debits, unreconciled
  const [movementSearch, setMovementSearch] = useState('');

  // ── Smart Matching ────────────────────────────────────────────────────────
  const runSmartMatching = useCallback((bankMovements, invoices, currentMatches) => {
    const newSuggestions = {};
    const autoMatches    = [];

    bankMovements.forEach((mov) => {
      if (currentMatches.some((m) => m.movement.id === mov.id)) return;
      if (mov.reconciled) return;
      if (mov.amount <= 0) return;

      const scored = [];

      invoices.forEach((inv) => {
        if (currentMatches.some((m) => m.invoice.id === inv.id)) return;

        let score = 0;
        const reasons = [];

        // 1. Amount matching
        const invAmount = Number(inv.totalAmount) || 0;
        const amountDiff = Math.abs(invAmount - mov.amount);
        const amountPct = invAmount > 0 ? amountDiff / invAmount * 100 : 100;
        
        if (amountDiff < 10)        { score += 50; reasons.push('Monto exacto'); }
        else if (amountDiff < 100)  { score += 35; reasons.push('Monto similar (±$100)'); }
        else if (amountPct < 1)     { score += 25; reasons.push('Monto ~1% diferencia'); }
        else if (amountPct < 5)     { score += 10; reasons.push('Monto ~5% diferencia'); }

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
          if (days <= 3)       { score += 25; reasons.push(`${Math.round(days)}d diferencia`); }
          else if (days <= 7)  { score += 15; reasons.push(`${Math.round(days)}d diferencia`); }
          else if (days <= 30) { score += 5;  reasons.push(`${Math.round(days)}d diferencia`); }
        }

        // 3. Text matching
        const descLower   = String(mov.description || '').toLowerCase();
        const clientName  = String(inv.clientName  || '').toLowerCase();
        const projectName = String(inv.projectName || '').toLowerCase();
        let projectCode   = '';
        if (inv.projectId) {
          const proj = projects.find((p) => p.id === inv.projectId);
          if (proj?.code) projectCode = proj.code.toLowerCase();
        }

        if (clientName.length > 3 && descLower.includes(clientName)) {
          score += 30; reasons.push('Cliente en descripción');
        }
        if (projectCode.length > 2 && descLower.includes(projectCode)) {
          score += 25; reasons.push('Código proyecto');
        }
        if (projectName.length > 4 && descLower.includes(projectName)) {
          score += 15; reasons.push('Nombre proyecto');
        }

        // Check for RUT in description
        if (inv.clientRut) {
          const cleanRut = inv.clientRut.replace(/[.\-\s]/g, '');
          if (cleanRut.length > 5 && descLower.includes(cleanRut.toLowerCase())) {
            score += 35; reasons.push('RUT en descripción');
          }
        }

        if (score > 0) scored.push({ invoice: inv, score, reasons });
      });

      scored.sort((a, b) => b.score - a.score);

      if (scored.length > 0) {
        // Auto-match: high confidence + clear winner
        if (
          scored[0].score >= 70 &&
          (scored.length === 1 || scored[0].score > scored[1].score + 15)
        ) {
          autoMatches.push({
            movement: mov,
            invoice:  scored[0].invoice,
            confidence: 'high',
            reason:   scored[0].reasons.join(' + '),
          });
        }
        const relevant = scored.filter((s) => s.score > 20);
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
  }, [projects]);

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
      runSmartMatching(movements, pendingInvoices, matches);
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
      const snapshot = await getDocs(collection(db, 'bank_statements'));
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

        const firstBytes = new Uint8Array(arrayBuffer.slice(0, 100));
        const headerStr  = String.fromCharCode(...firstBytes).toLowerCase();
        const isHtml     = headerStr.includes('<html') || headerStr.includes('<table') || headerStr.includes('<!doctype');

        try {
          workbook = XLSX.read(arrayBuffer, { type: 'array', raw: isHtml });
        } catch {
          try {
            workbook = XLSX.read(arrayBuffer, { type: 'array', raw: true });
          } catch {
            toast.error(`Formato no reconocido para ${bankName}. Exporta como Excel (.xlsx).`);
            setLoading(false);
            return;
          }
        }

        const wsname = workbook.SheetNames[0];
        const ws     = workbook.Sheets[wsname];
        const rows   = XLSX.utils.sheet_to_json(ws, { header: 1 });

        const { movements: parsed, warnings, errors } = parseBankData(rows, bankName);

        errors.forEach((msg)   => toast.error(msg,   { duration: 8000 }));
        warnings.forEach((msg) => toast.warning(msg, { duration: 6000 }));

        if (parsed.length === 0) {
          setLoading(false);
          return;
        }

        const batch = writeBatch(db);
        let newCount  = 0;
        let dupeCount = 0;

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
          newCount++;
        }

        if (newCount > 0) {
          batch.set(statementDocRef, {
            filename: selectedFile.name,
            bank: bankName,
            movementsCount: newCount,
            uploadedAt: serverTimestamp()
          });
          await batch.commit();
        }

        if (newCount > 0) {
          toast.success(`${newCount} movimientos de ${bankName}.${dupeCount > 0 ? ` (${dupeCount} duplicados)` : ''}`);
        } else if (dupeCount > 0) {
          toast.info(`Todos los movimientos de ${bankName} ya estaban cargados.`);
        }

        await fetchMovements();
        await fetchBankStatements();
      } catch (error) {
        console.error('Error parsing Excel:', error);
        toast.error(`Error: ${error.message}`);
      } finally {
        setLoading(false);
      }
    };

    reader.onerror = () => { toast.error('Error al leer el archivo.'); setLoading(false); };
    reader.readAsArrayBuffer(selectedFile);
    e.target.value = '';
  };

  // ── Delete Cartola ────────────────────────────────────────────────────────
  const handleDeleteStatement = async (statement) => {
    if (!window.confirm(`¿Eliminar "${statement.filename}" y sus ${statement.movementsCount} movimientos?`)) return;
    
    setLoading(true);
    try {
      const q = query(collection(db, 'bank_movements'), where('statementId', '==', statement.id));
      const snap = await getDocs(q);
      
      const docsArr = snap.docs;
      for (let i = 0; i < docsArr.length; i += 500) {
        const batch = writeBatch(db);
        docsArr.slice(i, i + 500).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }

      const batchFinal = writeBatch(db);
      batchFinal.delete(doc(db, 'bank_statements', statement.id));
      await batchFinal.commit();
      
      toast.success(`Cartola eliminada (${snap.size} movimientos).`);
      await fetchMovements();
      await fetchBankStatements();
    } catch (e) {
      console.error('Error deleting statement:', e);
      toast.error('Error al eliminar.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm('¿ELIMINAR TODOS los movimientos y cartolas?')) return;
    setLoading(true);
    try {
      for (const col of ['bank_movements', 'bank_statements']) {
        const snap = await getDocs(collection(db, col));
        for (let i = 0; i < snap.docs.length; i += 500) {
          const batch = writeBatch(db);
          snap.docs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      }
      toast.success('Base de conciliación limpiada.');
      setMovements([]); setBankStatements([]); setSuggestions({}); setMatches([]);
    } catch (e) { toast.error('Error.'); } finally { setLoading(false); }
  };

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
    if (matches.length === 0) return;
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

        if (m.invoice.projectId && m.invoice.projectId !== 'multi' && m.invoice.projectId !== 'manual') {
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
      toast.success(`${matches.length} facturas conciliadas.`);
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

  // ── Filtered movements ────────────────────────────────────────────────────
  const filteredMovements = movements.filter(mov => {
    // Filter by type
    if (movementFilter === 'credits' && mov.amount <= 0) return false;
    if (movementFilter === 'debits' && mov.amount >= 0) return false;
    if (movementFilter === 'unreconciled' && (mov.reconciled || matches.some(m => m.movement.id === mov.id))) return false;
    
    // Search
    if (movementSearch) {
      const search = movementSearch.toLowerCase();
      const desc = String(mov.description || '').toLowerCase();
      const date = String(mov.date || '');
      const amountStr = String(mov.amount);
      if (!desc.includes(search) && !date.includes(search) && !amountStr.includes(search)) return false;
    }
    
    return true;
  });

  // Stats
  const totalCredits = movements.filter(m => m.amount > 0).reduce((s, m) => s + m.amount, 0);
  const totalDebits = movements.filter(m => m.amount < 0).reduce((s, m) => s + Math.abs(m.amount), 0);
  const unreconciledCredits = movements.filter(m => m.amount > 0 && !m.reconciled && !matches.some(mt => mt.movement.id === m.id)).reduce((s, m) => s + m.amount, 0);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Layout title="Conciliación Bancaria" isFullWidth={true}>
      <div className="flex flex-col gap-6">

        {/* Upload + Stats */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Upload Section */}
          <div className="lg:col-span-4 bg-white p-6 rounded-2xl shadow-soft border border-slate-100">
            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Upload className="w-5 h-5 text-indigo-600" /> Cargar Cartolas
            </h3>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {['Itaú', 'Santander'].map((bank) => {
                const colors = bank === 'Itaú'
                  ? { bg: 'hover:bg-orange-50', icon: 'text-orange-500', border: 'border-orange-200' }
                  : { bg: 'hover:bg-red-50',    icon: 'text-red-500',    border: 'border-red-200' };
                return (
                  <div key={bank} className={`border-2 border-dashed rounded-xl p-4 text-center transition cursor-pointer relative group border-slate-200 ${colors.bg}`}>
                    <input type="file" accept=".xlsx,.xls" onChange={(e) => handleFileUpload(e, bank)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                    <FileSpreadsheet className={`w-5 h-5 mx-auto mb-1 ${colors.icon}`} />
                    <span className="font-bold text-slate-600 text-xs">{bank}</span>
                  </div>
                );
              })}
            </div>
            {loading && <p className="text-center text-sm text-indigo-600 animate-pulse">Procesando...</p>}

            {/* Cartolas List */}
            <div className="border-t border-slate-100 pt-4 mt-2">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Cartolas Cargadas</h4>
              <div className="max-h-[120px] overflow-y-auto space-y-1.5">
                {bankStatements.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">Ninguna</p>
                ) : bankStatements.map((st) => (
                  <div key={st.id} className="group flex justify-between items-center bg-slate-50 p-2 rounded-lg border border-slate-100 hover:border-slate-300 transition">
                    <div className="min-w-0 mr-2">
                      <p className="font-bold text-[11px] text-slate-700 truncate">{st.filename}</p>
                      <p className="text-[10px] text-slate-500">{st.bank} • {st.movementsCount} movs</p>
                    </div>
                    <button onClick={() => handleDeleteStatement(st)} className="p-1 text-slate-300 hover:text-red-600 rounded transition opacity-0 group-hover:opacity-100">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="lg:col-span-8 grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Facturas Pendientes" value={pendingInvoices.length} color="amber" />
            <StatCard label="Movimientos" value={movements.length} sublabel={`${movements.filter(m => m.amount > 0).length} abonos`} color="slate" />
            <StatCard label="Conciliaciones" value={matches.length} color="emerald" />
            <StatCard label="Créditos sin Conciliar" value={formatCurrency(unreconciledCredits)} color="indigo" />
          </div>
        </div>

        {/* Confirmed matches */}
        {matches.length > 0 && (
          <div className="bg-white rounded-2xl shadow-soft border border-emerald-200 overflow-hidden">
            <div className="p-4 border-b border-emerald-100 flex justify-between items-center bg-emerald-50/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-100 rounded-lg">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800">{matches.length} Conciliaciones Listas</h3>
                  <p className="text-xs text-slate-500">Revisa y confirma los pagos detectados.</p>
                </div>
              </div>
              <button
                onClick={handleConfirmMatches}
                disabled={processing}
                className="bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-emerald-700 transition flex items-center gap-2 shadow-md hover:shadow-lg active:scale-95"
              >
                {processing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Confirmar Todo
              </button>
            </div>

            <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto">
              {matches.map((match, idx) => (
                <div key={idx} className="p-4 flex flex-col md:flex-row items-center gap-4 hover:bg-slate-50/50 transition relative group">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <BankBadge bank={match.movement.bank} />
                      <span className="text-xs text-slate-400">{match.movement.date}</span>
                    </div>
                    <p className="font-bold text-slate-800 text-sm truncate">{match.movement.description}</p>
                    <p className="font-mono font-bold text-emerald-600 text-sm">+{formatCurrency(match.movement.amount)}</p>
                  </div>

                  <div className="flex flex-col items-center gap-1 flex-shrink-0 px-4">
                    <ArrowRight className="text-emerald-400 w-5 h-5" />
                    <ConfidenceBadge confidence={match.confidence} reason={match.reason} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 text-sm truncate">{match.invoice.clientName}</p>
                    <p className="text-indigo-600 text-xs truncate">{match.invoice.projectName}</p>
                    <p className="text-slate-800 font-bold text-sm">{formatCurrency(match.invoice.totalAmount)}</p>
                  </div>

                  <button onClick={() => removeMatch(idx)} className="flex-shrink-0 p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition opacity-0 group-hover:opacity-100">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Main Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[600px]">

          {/* Movements Table */}
          <div className="lg:col-span-9 bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-slate-500" /> Movimientos Bancarios
                </h3>
                <p className="text-xs text-slate-500">{filteredMovements.length} de {movements.length} movimientos</p>
              </div>
              <div className="flex gap-2 items-center">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar..."
                    value={movementSearch}
                    onChange={e => setMovementSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none w-48"
                  />
                </div>
                <select
                  value={movementFilter}
                  onChange={e => setMovementFilter(e.target.value)}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="all">Todos</option>
                  <option value="credits">Solo Abonos</option>
                  <option value="debits">Solo Cargos</option>
                  <option value="unreconciled">Sin Conciliar</option>
                </select>
              </div>
            </div>

            <div className="overflow-auto flex-1">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-500 font-medium sticky top-0 z-10 text-xs">
                  <tr>
                    <th className="px-4 py-2.5">Banco</th>
                    <th className="px-4 py-2.5">Fecha</th>
                    <th className="px-4 py-2.5">Descripción</th>
                    <th className="px-4 py-2.5 text-right">Monto</th>
                    <th className="px-4 py-2.5 text-center w-20">Estado</th>
                    <th className="px-4 py-2.5 text-center w-24">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {loadingMovements ? (
                    <tr><td colSpan="6" className="px-4 py-10 text-center text-slate-400 text-sm animate-pulse">Cargando...</td></tr>
                  ) : filteredMovements.length === 0 ? (
                    <tr><td colSpan="6" className="px-4 py-10 text-center text-slate-400 text-sm">
                      {movements.length === 0 ? 'Sube cartolas para ver movimientos.' : 'No hay movimientos con los filtros aplicados.'}
                    </td></tr>
                  ) : (
                    filteredMovements.map((mov, i) => {
                      const isMatched     = matches.some((m) => m.movement.id === mov.id) || mov.reconciled;
                      const movSuggestions = suggestions[mov.id] || [];
                      const isExpanded    = expandedMovement === mov.id;
                      const isActiveManual = manualMatchOpen && activeMovement?.id === mov.id;

                      return (
                        <tr key={mov.id || i}>
                          <td colSpan="6" className="p-0">
                            <div className={`flex items-center text-sm transition ${
                              isActiveManual ? 'bg-indigo-50 border-l-4 border-indigo-600' :
                              manualMatchOpen ? 'opacity-30' :
                              isMatched ? 'bg-emerald-50/40' :
                              'hover:bg-slate-50'
                            }`}>
                              <div className="px-4 py-2.5 w-24 shrink-0">
                                <BankBadge bank={mov.bank} />
                              </div>
                              <div className="px-4 py-2.5 text-slate-500 w-24 shrink-0 text-xs">{mov.date}</div>
                              <div className="px-4 py-2.5 text-slate-700 flex-1 min-w-0 truncate text-xs" title={mov.description}>{mov.description}</div>
                              <div className={`px-4 py-2.5 text-right font-bold font-mono w-32 shrink-0 text-xs ${mov.amount >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                {mov.amount >= 0 ? '+' : ''}{formatCurrency(mov.amount)}
                              </div>
                              <div className="px-4 py-2.5 text-center w-20 shrink-0">
                                {isMatched && <CheckCircle className="w-4 h-4 text-emerald-500 mx-auto" />}
                              </div>
                              <div className="px-4 py-2.5 text-center w-24 shrink-0 flex items-center justify-center gap-1">
                                {!isMatched && mov.amount > 0 && (
                                  <>
                                    <button onClick={() => startManualMatch(mov)} className="text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 p-1.5 rounded-full transition" title="Enlazar">
                                      <Link className="w-3.5 h-3.5" />
                                    </button>
                                    {movSuggestions.length > 0 && (
                                      <button
                                        onClick={() => setExpandedMovement(isExpanded ? null : mov.id)}
                                        className={`p-1.5 rounded-full transition relative ${isExpanded ? 'bg-amber-100 text-amber-700' : 'text-amber-500 hover:bg-amber-50'}`}
                                        title={`${movSuggestions.length} sugerencias`}
                                      >
                                        <Zap className="w-3.5 h-3.5" />
                                        <span className="absolute -top-1 -right-1 bg-amber-500 text-white text-[8px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center">
                                          {movSuggestions.length}
                                        </span>
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Suggestions Expansion */}
                            {isExpanded && movSuggestions.length > 0 && (
                              <div className="bg-amber-50/50 border-t border-amber-100 px-6 py-3">
                                <p className="text-[10px] uppercase font-bold text-amber-700 tracking-wider mb-2">
                                  Facturas Sugeridas ({movSuggestions.length})
                                </p>
                                <div className="space-y-2">
                                  {movSuggestions.map((sug, sIdx) => (
                                    <div key={sIdx} className="flex items-center justify-between bg-white p-3 rounded-xl border border-amber-200 hover:border-indigo-300 hover:shadow-sm transition">
                                      <div className="flex-1 min-w-0">
                                        <p className="font-bold text-sm text-slate-800 truncate">{sug.invoice.clientName}</p>
                                        <p className="text-xs text-slate-500 truncate">{sug.invoice.projectName}</p>
                                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                                          <span className="font-bold text-sm text-slate-700">{formatCurrency(sug.invoice.totalAmount)}</span>
                                          <ScoreBadge score={sug.score} />
                                          {sug.reasons.slice(0, 3).map((r, ri) => (
                                            <span key={ri} className="text-[9px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{r}</span>
                                          ))}
                                        </div>
                                      </div>
                                      <button onClick={() => confirmSuggestion(mov, sug.invoice)} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-indigo-700 transition shrink-0 ml-3 active:scale-95">
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

          {/* Pending Invoices */}
          <div className="lg:col-span-3 bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-100 bg-slate-50">
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-slate-500" /> Facturas Pendientes
              </h3>
              <p className="text-[10px] text-slate-500 mt-0.5">{pendingInvoices.length} documentos</p>
            </div>
            <div className="overflow-y-auto p-3 space-y-2 flex-1 relative">
              {manualMatchOpen && activeMovement && (
                <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 text-white p-3 rounded-xl shadow-lg sticky top-0 z-20 mb-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-[9px] uppercase font-bold tracking-wider opacity-80">Selecciona factura para:</p>
                      <p className="font-bold text-xs truncate max-w-[180px] mt-1">{activeMovement.description}</p>
                      <p className="font-mono text-lg font-bold mt-1">+{formatCurrency(activeMovement.amount)}</p>
                    </div>
                    <button onClick={cancelManualMatch} className="bg-white/20 hover:bg-white/30 p-1 rounded-lg transition">
                      <X className="w-4 h-4" />
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
                    
                    return (
                      <div
                        key={i}
                        className={`p-3 rounded-xl border transition relative cursor-pointer ${
                          manualMatchOpen
                            ? `hover:ring-2 hover:ring-indigo-500 ${isExactCandidate ? 'bg-indigo-50 border-indigo-400 ring-1 ring-indigo-200 shadow-md' : 'bg-white border-slate-200 opacity-80'}`
                            : isMatched
                            ? 'bg-emerald-50 border-emerald-200 opacity-50'
                            : 'bg-white border-slate-100 hover:border-slate-300 hover:shadow-sm'
                        }`}
                        onClick={() => manualMatchOpen ? confirmManualMatch(inv) : (setSelectedInvoice(inv), setIsModalOpen(true))}
                      >
                        {isExactCandidate && (
                          <span className="absolute -top-1.5 -right-1.5 bg-indigo-600 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow animate-bounce">Match</span>
                        )}
                        <div className="flex justify-between items-start mb-1">
                          <span className="text-xs font-bold text-indigo-600 truncate max-w-[140px]">{inv.clientName}</span>
                          <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                            {inv.createdAt?.seconds ? new Date(inv.createdAt.seconds * 1000).toLocaleDateString() : '-'}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 truncate mb-1.5">{inv.projectName}</p>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-800 font-bold text-sm">{formatCurrency(inv.totalAmount)}</span>
                          {isMatched && <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />}
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>

        </div>

        {/* Danger Zone */}
        <div className="flex justify-end">
          <button onClick={handleDeleteAll} className="text-[10px] text-slate-400 hover:text-red-500 font-bold uppercase tracking-wider flex items-center gap-1 transition px-3 py-1.5 rounded-lg hover:bg-red-50">
            <Trash2 className="w-3 h-3" /> Limpiar Todo
          </button>
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

// ── Sub-components ──────────────────────────────────────────────────────────

function StatCard({ label, value, sublabel, color = 'slate' }) {
  const colors = {
    amber:   'border-amber-200 bg-amber-50/50',
    slate:   'border-slate-200 bg-slate-50/50',
    emerald: 'border-emerald-200 bg-emerald-50/50',
    indigo:  'border-indigo-200 bg-indigo-50/50',
  };

  return (
    <div className={`p-4 rounded-2xl border ${colors[color]} transition hover:shadow-sm`}>
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-black text-slate-900">{value}</p>
      {sublabel && <p className="text-[10px] text-slate-400 mt-0.5">{sublabel}</p>}
    </div>
  );
}

function BankBadge({ bank }) {
  const colors = bank === 'Itaú'
    ? 'bg-orange-100 text-orange-700'
    : bank === 'Santander'
    ? 'bg-red-100 text-red-700'
    : 'bg-slate-100 text-slate-600';
  return (
    <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full ${colors}`}>
      {bank}
    </span>
  );
}

function ConfidenceBadge({ confidence, reason }) {
  const cls = confidence === 'high'   ? 'bg-emerald-100 text-emerald-700' :
              confidence === 'smart'  ? 'bg-blue-100 text-blue-700'  :
                                        'bg-slate-100 text-slate-600';
  return (
    <span className={`text-[8px] uppercase font-bold px-2 py-0.5 rounded-full ${cls} max-w-[120px] truncate text-center`} title={reason}>
      {reason || confidence}
    </span>
  );
}

function ScoreBadge({ score }) {
  const cls = score >= 70 ? 'bg-emerald-100 text-emerald-700' :
              score >= 50 ? 'bg-amber-100 text-amber-700' :
                            'bg-slate-100 text-slate-600';
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${cls}`}>
      {score}pts
    </span>
  );
}
