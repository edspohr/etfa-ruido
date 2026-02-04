import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { Upload, FileSpreadsheet, CheckCircle, AlertTriangle, ArrowRight, Save, RefreshCw, Search, X, Link } from 'lucide-react';
import * as XLSX from 'xlsx';
import { collection, query, where, getDocs, writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { formatCurrency } from '../utils/format';
import InvoiceDetailModal from '../components/InvoiceDetailModal';

export default function AdminInvoicingReconciliation() {
  const [movements, setMovements] = useState([]);
  const [matches, setMatches] = useState([]);
  const [pendingInvoices, setPendingInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  
  // Modal State
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Manual Match State
  const [manualMatchOpen, setManualMatchOpen] = useState(false);
  const [activeMovement, setActiveMovement] = useState(null);

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

  // 1. Fetch Pending Invoices
  const fetchPending = async () => {
      const q = query(collection(db, "invoices"), where("paymentStatus", "==", "pending"));
      const snapshot = await getDocs(q);
      setPendingInvoices(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => {
    fetchPending();
  }, []);

  const openInvoiceDetail = (inv) => {
      setSelectedInvoice(inv);
      setIsModalOpen(true);
  };

  // 2. Handle File Upload & Parsing
  const handleFileUpload = (e, bankName) => {
      const selectedFile = e.target.files[0];
      if (!selectedFile) return;
      

      setLoading(true);

      const reader = new FileReader();
      
      reader.onload = (evt) => {
          try {
              const arrayBuffer = evt.target.result;
              const workbook = XLSX.read(arrayBuffer, { type: 'array' }); // Use 'array' for robustness
              const wsname = workbook.SheetNames[0];
              const ws = workbook.Sheets[wsname];
              const data = XLSX.utils.sheet_to_json(ws, { header: 1 }); // Array of arrays

              // Parsing Logic Tweak: Sort by Date
              const parsedMovements = parseBankData(data, bankName);
              
              setMovements(prev => {
                  const combined = [...prev, ...parsedMovements];
                  // Sort by ISO date for display
                  return combined.sort((a, b) => {
                      try {
                          // Parse DD/MM/YYYY
                          if (!a.date || !b.date) return 0;
                          const [da, ma, ya] = a.date.split('/').map(Number);
                          const [db, mb, yb] = b.date.split('/').map(Number);
                          const dateA = new Date(ya, ma - 1, da);
                          const dateB = new Date(yb, mb - 1, db);
                          if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) return 0;
                          return dateB - dateA; // Newest first
                      } catch {
                          return 0;
                      }
                  });
              });
              
              // Run Matching against ALL movements
              const newMovements = [...movements, ...parsedMovements];
              runMatching(newMovements, pendingInvoices);

          } catch (error) {
              console.error("Error parsing Excel:", error);
              alert("Error al leer el archivo Excel. Asegúrate de que tenga un formato válido.");
          } finally {
              setLoading(false);
          }
      };

      reader.onerror = () => {
          console.error("FileReader error");
          alert("Error al leer el archivo.");
          setLoading(false);
      };

      try {
          reader.readAsArrayBuffer(selectedFile); // Changed to ArrayBuffer for .xlsx support
      } catch (error) {
          console.error("Error initiating read:", error);
          setLoading(false);
      }
  };

  const parseBankData = (rows, bankName) => {
      if (!rows || rows.length < 2) {
          alert("El archivo parece estar vacío o tener formato incorrecto.");
          return [];
      }

      // Helper to clean strings
      const cleanStr = (val) => String(val || '').toLowerCase().trim();

      // Helper to find column index
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


      // 1. Scan for Header Row (up to 50 rows, common in messy bank files)
      for (let i = 0; i < Math.min(rows.length, 50); i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;

          const dIdx = findCol(row, ['fecha', 'date']);
          const descI = findCol(row, ['descrip', 'detalle', 'concepto', 'movimiento', 'glosa']);
          
          // Extended Checks for Santander / Other Formats
          const aIdx = findCol(row, ['abono', 'deposito', 'credit', 'crédito']);
          // FIX: Removed 'saldo' from keywords to avoid capturing balance. Added safety check below.
          let mIdx = findCol(row, ['monto', 'importe', 'valor']); 
          
          // Safety: If column header explicitly says "Saldo" or "Balance", ignore it.
          if (mIdx !== -1) {
              const headerVal = cleanStr(row[mIdx]);
              if (headerVal.includes('saldo') || headerVal.includes('balance')) {
                  mIdx = -1;
              }
          }
          
          // Debug scan
          // console.log(`Row ${i} scan: Date=${dIdx}, Desc=${descI}, Abono=${aIdx}, Monto=${mIdx}`);

          if (dIdx !== -1 && (descI !== -1)) {
              // Found Date and Description, likely the header
              // Now check if we have ANY numeric value column
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

      // STRATEGY B: "Pattern Match" Scan (Default for Santander, Fallback for others)
      // For Santander, we skip header search and go straight to row scanning to avoid issues with messy headers.
      if ((headerRowIndex === -1) || (bankName === 'Santander')) {
          console.log(`[${bankName}] Using Strategy B (Pattern Match - Row Scan)...`);
          
          const heuristicMovements = [];
          
          rows.forEach((row, rowIndex) => {
              if (!row || row.length < 3) return;
              
              // 1. DETECT DATE (DD/MM/AAAA or DD-MM-AAAA) in first few columns
              let potentialDate = null;
              let dateColIndices = [0, 1]; 
              
              for (let dCol of dateColIndices) {
                  if (row[dCol]) {
                      const val = String(row[dCol]).trim();
                      if (val.match(/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/)) {
                          potentialDate = val.replace(/-/g, '/');
                          break;
                      }
                  }
              }
              
              if (!potentialDate) return; // Skip row if no date found

              // 2. EXTRACT AMOUNTS & APPLY HEURISTICS
              let candidateAmount = 0;
              let candidates = [];

              // Scan all columns (starting from 2 usually, but let's scan all except date)
              row.forEach((cell, idx) => {
                  if (dateColIndices.includes(idx)) return; // skip date col
                  
                  let val = 0;
                  if (typeof cell === 'number') {
                      val = cell;
                  } else if (typeof cell === 'string') {
                      // Cleanup: remove dots, replace comma with dot
                      let s = cell.trim();
                      s = s.replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
                      val = parseFloat(s);
                  }

                  // Heuristic: Only interested in Positive numbers (Abonos)
                  if (!isNaN(val) && val > 0) {
                      candidates.push({ val, idx });
                  }
              });

              if (candidates.length === 0) return; // No positive numbers

              // HEURISTIC: Choose the right amount
              // If multiple candidates, we need to avoid "Saldo".
              // Santander usually has: Cargo | Abono | Saldo
              // So we might see 2 positive numbers: Abono and Saldo.
              // We CANNOT rely on header names here.
              // Logic: 
              // 1. If only 1 candidate, take it.
              // 2. If existing headers known (Strategy A passed but missed row?), no, we are here because headers failed or we forced B.
              // 3. Positional: Abono is usually before Saldo? 
              // Let's assume the "Saldo" is the cumulative total.
              // If we have multiple, usually the actual movement is NOT the last one? Or varies?
              // Let's look for Values that are NOT likely to be dates (already handled).
              
              // Refined Rule for Santander (User Request):
              // "Descarta el que esté en una columna que históricamente corresponda a Saldo" -> We don't have history.
              // "Toma el valor que corresponda a un Abono... Busca valores positivos que NO sean el saldo final."
              
              // For now, if > 1 candidate, we pick the FIRST one found? (Usually Abono comes before Saldo reading left-to-right?)
              // OR check against Description text?
              // Let's go with: Pick the one that seems most "transaction-like". 
              // If multiple, taking the FIRST one is risky if Debit is positive (but Debits are usually negative or separate col).
              // Let's take the First Candidate as the best guess for "Abono", assuming "Saldo" is to the right.
              candidateAmount = candidates[0].val;

              // 3. DESCRIPTION
              // Join all text parts that aren't the date or the selected amount
              const textParts = [];
              row.forEach((cell, idx) => {
                   if (dateColIndices.includes(idx)) return;
                   
                   const s = String(cell).trim();
                   // Skip if it looks like our amount
                   const cleanS = s.replace(/\./g, '').replace(',', '.');
                   if (cleanS.includes(String(candidateAmount))) return;
                   
                   // Heuristic: Text must be length > 3 and not look like a number
                   if (s.length > 3 && isNaN(parseFloat(cleanS))) {
                       textParts.push(s);
                   }
              });

              let potentialDesc = textParts.join(' ') || 'Movimiento Detectado';

              heuristicMovements.push({
                   id: `mov-${bankName}-scan-${rowIndex}-${Date.now()}`,
                   date: potentialDate,
                   description: potentialDesc,
                   amount: candidateAmount,
                   bank: bankName,
                   originalRow: row
              });
          });
          
          if (heuristicMovements.length > 0) {
               console.log(`[${bankName}] Strategy B found ${heuristicMovements.length} movements.`);
               // If we forced Strategy B for Santander, return immediately
               return heuristicMovements;
          }
      }

      if (headerRowIndex === -1) {
          console.warn(`Could not find headers in ${bankName} file. Checked first 50 rows.`);
          alert(`No se detectaron las columnas 'Fecha', 'Descripción' y 'Abono/Monto' en el archivo de ${bankName}. Por favor verifica el Excel.`);
          return [];
      }

      console.log(`[${bankName}] Headers found at row ${headerRowIndex}. Date:${dateIdx}, Desc:${descIdx}, Abono:${abonoIdx}, Monto:${montoIdx}`);

      const cleanMovements = [];
      
      for (let i = headerRowIndex + 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;

          // --- 1. AMOUNT PARSING ---
          let rawAmount = 0;
          
          // Strategy: Try Abono, then Monto
          if (abonoIdx !== -1 && row[abonoIdx]) {
              rawAmount = row[abonoIdx];
          } 
          
          // Fallback: If no Abono value found (or Abono column missing), check Monto/Importe
          if (!rawAmount && montoIdx !== -1 && row[montoIdx]) {
             rawAmount = row[montoIdx];
          }

          // Parse the number
          let finalAmount = 0;
          if (typeof rawAmount === 'number') {
              finalAmount = rawAmount;
          } else if (typeof rawAmount === 'string') {
              let s = rawAmount.trim();
              
              // Check for negative signs before cleaning
              // Parentheses (100) or leading/trailing minus -100, 100-
              const isNegative = s.includes('(') || s.includes('-');

              // CLEANUP: Chilean format "1.000.000" or "1.000.000,00"
              // Remove dots (thousand sep)
              s = s.replace(/\./g, '');
              // Replace comma with dot (decimal)
              s = s.replace(',', '.');
              // Remove non-numeric (except dot)
              s = s.replace(/[^0-9.]/g, '');
              
              finalAmount = parseFloat(s);
              
              if (isNegative) {
                  finalAmount = -Math.abs(finalAmount);
              }
          }

          // Filter: Must be valid number and Positive (we only reconcile Income)
          if (!finalAmount || isNaN(finalAmount) || finalAmount <= 0) continue;

          // --- 2. DATE PARSING ---
          let rawDate = row[dateIdx];
          let finalDate = 'S/F';

          if (typeof rawDate === 'number') {
              // Excel Serial Date
              try {
                  const dateObj = XLSX.SSF.parse_date_code(rawDate);
                  // Pad with leading zeros
                  const dd = String(dateObj.d).padStart(2, '0');
                  const mm = String(dateObj.m).padStart(2, '0');
                  finalDate = `${dd}/${mm}/${dateObj.y}`;
              } catch {
                  console.warn("Date parse error", rawDate);
                  finalDate = 'Error Fecha';
              }
          } else if (typeof rawDate === 'string') {
               // Try identifying DD/MM/YYYY or DD-MM-YYYY
               rawDate = rawDate.trim();
               // Regex for DD/MM/YYYY
               if (rawDate.match(/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/)) {
                   finalDate = rawDate.replace(/-/g, '/'); // normalize to slash
               } else {
                   // Try native Date parse?
                   const d = new Date(rawDate);
                   if (!isNaN(d.getTime())) {
                       finalDate = d.toLocaleDateString('es-CL');
                   }
               }
          }

          cleanMovements.push({
              id: `mov-${bankName}-${i}-${Date.now()}`, 
              date: finalDate, // Now strictly DD/MM/YYYY
              description: row[descIdx] || 'Sin descripción',
              amount: finalAmount,
              bank: bankName,
              originalRow: row
          });
      }

      console.log(`[${bankName}] Parsed ${cleanMovements.length} valid incoming movements.`);
      if (cleanMovements.length === 0) {
          console.warn(`Se encontraron columnas pero no movimientos de ingreso (Abonos) válidos en ${bankName}.`);
      }
      return cleanMovements;
  };

  const runMatching = (bankMovements, invoices) => {
      const foundMatches = [];

      bankMovements.forEach(mov => {
          // 1. Exact Amount Match
          const amountMatch = invoices.find(inv => Math.abs(Number(inv.totalAmount) - mov.amount) < 10); // tolerance of $10

          if (amountMatch) {
              foundMatches.push({
                  movement: mov,
                  invoice: amountMatch,
                  confidence: 'high',
                  reason: 'Monto exacto'
              });
          } else {
              // 2. Try Partial Description Match (if Amount didn't match perfectly, maybe verify?)
              // For now, let's keep it simple: Matching by Amount is strongest for simple reconciliation
          }
      });
      
      setMatches(foundMatches);
  };





  // 3. Confirm Matches
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
                      originalRow: m.movement.originalRow,
                      reconciledAt: new Date().toISOString()
                  }
              });
          });

          await batch.commit();
          alert(`${matches.length} facturas conciliadas exitosamente.`);
          setMovements([]);
          setMatches([]);
          
          // Remove reconciled invoices from pending list
          const matchedIds = matches.map(m => m.invoice.id);
          setPendingInvoices(prev => prev.filter(inv => !matchedIds.includes(inv.id)));

      } catch (e) {
          console.error("Error confirming matches:", e);
          alert("Error al guardar conciliación.");
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
      <div className="mb-6">
          <p className="text-slate-500">Sube tu cartola bancaria (Excel) para conciliar pagos automáticamente.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left: Upload & Pending Data */}
          <div className="lg:col-span-1 space-y-6">
              
              <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100">
                  <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                      <Upload className="w-5 h-5 text-indigo-600" /> Cargar Cartolas
                  </h3>
                  
                  <div className="space-y-4">
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
                                      <CheckCircle className="w-6 h-6 text-orange-600" />
                                      <span className="font-bold text-orange-700">Itaú Cargado Correctamente</span>
                                  </>
                              ) : (
                                  <>
                                      <FileSpreadsheet className="w-6 h-6 text-orange-500" />
                                      <span className="font-bold text-slate-600 group-hover:text-orange-600">Cargar Excel Itaú</span>
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
                                      <CheckCircle className="w-6 h-6 text-red-600" />
                                      <span className="font-bold text-red-700">Santander Cargado Correctamente</span>
                                  </>
                              ) : (
                                  <>
                                      <FileSpreadsheet className="w-6 h-6 text-red-500" />
                                      <span className="font-bold text-slate-600 group-hover:text-red-600">Cargar Excel Santander</span>
                                  </>
                              )}
                          </div>
                      </div>
                  </div>
                  
                  {loading && <p className="text-center text-sm text-indigo-600 mt-4 font-medium animate-pulse">Procesando archivo...</p>}
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100">
                  <h3 className="font-bold text-slate-800 mb-2">Resumen</h3>
                  <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                          <span className="text-slate-500">Facturas Pendientes:</span>
                          <span className="font-bold">{pendingInvoices.length}</span>
                      </div>
                      <div className="flex justify-between">
                          <span className="text-slate-500">Movimientos Detectados:</span>
                          <span className="font-bold">{movements.length}</span>
                      </div>
                      <div className="flex justify-between">
                          <span className="text-slate-500">Coincidencias:</span>
                          <span className="font-bold text-green-600">{matches.length}</span>
                      </div>
                  </div>
              </div>

          </div>

          {/* Right: Reconciliation Interface */}
          <div className="lg:col-span-2">
              
              {matches.length > 0 ? (
                  <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden mb-8">
                      <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-green-50/50">
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

                                  <ArrowRight className="text-slate-300 w-5 h-5 flex-shrink-0" />

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
              ) : null}

              {/* Side-by-Side Detailed Lists */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Unified Movements Table */}
                  <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden flex flex-col h-[600px]">
                      <div className="p-4 border-b border-slate-100 bg-slate-50 sticky top-0 z-10">
                          <h3 className="font-bold text-slate-800 flex items-center gap-2">
                              <FileSpreadsheet className="w-4 h-4 text-slate-500" /> Movimientos Unificados
                          </h3>
                          <p className="text-xs text-slate-500">Itaú y Santander (Ordenados por fecha)</p>
                      </div>
                      <div className="overflow-auto flex-1">
                          <table className="w-full text-left text-sm whitespace-nowrap">
                              <thead className="bg-slate-50 text-slate-500 font-medium sticky top-0">
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
                                  {movements.length === 0 ? (
                                      <tr>
                                          <td colSpan="5" className="px-4 py-10 text-center text-slate-400">
                                              Sube archivos para ver movimientos.
                                          </td>
                                      </tr>
                                  ) : (
                                      movements.map((mov, i) => {
                                          const isMatched = matches.some(m => m.movement.id === mov.id);
                                          return (
                                              <tr key={i} className={`hover:bg-slate-50 transition ${isMatched ? 'bg-green-50/50' : ''}`}>
                                                  <td className="px-4 py-3">
                                                      <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded-full ${mov.bank === 'Itaú' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'}`}>
                                                          {mov.bank || 'Banco'}
                                                      </span>
                                                  </td>
                                                  <td className="px-4 py-3 text-slate-600">{mov.date}</td>
                                                  <td className="px-4 py-3 text-slate-700 max-w-[200px] truncate" title={mov.description}>
                                                      {mov.description}
                                                  </td>
                                                  <td className="px-4 py-3 text-right font-bold text-green-600 font-mono">
                                                      + {formatCurrency(mov.amount)}
                                                  </td>
                                                  <td className="px-4 py-3 text-center">
                                                      {isMatched && <CheckCircle className="w-4 h-4 text-green-500 mx-auto" />}
                                                  </td>
                                                  <td className="px-4 py-3 text-center">
                                                      {isMatched && <CheckCircle className="w-4 h-4 text-green-500 mx-auto" />}
                                                  </td>
                                                  <td className="px-4 py-3 text-center">
                                                      {!isMatched && (
                                                          <button 
                                                            onClick={() => startManualMatch(mov)}
                                                            className="text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 p-1.5 rounded-full transition"
                                                            title="Enlazar Manualmente"
                                                          >
                                                            <Link className="w-4 h-4" />
                                                          </button>
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
                  <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden flex flex-col h-[600px]">
                      <div className="p-4 border-b border-slate-100 bg-slate-50 sticky top-0 z-10">
                          <h3 className="font-bold text-slate-800 flex items-center gap-2">
                              <CheckCircle className="w-4 h-4 text-slate-500" /> Facturas Emitidas (Por Cobrar)
                          </h3>
                          <p className="text-xs text-slate-500">Documentos pendientes de pago</p>
                      </div>
                      <div className="overflow-y-auto p-4 space-y-3 flex-1">
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
                                  if (!manualMatchOpen || !activeMovement) return 0;
                                  const diffA = Math.abs(Number(a.totalAmount) - activeMovement.amount);
                                  const diffB = Math.abs(Number(b.totalAmount) - activeMovement.amount);
                                  return diffA - diffB;
                              })
                              .map((inv, i) => {
                                  // Check if this invoice is already matched
                                  const isMatched = matches.some(m => m.invoice.id === inv.id);
                                  
                                  // Styling for Manual Match Mode
                                  // If manual mode: highlight good matches, fade others
                                  const isGoodCandidate = manualMatchOpen && activeMovement && Math.abs(Number(inv.totalAmount) - activeMovement.amount) < 1000;
                                  const wrapperClass = manualMatchOpen
                                    ? `p-3 rounded-lg border cursor-pointer transition ${
                                        isGoodCandidate 
                                            ? 'bg-indigo-50 border-indigo-500 shadow-md scale-[1.02]' 
                                            : 'bg-white border-slate-100 opacity-50 hover:opacity-100'
                                    }`
                                    : `p-3 rounded-lg border cursor-pointer hover:shadow-md transition ${isMatched ? 'bg-green-50 border-green-200 opacity-60' : 'bg-white border-slate-100 hover:border-slate-300'}`;

                                  return (
                                      <div 
                                          key={i} 
                                          className={wrapperClass}
                                          onClick={() => manualMatchOpen ? confirmManualMatch(inv) : openInvoiceDetail(inv)}
                                      >
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
