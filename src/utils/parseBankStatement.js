/**
 * parseBankStatement.js
 * Robust, bank-agnostic Excel cartola parser for Chilean banks.
 *
 * v2 improvements:
 * - Smarter header detection with weighted scoring
 * - Better handling of merged/split columns (Santander vs Itaú differences)
 * - Improved date parsing for Excel serial numbers
 * - Defensive amount parsing for Chilean CLP formats
 * - Explicit error/warning reporting per row
 * - Support for single "Monto" column with sign detection
 */

import * as XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

const norm = (v) =>
  String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const COL_SIGNATURES = {
  date:    ['fecha', 'date', 'fec.', 'fec', 'f. contable', 'fecha contable', 'fecha operacion'],
  desc:    ['descripcion', 'detalle', 'glosa', 'concepto', 'movimiento', 'transaccion', 'beneficiario'],
  credit:  ['abono', 'credito', 'credit', 'deposito', 'ingreso', 'haber'],
  debit:   ['cargo', 'debito', 'debit', 'egreso', 'retiro', 'debe'],
  amount:  ['monto', 'importe', 'valor', 'amount'],
  exclude: ['saldo', 'balance', 'acumulado', 'disponible'],
};

const matchesAny = (cell, keywords) => {
  const n = norm(cell);
  if (!n || n.length < 2) return false;
  return keywords.some((k) => n === k || n.startsWith(k) || n.includes(k));
};

// ---------------------------------------------------------------------------
// DATE PARSER
// ---------------------------------------------------------------------------
export function parseExcelDate(raw) {
  if (raw == null || raw === '') return null;

  // 1. Excel numeric serial
  if (typeof raw === 'number' && raw > 30000 && raw < 60000) {
    try {
      const d = XLSX.SSF.parse_date_code(raw);
      if (d && d.y > 1900) {
        return `${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.y}`;
      }
    } catch { /* fall through */ }
  }

  const s = String(raw).trim();

  // 2. DD/MM/YYYY or DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? `20${y}` : y;
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${year}`;
  }

  // 3. YYYY-MM-DD (ISO)
  const iso = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }

  // 4. "DD de MMM YYYY" or "DD MMM YYYY" (Spanish dates in some banks)
  const spanishDate = s.match(/(\d{1,2})\s+(?:de\s+)?(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\w*\s+(\d{4})/i);
  if (spanishDate) {
    const months = { ene:'01', feb:'02', mar:'03', abr:'04', may:'05', jun:'06',
                     jul:'07', ago:'08', sep:'09', oct:'10', nov:'11', dic:'12' };
    const [, d, m, y] = spanishDate;
    const month = months[m.toLowerCase().substring(0,3)] || '01';
    return `${d.padStart(2, '0')}/${month}/${y}`;
  }

  // 5. Last resort: JS Date
  const jsDate = new Date(s);
  if (!isNaN(jsDate.getTime()) && jsDate.getFullYear() > 2000) {
    return jsDate.toLocaleDateString('es-CL');
  }

  return null;
}

// ---------------------------------------------------------------------------
// AMOUNT PARSER
// ---------------------------------------------------------------------------
export function parseAmount(raw) {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number') return Math.round(raw);

  let s = String(raw).trim();
  
  // Detect parenthetical negatives: (1.234)
  const isParenNeg = /^\([\d.,\s]+\)$/.test(s);
  const isDashNeg = /^-/.test(s);
  
  // Remove everything except digits, dots, commas, and minus sign
  s = s.replace(/[()]/g, '');
  
  // Handle CLP format: 1.234.567 (dots as thousands)
  if (/^\d{1,3}(\.\d{3})+$/.test(s.replace(/^-/, ''))) {
    s = s.replace(/\./g, '');
  }
  // Handle comma thousands: 1,234,567
  else if (/^\d{1,3}(,\d{3})+$/.test(s.replace(/^-/, ''))) {
    s = s.replace(/,/g, '');
  }
  // Mixed formats: remove everything non-numeric except minus
  else {
    // If there's a decimal separator (last dot or comma followed by 1-2 digits)
    s = s.replace(/[.,](\d{1,2})$/, '');
    s = s.replace(/[.,]/g, '');
  }
  
  s = s.replace(/[^\d-]/g, '');
  const n = parseInt(s, 10);
  if (isNaN(n) || n === 0) return 0;
  
  if (isParenNeg || isDashNeg) return -Math.abs(n);
  return n;
}

// ---------------------------------------------------------------------------
// COLUMN DETECTOR
// ---------------------------------------------------------------------------

function detectColumns(headerRow) {
  const result = { dateIdx: -1, descIdx: -1, creditIdx: -1, debitIdx: -1, amountIdx: -1 };
  if (!Array.isArray(headerRow)) return result;

  headerRow.forEach((cell, i) => {
    const n = norm(cell);
    if (!n || n.length < 2) return;

    // Skip saldo/balance columns
    if (matchesAny(n, COL_SIGNATURES.exclude)) return;

    if (result.dateIdx   === -1 && matchesAny(n, COL_SIGNATURES.date))   result.dateIdx   = i;
    if (result.descIdx   === -1 && matchesAny(n, COL_SIGNATURES.desc))   result.descIdx   = i;
    if (result.creditIdx === -1 && matchesAny(n, COL_SIGNATURES.credit)) result.creditIdx = i;
    if (result.debitIdx  === -1 && matchesAny(n, COL_SIGNATURES.debit))  result.debitIdx  = i;
    if (result.amountIdx === -1 && matchesAny(n, COL_SIGNATURES.amount)) result.amountIdx = i;
  });

  return result;
}

function scoreHeaderRow(row) {
  let score = 0;
  if (!Array.isArray(row)) return 0;
  
  // Must have at least some non-empty cells
  const nonEmpty = row.filter(c => c != null && String(c).trim() !== '');
  if (nonEmpty.length < 2) return 0;
  
  const cols = detectColumns(row);
  if (cols.dateIdx   !== -1) score += 2; // Date is critical
  if (cols.descIdx   !== -1) score += 1;
  if (cols.creditIdx !== -1) score += 2;
  if (cols.debitIdx  !== -1) score += 1;
  if (cols.amountIdx !== -1) score += 1;
  
  return score;
}

// ---------------------------------------------------------------------------
// MAIN PARSER
// ---------------------------------------------------------------------------

export function parseBankData(rows, bankName) {
  const movements = [];
  const warnings  = [];
  const errors    = [];

  if (!rows || rows.length < 2) {
    errors.push(`El archivo de ${bankName} está vacío o tiene menos de 2 filas.`);
    return { movements, warnings, errors };
  }

  // ---- 1. Find best header row ----
  let headerRowIdx = -1;
  let bestScore    = 0;
  const scanLimit  = Math.min(rows.length, 50);

  for (let i = 0; i < scanLimit; i++) {
    const score = scoreHeaderRow(rows[i]);
    if (score > bestScore) {
      bestScore    = score;
      headerRowIdx = i;
    }
    if (score >= 4) break; // Very confident
  }

  if (headerRowIdx === -1 || bestScore < 2) {
    errors.push(
      `No se detectaron columnas válidas en ${bankName}. ` +
      `Asegúrate de que el archivo tenga encabezados como: "Fecha", "Descripción", "Abono"/"Cargo" o "Monto". ` +
      `Columnas encontradas en primera fila: ${(rows[0] || []).filter(Boolean).join(', ')}`
    );
    return { movements, warnings, errors };
  }

  const cols = detectColumns(rows[headerRowIdx]);

  if (cols.descIdx === -1) {
    warnings.push(`${bankName}: no se detectó columna de descripción. Los movimientos se importarán sin glosa.`);
  }

  // Determine amount strategy
  const hasSeparateColumns = cols.creditIdx !== -1 || cols.debitIdx !== -1;
  const hasGenericAmount = cols.amountIdx !== -1;

  if (!hasSeparateColumns && !hasGenericAmount) {
    errors.push(
      `${bankName}: no se detectó columna de montos. ` +
      `Encabezados detectados: ${rows[headerRowIdx].filter(Boolean).join(', ')}`
    );
    return { movements, warnings, errors };
  }

  // ---- 2. Parse data rows ----
  let skippedRows = 0;
  
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c == null || c === '')) continue;

    // Determine amount
    let amount = 0;
    
    if (hasSeparateColumns) {
      // Separate Cargo/Abono columns
      const rawCredit = cols.creditIdx !== -1 ? row[cols.creditIdx] : null;
      const rawDebit  = cols.debitIdx  !== -1 ? row[cols.debitIdx]  : null;

      const creditVal = parseAmount(rawCredit);
      const debitVal  = parseAmount(rawDebit);

      if (creditVal !== 0) {
        amount = Math.abs(creditVal); // Credits are positive
      } else if (debitVal !== 0) {
        amount = -Math.abs(debitVal); // Debits are negative
      } else if (hasGenericAmount) {
        // Fallback to generic amount column
        amount = parseAmount(row[cols.amountIdx]);
      }
    } else {
      // Single amount column — trust its sign
      amount = parseAmount(row[cols.amountIdx]);
    }

    if (amount === 0) {
      skippedRows++;
      continue;
    }

    // Date
    const rawDate = cols.dateIdx !== -1 ? row[cols.dateIdx] : null;
    const date    = parseExcelDate(rawDate);
    if (!date && rawDate) {
      // Only warn if there was a value but we couldn't parse it
      warnings.push(`Fila ${i + 1}: fecha no reconocida ("${rawDate}").`);
    }

    // Description
    const desc =
      cols.descIdx !== -1 && row[cols.descIdx] != null
        ? String(row[cols.descIdx]).trim().replace(/\s+/g, ' ')
        : 'Sin descripción';

    movements.push({
      date:        date ?? 'S/F',
      description: desc,
      amount,
      bank:        bankName,
    });
  }

  if (skippedRows > 0 && movements.length > 0) {
    warnings.push(`${bankName}: se omitieron ${skippedRows} filas con monto cero o vacío.`);
  }

  if (movements.length === 0 && errors.length === 0) {
    warnings.push(
      `${bankName}: el archivo fue procesado pero no contiene movimientos con montos válidos. ` +
      `Se encontró header en fila ${headerRowIdx + 1} con columnas: ${rows[headerRowIdx].filter(Boolean).join(', ')}`
    );
  }

  return { movements, warnings, errors };
}
