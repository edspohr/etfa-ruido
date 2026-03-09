import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { Upload, FileSpreadsheet, CheckCircle, AlertTriangle, ArrowRight, Save, RefreshCw, Search, X, Link, ChevronDown, ChevronUp } from 'lucide-react';
import * as XLSX from 'xlsx';
import { collection, query, where, getDocs, writeBatch, doc, serverTimestamp, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { formatCurrency } from '../utils/format';
import InvoiceDetailModal from '../components/InvoiceDetailModal';
import { toast } from 'sonner';

// Helper: generate a deterministic document ID for a bank movement
const generateMovementId = (bankName, date, amount, description, index) => {
  const sanitize = (s) => String(s || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().substring(0, 40);
  return `${sanitize(bankName)}_${sanitize(date)}_${Math.round(Math.abs(amount))}_${sanitize(description).substring(0, 20)}_${index}`;
};

// Helper: parse DD/MM/YYYY string to Date object
const parseDate = (dateStr) => {
  if (!dateStr || dateStr === 'S/F') return null;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts.map(Number);
  const d = new Date(yyyy, mm - 1, dd);
  return isNaN(d.getTime()) ? null : d;
};

export default function AdminInvoicingReconciliation() {
  const [movements, setMovements] = useState([]);
  const [matches, setMatches] = useState([]); // confirmed/selected matches
  const [pendingInvoices, setPendingInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMovements, setLoadingMovements] = useState(true);
  const [processing, setProcessing] = useState(false);
  
  // Smart matching: scored suggestions per movement
  const [suggestions, setSuggestions] = useState({}); // { movementId: [{ invoice, score, reasons }] }
  const [expandedMovement, setExpandedMovement] = useState(null); // which movement shows its suggestions

  // Modal State
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Manual Match State
  const [manualMatchOpen, setManualMatchOpen] = useState(false);
  const [activeMovement, setActiveMovement] = useState(null);

  // Fetch projects for text matching
  const [projects, setProjects] = useState([]);

  const startManualMatch = (mov) => {
      setActiveMovement(mov);
      setManualMatchOpen(true);
  };

  const cancelManualMatch = () => {
      setActiveMovement(null);
      setManualMatchOpen(false);
  };

  const confirmManualMatch = (invoice) => {
      if (!activeMovement) return;
      
      const newMatch = {
          movement: activeMovement,
          invoice: invoice,
          confidence: 'manual',
          reason: 'Selección Manual'
      };

      setMatches(prev => [...prev, newMatch]);
      cancelManualMatch();
  };

  // Confirm a suggestion as a match
  const confirmSuggestion = (movement, invoice) => {
    const newMatch = {
      movement,
      invoice,
      confidence: 'smart',
      reason: 'Coincidencia Inteligente'
    };
    setMatches(prev => [...prev, newMatch]);
    setExpandedMovement(null);
  };

  // 1. Fetch Pending Invoices & Projects
  const fetchPending = async () => {
      const q = query(collection(db, "invoices"), where("paymentStatus", "==", "pending"));
      const snapshot = await getDocs(q);
      setPendingInvoices(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  // 2. Fetch persisted movements from Firestore
  const fetchMovements = async () => {
    setLoadingMovements(true);
    try {
      const snapshot = await getDocs(collection(db, "bank_movements"));
      const movs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      // Sort by date descending
      movs.sort((a, b) => {
        const dateA = parseDate(a.date);
        const dateB = parseDate(b.date);
        if (!dateA || !dateB) return 0;
        return dateB - dateA;
      });
      setMovements(movs);
    } catch (e) {
      console.error("Error fetching movements:", e);
      toast.error("Error al cargar movimientos bancarios.");
    } finally {
      setLoadingMovements(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      await fetchPending();
      await fetchMovements();
      // Also fetch projects for text matching
      try {
        const qProj = query(collection(db, "projects"), where("status", "!=", "deleted"));
        const snapProj = await getDocs(qProj);
        setProjects(snapProj.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) { console.error("Error fetching projects:", e); }
    };
    init();
  }, []);

  // Re-run smart matching whenever movements or invoices change
  useEffect(() => {
    if (movements.length > 0 && pendingInvoices.length > 0) {
      runSmartMatching(movements, pendingInvoices);
    }
  }, [movements, pendingInvoices]);

  const openInvoiceDetail = (inv) => {
      setSelectedInvoice(inv);
      setIsModalOpen(true);
  };

  // ========================
  // PERSIST MOVEMENTS TO FIRESTORE
  // ========================
  const persistMovements = async (parsedMovements, bankName) => {
    const batch = writeBatch(db);
    let newCount = 0;
    let dupeCount = 0;
    const newMovs = [];

    for (let i = 0; i < parsedMovements.length; i++) {
      const mov = parsedMovements[i];
      const docId = generateMovementId(bankName, mov.date, mov.amount, mov.description, i);
      const docRef = doc(db, "bank_movements", docId);

      // Check if already exists
      const existing = await getDoc(docRef);
      if (existing.exists()) {
        dupeCount++;
        continue;
      }

      const movData = {
        date: mov.date,
        description: String(mov.description || ''),
        amount: mov.amount,
        bank: bankName,
        createdAt: serverTimestamp(),
        reconciled: false,
      };

      batch.set(docRef, movData);
      newMovs.push({ id: docId, ...movData });
      newCount++;
    }

    if (newCount > 0) {
      await batch.commit();
    }

    return { newCount, dupeCount, newMovs };
  };

  // 3. Handle File Upload & Parsing
  const handleFileUpload = (e, bankName) => {
      const selectedFile = e.target.files[0];
      if (!selectedFile) return;

      setLoading(true);

      const reader = new FileReader();
      
      reader.onload = async (evt) => {
          try {
              const arrayBuffer = evt.target.result;

              // Detect HTML-as-XLS: some Chilean banks export HTML tables as .xls
              let workbook;
              try {
                  const firstBytes = new Uint8Array(arrayBuffer.slice(0, 100));
                  const headerStr = String.fromCharCode(...firstBytes).toLowerCase();
                  const isHtml = headerStr.includes('<html') || headerStr.includes('<table') || headerStr.includes('<!doctype');

                  if (isHtml) {
                      workbook = XLSX.read(arrayBuffer, { type: 'array', raw: true });
                  } else {
                      workbook = XLSX.read(arrayBuffer, { type: 'array' });
                  }
              } catch (xlsxErr) {
                  console.error('XLSX.read failed, trying raw mode:', xlsxErr);
                  try {
                      workbook = XLSX.read(arrayBuffer, { type: 'array', raw: true });
                  } catch (rawErr) {
                      console.error('Raw mode also failed:', rawErr);
                      toast.error(`El formato del archivo de ${bankName} no es reconocido. Verifica que sea un Excel válido (.xlsx o .xls) con columnas de Fecha, Descripción y Monto.`);
                      setLoading(false);
                      return;
                  }
              }

              const wsname = workbook.SheetNames[0];
              const ws = workbook.Sheets[wsname];
              const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

              if (!data || data.length < 2) {
                  toast.error(`El archivo de ${bankName} parece estar vacío o no contiene datos válidos.`);
                  setLoading(false);
                  return;
              }

              // Parsing Logic
              const parsedMovements = parseBankData(data, bankName);
              
              if (parsedMovements.length > 0) {
                  // Persist to Firestore (with duplicate detection)
                  const { newCount, dupeCount } = await persistMovements(parsedMovements, bankName);
                  
                  if (newCount > 0) {
                    toast.success(`${newCount} movimientos nuevos guardados de ${bankName}.${dupeCount > 0 ? ` (${dupeCount} duplicados omitidos)` : ''}`);
                  } else if (dupeCount > 0) {
                    toast.info(`Todos los ${dupeCount} movimientos de ${bankName} ya fueron cargados previamente.`);
                  }
                  
                  // Reload from Firestore to get consistent state
                  await fetchMovements();
              } else {
                  toast.warning(`No se encontraron movimientos de ingreso en el archivo de ${bankName}.`);
              }

          } catch (error) {
              console.error("Error parsing Excel:", error);
              toast.error(`Error al procesar el archivo de ${bankName}. Verifica que tenga un formato válido.`);
          } finally {
              setLoading(false);
          }
      };

      reader.onerror = () => {
          console.error("FileReader error");
          toast.error("Error al leer el archivo. Intente nuevamente.");
          setLoading(false);
      };

      try {
          reader.readAsArrayBuffer(selectedFile);
      } catch (error) {
          console.error("Error initiating read:", error);
          toast.error("Error al iniciar la lectura del archivo.");
          setLoading(false);
      }
  };

  const parseBankData = (rows, bankName) => {
      if (!rows || rows.length < 2) {
          toast.error(`El archivo de ${bankName} parece estar vacío o tener formato incorrecto.`);
          return [];
      }

      const cleanStr = (val) => String(val || '').toLowerCase().trim();

      const findCol = (row, keywords) => {
          if (!row) return -1;
          return row.findIndex(cell => {
              const str = cleanStr(cell);
              return keywords.some(k => str === k || str.includes(k));
          });
      };

      let headerRowIndex = -1;
      let dateIdx = -1;
      let descIdx = -1;
      let abonoIdx = -1;
      let montoIdx = -1;

      // 1. Scan for Header Row
      for (let i = 0; i < Math.min(rows.length, 50); i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;

          const dIdx = findCol(row, ['fecha', 'date']);
          const descI = findCol(row, ['descrip', 'detalle', 'concepto', 'movimiento', 'glosa']);
          const aIdx = findCol(row, ['abono', 'deposito', 'credit', 'crédito']);
          let mIdx = findCol(row, ['monto', 'importe', 'valor']); 
          
          if (mIdx !== -1) {
              const headerVal = cleanStr(row[mIdx]);
              if (headerVal.includes('saldo') || headerVal.includes('balance') || headerVal.includes('acumulado')) {
                  mIdx = -1;
              }
          }

          if (dIdx !== -1 && (descI !== -1)) {
              if (aIdx !== -1 || mIdx !== -1) {
                  headerRowIndex = i;
                  dateIdx = dIdx;
                  descIdx = descI;
                  abonoIdx = aIdx;
                  montoIdx = mIdx;
                  break;
              }
          }
      }

      // STRATEGY B: Santander-specific
      if (bankName === 'Santander') {
          let santanderHeaderRowIndex = -1;
          let sDateIdx = -1;
          let sMontoIdx = -1;
          let sDescIdx = -1;

          for (let i = 0; i < Math.min(rows.length, 25); i++) {
             const row = rows[i];
             if (!row) continue;
             const dI = findCol(row, ['fecha']);
             const mI = findCol(row, ['monto', 'importe']);
             const descI = findCol(row, ['descripción', 'descripcion', 'detalle', 'movimiento']);
             
             if (dI !== -1 && (mI !== -1 || descI !== -1)) {
                 santanderHeaderRowIndex = i;
                 sDateIdx = dI;
                 sMontoIdx = mI;
                 sDescIdx = descI;
                 break;
             }
          }

          if (santanderHeaderRowIndex !== -1) {
              const parsedSantander = [];
              
              for (let i = santanderHeaderRowIndex + 1; i < rows.length; i++) {
                  const row = rows[i];
                  if (!row || row.length === 0) continue;

                  let rawAmount = 0;
                  if (sMontoIdx !== -1 && row[sMontoIdx] !== undefined) {
                      rawAmount = row[sMontoIdx];
                  }
                  
                  let finalAmount = 0;
                   if (typeof rawAmount === 'number') {
                      finalAmount = rawAmount;
                  } else if (typeof rawAmount === 'string') {
                      let s = rawAmount.trim();
                      const isNegative = s.includes('(') || s.includes('-');
                      s = s.replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, '');
                      finalAmount = parseFloat(s);
                      if (isNegative) finalAmount = -Math.abs(finalAmount);
                  }

                  if (!finalAmount || isNaN(finalAmount) || finalAmount <= 0) continue;

                  let rawDate = sDateIdx !== -1 ? row[sDateIdx] : null;
                  let finalDate = 'S/F';
                  
                  if (rawDate) {
                      if (typeof rawDate === 'number') {
                           try {
                               const dateObj = XLSX.SSF.parse_date_code(rawDate);
                               const dd = String(dateObj.d).padStart(2, '0');
                               const mm = String(dateObj.m).padStart(2, '0');
                               finalDate = `${dd}/${mm}/${dateObj.y}`;
                           } catch { finalDate = 'Error Fecha'; }
                      } else {
                          const sDate = String(rawDate).trim();
                          if (sDate.match(/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/)) {
                              finalDate = sDate.replace(/-/g, '/');
                          }
                      }
                  }

                  let desc = 'Sin descripción';
                  if (sDescIdx !== -1 && row[sDescIdx]) {
                      desc = String(row[sDescIdx]).trim();
                  }

                  parsedSantander.push({
                       date: finalDate,
                       description: desc,
                       amount: finalAmount,
                       bank: bankName,
                  });
              }
              
              if (parsedSantander.length > 0) return parsedSantander;
          }
      }

      if (headerRowIndex === -1) {
          // FALLBACK: Index-based column detection
          let fallbackHeaderIdx = -1;
          for (let i = 0; i < Math.min(rows.length, 30); i++) {
              const row = rows[i];
              if (!row) continue;
              const nonEmpty = row.filter(cell => cell !== null && cell !== undefined && String(cell).trim() !== '');
              if (nonEmpty.length >= 3) {
                  const firstCell = String(row[0] || '').toLowerCase().trim();
                  const looksLikeHeader = firstCell.includes('fecha') || firstCell.includes('date');
                  const looksLikeDate = /^\d{1,2}[/-]/.test(firstCell) || typeof row[0] === 'number';
                  
                  if (looksLikeHeader) {
                      fallbackHeaderIdx = i;
                      dateIdx = 0;
                      descIdx = 1;
                      for (let c = row.length - 1; c >= 2; c--) {
                          const hdr = cleanStr(row[c]);
                          if (hdr.includes('abono') || hdr.includes('credit') || hdr.includes('monto') || hdr.includes('importe')) {
                              abonoIdx = c;
                              break;
                          }
                      }
                      if (abonoIdx === -1) montoIdx = row.length - 1;
                      headerRowIndex = fallbackHeaderIdx;
                      break;
                  } else if (looksLikeDate && i > 0) {
                      fallbackHeaderIdx = i - 1;
                      dateIdx = 0;
                      descIdx = Math.min(1, row.length - 1);
                      montoIdx = Math.min(2, row.length - 1);
                      headerRowIndex = fallbackHeaderIdx;
                      break;
                  }
              }
          }
      }

      if (headerRowIndex === -1) {
          toast.error(`No se detectaron las columnas 'Fecha', 'Descripción' y 'Abono/Monto' en el archivo de ${bankName}. Verifica que el archivo sea correcto.`);
          return [];
      }

      const cleanMovements = [];
      
      for (let i = headerRowIndex + 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;

          let rawAmount = 0;
          if (abonoIdx !== -1 && row[abonoIdx]) {
              rawAmount = row[abonoIdx];
          } 
          if (!rawAmount && montoIdx !== -1 && row[montoIdx]) {
             rawAmount = row[montoIdx];
          }

          let finalAmount = 0;
          if (typeof rawAmount === 'number') {
              finalAmount = rawAmount;
          } else if (typeof rawAmount === 'string') {
              let s = rawAmount.trim();
              const isNegative = s.includes('(') || s.includes('-');
              s = s.replace(/\./g, '');
              s = s.replace(',', '.');
              s = s.replace(/[^0-9.]/g, '');
              finalAmount = parseFloat(s);
              if (isNegative) {
                  finalAmount = -Math.abs(finalAmount);
              }
          }

          if (!finalAmount || isNaN(finalAmount) || finalAmount <= 0) continue;

          let rawDate = row[dateIdx];
          let finalDate = 'S/F';

          if (typeof rawDate === 'number') {
              try {
                  const dateObj = XLSX.SSF.parse_date_code(rawDate);
                  const dd = String(dateObj.d).padStart(2, '0');
                  const mm = String(dateObj.m).padStart(2, '0');
                  finalDate = `${dd}/${mm}/${dateObj.y}`;
              } catch {
                  finalDate = 'Error Fecha';
              }
          } else if (typeof rawDate === 'string') {
               rawDate = rawDate.trim();
               if (rawDate.match(/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/)) {
                   finalDate = rawDate.replace(/-/g, '/');
               } else {
                   const d = new Date(rawDate);
                   if (!isNaN(d.getTime())) {
                       finalDate = d.toLocaleDateString('es-CL');
                   }
               }
          }

          cleanMovements.push({
              date: finalDate,
              description: row[descIdx] || 'Sin descripción',
              amount: finalAmount,
              bank: bankName,
          });
      }

      return cleanMovements;
  };

  // ========================
  // SMART MATCHING ALGORITHM
  // ========================
  const runSmartMatching = (bankMovements, invoices) => {
    const newSuggestions = {};
    const autoMatches = [];

    bankMovements.forEach(mov => {
      // Skip already confirmed matches
      if (matches.some(m => m.movement.id === mov.id)) return;

      const scored = [];

      invoices.forEach(inv => {
        // Skip already matched invoices
        if (matches.some(m => m.invoice.id === inv.id)) return;

        let score = 0;
        const reasons = [];

        // 1. AMOUNT: Exact match (+50 points, tolerance $10)
        const amountDiff = Math.abs(Number(inv.totalAmount) - mov.amount);
        if (amountDiff < 10) {
          score += 50;
          reasons.push('Monto exacto');
        } else if (amountDiff < 100) {
          score += 25;
          reasons.push('Monto similar');
        }

        // 2. DATE: Proximity within 5 days (+20 points)
        const movDate = parseDate(mov.date);
        let invDateStr = inv.issueDate || '';
        // invoices may store issueDate as "YYYY-MM-DD"
        let invDate = null;
        if (invDateStr) {
          const parts = invDateStr.split('-');
          if (parts.length === 3) {
            invDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
          }
        }
        // Fallback to createdAt
        if (!invDate && inv.createdAt?.seconds) {
          invDate = new Date(inv.createdAt.seconds * 1000);
        }

        if (movDate && invDate && !isNaN(movDate.getTime()) && !isNaN(invDate.getTime())) {
          const daysDiff = Math.abs((movDate - invDate) / (1000 * 60 * 60 * 24));
          if (daysDiff <= 5) {
            score += 20;
            reasons.push(`Fecha cercana (${Math.round(daysDiff)}d)`);
          } else if (daysDiff <= 15) {
            score += 10;
            reasons.push(`Fecha próxima (${Math.round(daysDiff)}d)`);
          }
        }

        // 3. TEXT: Description contains Client Name or Project Code (+30 points)
        const descLower = String(mov.description || '').toLowerCase();
        const clientName = String(inv.clientName || '').toLowerCase();
        const projectName = String(inv.projectName || '').toLowerCase();
        
        // Find the project code from the projects array
        let projectCode = '';
        if (inv.projectId) {
          const proj = projects.find(p => p.id === inv.projectId);
          if (proj?.code) projectCode = proj.code.toLowerCase();
        }

        if (clientName && clientName.length > 2 && descLower.includes(clientName)) {
          score += 30;
          reasons.push('Nombre cliente en descripción');
        } else if (projectCode && projectCode.length > 2 && descLower.includes(projectCode)) {
          score += 30;
          reasons.push('Código proyecto en descripción');
        } else if (projectName && projectName.length > 3 && descLower.includes(projectName)) {
          score += 20;
          reasons.push('Nombre proyecto en descripción');
        }

        if (score > 0) {
          scored.push({ invoice: inv, score, reasons });
        }
      });

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);

      if (scored.length > 0) {
        // If top match is definitive (score >= 70 and clearly best)
        if (scored[0].score >= 70 && (scored.length === 1 || scored[0].score > scored[1].score + 20)) {
          autoMatches.push({
            movement: mov,
            invoice: scored[0].invoice,
            confidence: 'high',
            reason: scored[0].reasons.join(' + ')
          });
        }
        
        // Store all suggestions with score > 30 for the UI
        const relevant = scored.filter(s => s.score > 30);
        if (relevant.length > 0) {
          newSuggestions[mov.id] = relevant;
        }
      }
    });

    setSuggestions(newSuggestions);
    
    // Only auto-add matches that aren't already confirmed
    if (autoMatches.length > 0) {
      setMatches(prev => {
        const existingIds = new Set(prev.map(m => m.movement.id));
        const newOnes = autoMatches.filter(m => !existingIds.has(m.movement.id));
        return [...prev, ...newOnes];
      });
    }
  };

  // 4. Confirm Matches
  const handleConfirmMatches = async () => {
      setProcessing(true);
      try {
          const batch = writeBatch(db);
          
          matches.forEach(m => {
              const invRef = doc(db, "invoices", m.invoice.id);
              batch.update(invRef, { 
                  paymentStatus: 'paid',
                  paidAt: serverTimestamp(),
                  paymentReference: `Conciliación Auto: ${m.movement.description}`,
                  paymentAmount: m.movement.amount,
                  paymentMetadata: {
                      bank: m.movement.bank,
                      transactionDate: m.movement.date,
                      transactionDescription: m.movement.description,
                      reconciledAt: new Date().toISOString()
                  }
              });

              // Update Project Billing Status to 'paid'
              if (m.invoice.projectId) {
                  const projRef = doc(db, "projects", m.invoice.projectId);
                  batch.update(projRef, {
                      billingStatus: 'paid',
                      lastPaymentDate: serverTimestamp()
                  });
              }

              // Mark the bank movement as reconciled
              if (m.movement.id) {
                const movRef = doc(db, "bank_movements", m.movement.id);
                batch.update(movRef, {
                  reconciled: true,
                  reconciledInvoiceId: m.invoice.id,
                  reconciledAt: serverTimestamp()
                });
              }
          });

          await batch.commit();
          toast.success(`${matches.length} facturas conciliadas exitosamente.`);
          setMatches([]);
          setSuggestions({});
          
          // Reload data
          await fetchPending();
          await fetchMovements();

      } catch (e) {
          console.error("Error confirming matches:", e);
          toast.error("Error al guardar conciliación.");
      } finally {
          setProcessing(false);
      }
  };

  const removeMatch = (index) => {
      const newMatches = [...matches];
      newMatches.splice(index, 1);
      setMatches(newMatches);
  };

  return (
    <Layout title="Cuenta Corriente Unificada" isFullWidth={true}>
      <div className="flex flex-col gap-6">
          
          {/* TOP SECTION: Control Panel (Upload & Summary) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Upload Card - Takes 2 cols */}
              <div className="md:col-span-2 bg-white p-6 rounded-2xl shadow-soft border border-slate-100">
                  <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                      <Upload className="w-5 h-5 text-indigo-600" /> Cargar Cartolas
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Itaú Upload */}
                      <div className={`border-2 border-dashed rounded-xl p-4 text-center transition cursor-pointer relative group ${movements.some(m => m.bank === 'Itaú') ? 'bg-orange-50 border-orange-200' : 'border-slate-200 hover:bg-orange-50'}`}>
                          <input 
                              type="file" 
                              accept=".xlsx, .xls"
                              onChange={(e) => handleFileUpload(e, 'Itaú')}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              title="Cargar Cartola Itaú"
                          />
                          <div className="flex items-center justify-center gap-2">
                              {movements.some(m => m.bank === 'Itaú') ? (
                                  <>
                                      <CheckCircle className="w-5 h-5 text-orange-600" />
                                      <span className="font-bold text-orange-700 text-sm">Itaú Listo ({movements.filter(m => m.bank === 'Itaú').length} mov.)</span>
                                  </>
                              ) : (
                                  <>
                                      <FileSpreadsheet className="w-5 h-5 text-orange-500" />
                                      <span className="font-bold text-slate-600 group-hover:text-orange-600 text-sm">Excel Itaú</span>
                                  </>
                              )}
                          </div>
                      </div>

                      {/* Santander Upload */}
                      <div className={`border-2 border-dashed rounded-xl p-4 text-center transition cursor-pointer relative group ${movements.some(m => m.bank === 'Santander') ? 'bg-red-50 border-red-200' : 'border-slate-200 hover:bg-red-50'}`}>
                          <input 
                              type="file" 
                              accept=".xlsx, .xls"
                              onChange={(e) => handleFileUpload(e, 'Santander')}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              title="Cargar Cartola Santander"
                          />
                          <div className="flex items-center justify-center gap-2">
                              {movements.some(m => m.bank === 'Santander') ? (
                                  <>
                                      <CheckCircle className="w-5 h-5 text-red-600" />
                                      <span className="font-bold text-red-700 text-sm">Santander Listo ({movements.filter(m => m.bank === 'Santander').length} mov.)</span>
                                  </>
                              ) : (
                                  <>
                                      <FileSpreadsheet className="w-5 h-5 text-red-500" />
                                      <span className="font-bold text-slate-600 group-hover:text-red-500 text-sm">Excel Santander</span>
                                  </>
                              )}
                          </div>
                      </div>
                  </div>
                  
                  {loading && <p className="text-center text-sm text-indigo-600 mt-2 font-medium animate-pulse">Procesando archivo...</p>}
              </div>

              {/* Summary Card - Takes 1 col */}
              <div className="md:col-span-1 bg-white p-6 rounded-2xl shadow-soft border border-slate-100 flex flex-col justify-center">
                  <h3 className="font-bold text-slate-800 mb-3">Resumen</h3>
                  <div className="space-y-3 text-sm">
                      <div className="flex justify-between border-b border-slate-50 pb-2">
                          <span className="text-slate-500">Facturas Pendientes:</span>
                          <span className="font-bold">{pendingInvoices.length}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-50 pb-2">
                          <span className="text-slate-500">Movimientos:</span>
                          <span className="font-bold">{movements.length}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-50 pb-2">
                          <span className="text-slate-500">Coincidencias:</span>
                          <span className="font-bold text-green-600">{matches.length}</span>
                      </div>
                      <div className="flex justify-between">
                          <span className="text-slate-500">Sugerencias:</span>
                          <span className="font-bold text-amber-600">{Object.keys(suggestions).length}</span>
                      </div>
                  </div>
              </div>

          </div>

          {/* MIDDLE SECTION: Matches (Full Width) */}
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
                              
                              {/* Bank Side */}
                              <div className="flex-1 min-w-0">
                                  <p className="text-xs text-slate-400 uppercase font-bold mb-1">Movimiento Banco</p>
                                  <p className="font-bold text-slate-800 text-sm truncate" title={match.movement.description}>
                                      {match.movement.description}
                                  </p>
                                  <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${match.movement.bank === 'Itaú' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'}`}>
                                      {match.movement.bank || 'Banco'}
                                  </span>
                                  <p className="text-green-600 font-mono font-bold mt-1">
                                      + {formatCurrency(match.movement.amount)}
                                  </p>
                                  <p className="text-xs text-slate-400 mt-1">{match.movement.date}</p>
                              </div>

                              <div className="flex flex-col items-center gap-1 flex-shrink-0">
                                  <ArrowRight className="text-slate-300 w-5 h-5" />
                                  <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full ${
                                    match.confidence === 'high' ? 'bg-green-100 text-green-700' : 
                                    match.confidence === 'smart' ? 'bg-blue-100 text-blue-700' : 
                                    'bg-slate-100 text-slate-600'
                                  }`}>
                                    {match.reason || match.confidence}
                                  </span>
                              </div>

                              {/* Invoice Side */}
                              <div className="flex-1 min-w-0">
                                  <p className="text-xs text-slate-400 uppercase font-bold mb-1">Factura Detectada</p>
                                  <p className="font-bold text-slate-800 text-sm truncate">
                                      {match.invoice.clientName}
                                  </p>
                                  <p className="text-indigo-600 text-xs truncate mb-1">{match.invoice.projectName}</p>
                                  <p className="text-slate-800 font-bold">{formatCurrency(match.invoice.totalAmount)}</p>
                              </div>

                              <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition">
                                  <button 
                                      onClick={() => removeMatch(idx)}
                                      className="text-red-400 hover:text-red-600 p-2 hover:bg-red-50 rounded-lg"
                                      title="Rechazar esta coincidencia"
                                  >
                                      <AlertTriangle className="w-5 h-5" />
                                  </button>
                              </div>

                          </div>
                      ))}
                  </div>
              </div>
          )}

          {/* BOTTOM SECTION: Data Workspaces (Side-by-Side) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-[calc(100vh-320px)] min-h-[600px]">
              
              {/* Unified Movements Table */}
              <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden flex flex-col h-full">
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
                                  <tr>
                                      <td colSpan="6" className="px-4 py-10 text-center text-slate-400 text-sm animate-pulse">
                                          Cargando movimientos...
                                      </td>
                                  </tr>
                              ) : movements.length === 0 ? (
                                  <tr>
                                      <td colSpan="6" className="px-4 py-10 text-center text-slate-400">
                                          Sube archivos para ver movimientos.
                                      </td>
                                  </tr>
                              ) : (
                                  movements.map((mov, i) => {
                                      const isMatched = matches.some(m => m.movement.id === mov.id) || mov.reconciled;
                                      const movSuggestions = suggestions[mov.id] || [];
                                      const isExpanded = expandedMovement === mov.id;

                                      return (
                                          <tr key={mov.id || i} className="group">
                                            <td colSpan="6" className="p-0">
                                              {/* Main Row */}
                                              <div className={`flex items-center transition ${
                                                  manualMatchOpen && activeMovement && activeMovement.id === mov.id
                                                    ? 'bg-indigo-50 border-l-4 border-indigo-600 shadow-inner'
                                                    : manualMatchOpen
                                                        ? 'opacity-40 grayscale'
                                                        : isMatched 
                                                            ? 'bg-green-50/50'
                                                            : 'hover:bg-slate-50'
                                              }`}>
                                                  <div className="px-4 py-3 w-24 shrink-0">
                                                      <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded-full ${mov.bank === 'Itaú' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'}`}>
                                                          {mov.bank || 'Banco'}
                                                      </span>
                                                  </div>
                                                  <div className="px-4 py-3 text-slate-600 w-24 shrink-0">{mov.date}</div>
                                                  <div className="px-4 py-3 text-slate-700 flex-1 min-w-0 truncate" title={mov.description}>
                                                      {mov.description}
                                                  </div>
                                                  <div className="px-4 py-3 text-right font-bold text-green-600 font-mono w-32 shrink-0">
                                                      + {formatCurrency(mov.amount)}
                                                  </div>
                                                  <div className="px-4 py-3 text-center w-20 shrink-0">
                                                      {isMatched && <CheckCircle className="w-4 h-4 text-green-500 mx-auto" />}
                                                  </div>
                                                  <div className="px-4 py-3 text-center w-24 shrink-0 flex items-center justify-center gap-1">
                                                      {!isMatched && (
                                                        <>
                                                          <button 
                                                            onClick={() => startManualMatch(mov)}
                                                            className="text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 p-1.5 rounded-full transition"
                                                            title="Enlazar Manualmente"
                                                          >
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
                                              
                                              {/* Expanded Suggestions */}
                                              {isExpanded && movSuggestions.length > 0 && (
                                                <div className="bg-amber-50/50 border-t border-amber-100 px-6 py-3 animate-in fade-in slide-in-from-top-1 duration-200">
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
                                                            <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full ${
                                                              sug.score >= 70 ? 'bg-green-100 text-green-700' : 
                                                              sug.score >= 50 ? 'bg-amber-100 text-amber-700' : 
                                                              'bg-slate-100 text-slate-600'
                                                            }`}>
                                                              {sug.score} pts
                                                            </span>
                                                            {sug.reasons.map((r, ri) => (
                                                              <span key={ri} className="text-[9px] text-slate-400">{r}</span>
                                                            ))}
                                                          </div>
                                                        </div>
                                                        <button
                                                          onClick={() => confirmSuggestion(mov, sug.invoice)}
                                                          className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-indigo-700 transition shrink-0 ml-3"
                                                        >
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

              {/* Pending Invoices List */}
              <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden flex flex-col h-full">
                  <div className="p-4 border-b border-slate-100 bg-slate-50 sticky top-0 z-10">
                      <h3 className="font-bold text-slate-800 flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-slate-500" /> Facturas Emitidas (Por Cobrar)
                      </h3>
                      <p className="text-xs text-slate-500">Documentos pendientes de pago</p>
                  </div>
                  <div className="overflow-y-auto p-4 space-y-3 flex-1 relative">
                      {manualMatchOpen && activeMovement && (
                          <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 text-white p-4 rounded-xl shadow-lg border border-indigo-400/30 sticky top-0 z-20 mb-4 animate-in fade-in slide-in-from-top-2">
                              <div className="flex justify-between items-start">
                                  <div>
                                      <p className="text-[10px] uppercase font-bold tracking-wider opacity-80 mb-1">Seleccionando Factura Para:</p>
                                      <p className="font-bold text-sm truncate max-w-[180px] text-white">{activeMovement.description}</p>
                                      <p className="font-mono text-xl font-bold mt-1">+ {formatCurrency(activeMovement.amount)}</p>
                                  </div>
                                  <button 
                                    onClick={cancelManualMatch}
                                    className="bg-white/20 hover:bg-white/30 text-white p-1.5 rounded-lg transition backdrop-blur-sm"
                                    title="Cancelar selección"
                                  >
                                      <X className="w-5 h-5" />
                                  </button>
                              </div>
                          </div>
                      )}

                      {pendingInvoices.length === 0 ? (
                          <p className="text-center text-slate-400 text-sm py-10">No hay facturas pendientes.</p>
                      ) : (
                          [...pendingInvoices]
                          .sort((a,b) => {
                              if (manualMatchOpen && activeMovement) {
                                  const diffA = Math.abs(Number(a.totalAmount) - activeMovement.amount);
                                  const diffB = Math.abs(Number(b.totalAmount) - activeMovement.amount);
                                  return diffA - diffB;
                              }
                              return 0;
                          })
                          .map((inv, i) => {
                              const isMatched = matches.some(m => m.invoice.id === inv.id);
                              const isExactMatchCandidate = manualMatchOpen && activeMovement && Math.abs(Number(inv.totalAmount) - activeMovement.amount) < 100;
                              
                              let containerClass = "p-3 rounded-lg border transition duration-200 relative ";
                              
                              if (manualMatchOpen) {
                                  containerClass += "cursor-pointer hover:ring-2 hover:ring-indigo-500 hover:shadow-md ";
                                  if (isExactMatchCandidate) {
                                      containerClass += "bg-indigo-50 border-indigo-500 shadow-md ring-1 ring-indigo-200 ";
                                  } else {
                                      containerClass += "bg-white border-slate-200 opacity-90 ";
                                  }
                              } else {
                                  if (isMatched) {
                                      containerClass += "bg-green-50 border-green-200 opacity-60 cursor-default ";
                                  } else {
                                      containerClass += "bg-white border-slate-100 hover:border-slate-300 hover:shadow-sm cursor-pointer ";
                                  }
                              }

                              return (
                                  <div 
                                      key={i} 
                                      className={containerClass}
                                      onClick={() => manualMatchOpen ? confirmManualMatch(inv) : openInvoiceDetail(inv)}
                                  >
                                      {isExactMatchCandidate && (
                                          <span className="absolute -top-2 -right-2 bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm animate-bounce">
                                              Coincidencia
                                          </span>
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
                                          {isMatched && <span className="text-[10px] font-bold text-green-600 flex items-center"><CheckCircle className="w-3 h-3 mr-1"/> Matched</span>}
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
