import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { Upload, FileSpreadsheet, CheckCircle, AlertTriangle, ArrowRight, Save, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';
import { collection, query, where, getDocs, writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { formatCurrency } from '../utils/format';

export default function AdminInvoicingReconciliation() {
  const [file, setFile] = useState(null);
  const [movements, setMovements] = useState([]);
  const [matches, setMatches] = useState([]);
  const [pendingInvoices, setPendingInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);

  // 1. Fetch Pending Invoices
  useEffect(() => {
    async function fetchPending() {
        const q = query(collection(db, "invoices"), where("paymentStatus", "==", "pending"));
        const snapshot = await getDocs(q);
        setPendingInvoices(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }
    fetchPending();
  }, []);

  // 2. Handle File Upload & Parsing
  const handleFileUpload = (e, bankName) => {
      const selectedFile = e.target.files[0];
      if (!selectedFile) return;
      
      setFile(selectedFile);
      setLoading(true);

      const reader = new FileReader();
      reader.onload = (evt) => {
          try {
              const bstr = evt.target.result;
              const workbook = XLSX.read(bstr, { type: 'binary' });
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
                      } catch (e) {
                          return 0;
                      }
                  });
              });
              
              // Run Matching against ALL movements
              // Note: We need to use the NEW combined list for matching
              // Since setState is async, let's recalculate locally
              const newMovements = [...movements, ...parsedMovements];
              runMatching(newMovements, pendingInvoices);

          } catch (error) {
              console.error("Error parsing Excel:", error);
              alert("Error al leer el archivo Excel. Asegúrate de que tenga un formato válido.");
          } finally {
              setLoading(false);
          }
      };
      reader.readAsBinaryString(selectedFile);
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
      let saldoIdx = -1;

      // 1. Scan for Header Row (up to 50 rows, common in messy bank files)
      for (let i = 0; i < Math.min(rows.length, 50); i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;

          const dIdx = findCol(row, ['fecha', 'date']);
          const descI = findCol(row, ['descrip', 'detalle', 'concepto', 'movimiento', 'glosa']);
          
          // Strict checks first
          const aIdx = findCol(row, ['abono']);
          const mIdx = findCol(row, ['monto', 'importe', 'valor']);
          
          // Debug scan
          // console.log(`Row ${i}:`, row);

          if (dIdx !== -1 && (descI !== -1)) {
              // Found Date and Description, likely the header
              // Now check if we have an Amount column
              if (aIdx !== -1 || mIdx !== -1) {
                  headerRowIndex = i;
                  dateIdx = dIdx;
                  descIdx = descI;
                  abonoIdx = aIdx;
                  montoIdx = mIdx;
                  saldoIdx = findCol(row, ['saldo']);
                  break;
              }
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
          
          // Strategy: If "Abono" column exists, use it. Usually Abono = Income, Cargo = Expense.
          if (abonoIdx !== -1) {
              const val = row[abonoIdx];
              if (val) rawAmount = val;
          } 
          // Fallback: If no Abono header, check "Monto"
          else if (montoIdx !== -1) {
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
              } catch (e) {
                  console.warn("Date parse error", rawDate);
                  finalDate = 'Error Fecha';
              }
          } else if (typeof rawDate === 'string') {
               // Try identifying DD/MM/YYYY or DD-MM-YYYY
               rawDate = rawDate.trim();
               // Regex for DD/MM/YYYY
               if (rawDate.match(/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/)) {
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
          alert(`Se encontraron columnas pero no movimientos de ingreso (Abonos) válidos en ${bankName}.`);
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
                  paymentAmount: m.movement.amount
              });
          });

          await batch.commit();
          alert(`${matches.length} facturas conciliadas exitosamente.`);
          setMovements([]);
          setFile(null);
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
    <Layout title="Cuenta Corriente Unificada">
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
                          {pendingInvoices.length === 0 ? (
                              <p className="text-center text-slate-400 text-sm py-10">No hay facturas pendientes.</p>
                          ) : (
                              pendingInvoices.map((inv, i) => {
                                  // Check if this invoice is already matched
                                  const isMatched = matches.some(m => m.invoice.id === inv.id);
                                  return (
                                      <div key={i} className={`p-3 rounded-lg border ${isMatched ? 'bg-green-50 border-green-200 opacity-60' : 'bg-white border-slate-100 hover:border-slate-300'} transition`}>
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
    </Layout>
  );
}
