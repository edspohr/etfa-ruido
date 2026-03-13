/**
 * parseBankStatement.js
 * Robust, bank-agnostic Excel cartola parser for Chilean banks.
 *
 * Strategy:
 * 1. Scan every row for a header signature (fecha + abono/monto columns).
 * 2. Map columns by keyword matching with normalized comparison (no accents, lowercase).
 * 3. Parse amounts and dates defensively, with explicit error reporting per row.
 * 4. Return { movements, errors, warnings } so the UI can surface issues.
 */

import * as XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/** Remove accents and lowercase — makes "Descripción" == "descripcion" */
const norm = (v) =>
  String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

/** Keyword groups for each logical column */
const COL_SIGNATURES = {
  date:   ['fecha', 'date', 'fec.', 'fec'],
  desc:   ['descripcion', 'descripción', 'detalle', 'glosa', 'concepto', 'movimiento', 'transaccion'],
  credit: ['abono', 'credito', 'crédito', 'credit', 'deposito', 'depósito', 'ingreso'],
  debit:  ['cargo', 'debito', 'débito', 'debit', 'egreso', 'retiro'],
  amount: ['monto', 'importe', 'valor', 'amount'],
  // "saldo" / "balance" columns must be excluded — they look like amounts but aren't
  exclude: ['saldo', 'balance', 'acumulado'],
};

/** Returns true if the cell matches any keyword in the list */
const matchesAny = (cell, keywords) => {
  const n = norm(cell);
  return keywords.some((k) => n === k || n.startsWith(k) || n.includes(k));
};

/** Parse an Excel date serial, a DD/MM/YYYY string, or a YYYY-MM-DD string → "DD/MM/YYYY" */
export function parseExcelDate(raw) {
  if (raw == null || raw === '') return null;

  // 1. Excel numeric serial
  if (typeof raw === 'number') {
    try {
      const d = XLSX.SSF.parse_date_code(raw);
      if (d && d.y > 1900) {
        return `${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.y}`;
      }
    } catch { /* fall through */ }
  }

  const s = String(raw).trim();

  // 2. DD/MM/YYYY or DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
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

  // 4. Last resort: try JS Date
  const jsDate = new Date(s);
  if (!isNaN(jsDate.getTime())) {
    return jsDate.toLocaleDateString('es-CL');
  }

  return null; // unparseable
}

/** Parse a cell value as a CLP amount. Supports explicit negatives. */
export function parseAmount(raw) {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number') return Math.round(raw);

  let s = String(raw).trim();
  // Detect explicit negatives: "(1.234)" or "-1.234"
  const isNegative = /^\(/.test(s) || /^-/.test(s);
  // Remove thousands separators (dots in CLP, commas in EN)
  s = s.replace(/\./g, '').replace(/,/g, '').replace(/[^0-9-]/g, '');
  const n = parseInt(s, 10);
  if (isNaN(n) || n === 0) return 0;
  // If we already detected negative via regex, ensure it's negative.
  // Otherwise respect the parsed number's sign.
  return isNegative ? -Math.abs(n) : n;
}

// ---------------------------------------------------------------------------
// COLUMN DETECTOR
// ---------------------------------------------------------------------------

/**
 * Given a header row (array of cell values), return column index map:
 * { dateIdx, descIdx, creditIdx, debitIdx, amountIdx }
 * Any missing column is -1.
 */
function detectColumns(headerRow) {
  const result = { dateIdx: -1, descIdx: -1, creditIdx: -1, debitIdx: -1, amountIdx: -1 };
  if (!Array.isArray(headerRow)) return result;

  headerRow.forEach((cell, i) => {
    const n = norm(cell);
    if (!n) return;

    // Exclude saldo/balance columns from amount candidates
    if (matchesAny(n, COL_SIGNATURES.exclude)) return;

    if (result.dateIdx   === -1 && matchesAny(n, COL_SIGNATURES.date))   result.dateIdx   = i;
    if (result.descIdx   === -1 && matchesAny(n, COL_SIGNATURES.desc))   result.descIdx   = i;
    if (result.creditIdx === -1 && matchesAny(n, COL_SIGNATURES.credit)) result.creditIdx = i;
    if (result.debitIdx  === -1 && matchesAny(n, COL_SIGNATURES.debit))  result.debitIdx  = i;
    if (result.amountIdx === -1 && matchesAny(n, COL_SIGNATURES.amount)) result.amountIdx = i;
  });

  return result;
}

/**
 * Score a potential header row. Returns a number 0-4.
 * Higher = more likely to be the real header.
 */
function scoreHeaderRow(row) {
  let score = 0;
  if (!Array.isArray(row)) return 0;
  const cols = detectColumns(row);
  if (cols.dateIdx   !== -1) score++;
  if (cols.descIdx   !== -1) score++;
  if (cols.creditIdx !== -1 || cols.amountIdx !== -1) score++;
  if (cols.debitIdx  !== -1) score++;
  return score;
}

// ---------------------------------------------------------------------------
// MAIN PARSER
// ---------------------------------------------------------------------------

/**
 * parseBankData(rows, bankName)
 * @param {Array<Array>} rows   — output of XLSX.utils.sheet_to_json(ws, {header:1})
 * @param {string}       bankName — 'Itaú' | 'Santander' | etc.
 * @returns {{ movements: Array, warnings: Array, errors: Array }}
 */
export function parseBankData(rows, bankName) {
  const movements = [];
  const warnings  = [];
  const errors    = [];

  if (!rows || rows.length < 2) {
    errors.push(`El archivo de ${bankName} está vacío o tiene menos de 2 filas.`);
    return { movements, warnings, errors };
  }

  // ---- 1. Find best header row (scan first 50 rows) ----
  let headerRowIdx = -1;
  let bestScore    = 0;
  const scanLimit  = Math.min(rows.length, 50);

  for (let i = 0; i < scanLimit; i++) {
    const score = scoreHeaderRow(rows[i]);
    if (score > bestScore) {
      bestScore    = score;
      headerRowIdx = i;
    }
    if (score >= 3) break; // Good enough, stop scanning
  }

  if (headerRowIdx === -1 || bestScore < 2) {
    errors.push(
      `No se detectaron columnas de Fecha y Monto/Abono en ${bankName}. ` +
      `Asegúrate de que el archivo Excel tenga encabezados como: "Fecha", "Descripción", "Abono" o "Monto".`
    );
    return { movements, warnings, errors };
  }

  const cols = detectColumns(rows[headerRowIdx]);

  // Warn about missing optional columns
  if (cols.descIdx === -1)
    warnings.push(`${bankName}: no se detectó columna de descripción. Los movimientos se importarán sin glosa.`);

  // Determine which column to use for credit amounts
  // Priority: dedicated credit column > generic amount column
  const amountColIdx = cols.creditIdx !== -1 ? cols.creditIdx : cols.amountIdx;

  if (amountColIdx === -1) {
    errors.push(
      `${bankName}: no se detectó columna de montos (Abono/Monto). ` +
      `Columnas encontradas: ${rows[headerRowIdx].filter(Boolean).join(', ')}`
    );
    return { movements, warnings, errors };
  }

  // ---- 2. Parse data rows ----
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c == null || c === '')) continue; // empty row

    // Determine absolute amount based on columns available
    let amount = 0;
    const rawCredit = cols.creditIdx !== -1 ? row[cols.creditIdx] : null;
    const rawDebit  = cols.debitIdx  !== -1 ? row[cols.debitIdx]  : null;
    const rawAmount = cols.amountIdx !== -1 ? row[cols.amountIdx] : null;

    if (rawCredit != null && rawCredit !== '') {
      // It's a credit column -> treat as positive
      amount = Math.abs(parseAmount(rawCredit));
    } else if (rawDebit != null && rawDebit !== '') {
      // It's a debit column -> treat as negative
      amount = -Math.abs(parseAmount(rawDebit));
    } else if (rawAmount != null && rawAmount !== '') {
      // It's a generic amount column -> trust its internal sign
      amount = parseAmount(rawAmount);
    }

    if (amount === 0) continue; // Skip zero-value or unparseable rows

    // Date
    const rawDate = cols.dateIdx !== -1 ? row[cols.dateIdx] : null;
    const date    = parseExcelDate(rawDate);
    if (!date) {
      warnings.push(`Fila ${i + 1}: fecha no reconocida ("${rawDate}"). Movimiento incluido con fecha S/F.`);
    }

    // Description
    const desc =
      cols.descIdx !== -1 && row[cols.descIdx] != null
        ? String(row[cols.descIdx]).trim()
        : 'Sin descripción';

    movements.push({
      date:        date ?? 'S/F',
      description: desc,
      amount,
      bank:        bankName,
    });
  }

  if (movements.length === 0 && errors.length === 0) {
    warnings.push(
      `${bankName}: el archivo fue procesado pero no contiene movimientos de abono en el rango de datos.`
    );
  }

  return { movements, warnings, errors };
}
