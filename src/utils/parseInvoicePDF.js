/**
 * parseInvoicePDF.js
 * Reliable data extractor for Chilean invoice PDFs (boletas/facturas).
 *
 * Returns: { rut, amount, date, projectCode, projectId, clientName, raw }
 * Every field is null if not found — callers must validate.
 *
 * v2 improvements:
 * - Better amount detection: prioritizes "Monto Total" > "Total" > "Neto"
 * - Handles IVA discrimination (won't confuse IVA line with total)
 * - Better RUT extraction with looser patterns for scanned docs
 * - Improved project matching with fuzzy code search
 * - Better date parsing for Chilean formats
 */
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerURL;

// ---------------------------------------------------------------------------
// RUT VALIDATOR
// ---------------------------------------------------------------------------
export function validateRut(rut) {
  if (!rut) return false;
  const clean = rut.replace(/[.\-\s]/g, '').toUpperCase();
  if (!/^\d{7,8}[0-9K]$/.test(clean)) return false;

  const body = clean.slice(0, -1);
  const dv   = clean.slice(-1);
  let sum = 0, factor = 2;

  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i], 10) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }

  const expected = 11 - (sum % 11);
  const dvExpected =
    expected === 11 ? '0' : expected === 10 ? 'K' : String(expected);

  return dv === dvExpected;
}

/** Format a raw RUT string into XX.XXX.XXX-Y */
export function formatRut(raw) {
  const clean = raw.replace(/[.\-\s]/g, '').toUpperCase();
  const body  = clean.slice(0, -1);
  const dv    = clean.slice(-1);
  return body.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
}

// ---------------------------------------------------------------------------
// AMOUNT PARSER
// ---------------------------------------------------------------------------
function parseClpAmount(raw) {
  if (!raw) return 0;
  let s = String(raw).trim().replace(/\$/g, '');
  
  s = s.replace(/\s+/g, '');
  
  // CLP format: 1.500.000 (dots as thousands)
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  // Comma thousands: 1,500,000
  else if (/^\d{1,3}(,\d{3})+$/.test(s)) {
    s = s.replace(/,/g, '');
  }
  // Mixed: chop decimals then clean
  else {
    // If ends with ,XX or .XX (1-2 digits) treat as decimal
    s = s.replace(/[.,]\d{1,2}$/, '');
    s = s.replace(/[.,]/g, '');
  }
  
  s = s.replace(/[^\d]/g, '');
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : n;
}

// ---------------------------------------------------------------------------
// PATTERN BANKS
// ---------------------------------------------------------------------------

/**
 * Amount patterns — ordered by specificity and priority.
 * Strategy:
 * 1. Look for "TOTAL" (the final amount including IVA) — this is what appears in bank statements
 * 2. Look for "Monto Neto" as fallback
 * 3. Explicitly EXCLUDE IVA amounts
 */
const AMOUNT_PATTERNS = [
  // Highest priority: "TOTAL" or "Monto Total" (final amount with IVA)
  { regex: /total\s+a\s+pagar[\s:$]*([\d.,]{4,})/i, weight: 100, label: 'total_a_pagar' },
  { regex: /monto\s+total[\s:$]*([\d.,]{4,})/i,      weight: 95, label: 'monto_total' },
  // "Total" that's NOT followed by "neto" or "exento"
  { regex: /(?<!sub)total(?!\s*(?:neto|exento|afecto))[\s:$]*([\d.,]{4,})/i, weight: 90, label: 'total_generic' },
  // Neto amounts (lower priority — for when only neto is available)
  { regex: /monto\s+neto[\s:$]*([\d.,]{4,})/i, weight: 50, label: 'monto_neto' },
  { regex: /total\s+neto[\s:$]*([\d.,]{4,})/i, weight: 48, label: 'total_neto' },
  { regex: /neto[\s:$]*([\d.,]{4,})/i,          weight: 45, label: 'neto' },
  { regex: /afecto[\s:$]*([\d.,]{4,})/i,        weight: 40, label: 'afecto' },
  { regex: /subtotal[\s:$]*([\d.,]{4,})/i,      weight: 35, label: 'subtotal' },
  // Last resort: large number near $ sign
  { regex: /\$\s*([\d.,]{5,})/g, weight: 10, label: 'dollar_sign' },
];

/** IVA detection — used to filter out IVA amounts from candidates */
const IVA_PATTERNS = [
  /i\.?v\.?a\.?[\s:$]*([\d.,]{4,})/i,
  /impuesto[\s:$]*([\d.,]{4,})/i,
  /19\s*%[\s:$]*([\d.,]{4,})/i,
];

/** Razón Social patterns */
const RAZON_SOCIAL_PATTERNS = [
  /SE[ÑN]OR(?:\(ES\))?:?\s*(.*?)(?=\s*R\.?U\.?T|GIRO|\n|$)/i,
  /(?:Nombre|Raz[oó]n)\s+Social:?\s*(.*?)(?=\s*R\.?U\.?T|GIRO|\n|$)/i,
  /Cliente:?\s*(.*?)(?=\s*R\.?U\.?T|GIRO|\n|$)/i,
  /Receptor:?\s*(.*?)(?=\s*R\.?U\.?T|GIRO|\n|$)/i,
];

/** RUT patterns */
const RUT_PATTERNS = [
  // "R.U.T.: 76.123.456-7" or "RUT: 76.123.456 - 7"
  /R\.?U\.?T\.?\s*:?\s*(\d{1,2}\.\d{3}\.\d{3}\s*-\s*[\dkK])/i,
  // Standard with dots: 76.123.456-7
  /(\d{1,2}\.\d{3}\.\d{3}\s*-\s*[\dkK])/i,
  // Without dots: 76123456-7
  /(\d{7,8}\s*-\s*[\dkK])/i,
];

/** Date patterns → normalized to YYYY-MM-DD */
const DATE_PATTERNS = [
  // Highest priority: explicit Chilean invoice label "Fecha Emisión:" or "Fecha de Emisión:"
  { regex: /Fecha\s+(?:de\s+)?Emisi[oó]n\s*:\s*(\d{1,2})[/](\d{1,2})[/](\d{4})/i, fmt: ([, d, m, y]) => `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}` },
  // Generic date with optional Fecha label prefix
  { regex: /(?:Fecha\s*(?:de\s*)?(?:Emisi[oó]n|Documento)?:?\s*)(\d{1,2})[/-](\d{1,2})[/-](\d{4})/i, fmt: ([, d, m, y]) => `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}` },
  // DD/MM/YYYY fallback — NOTE: ambiguous with MM/DD/YYYY for days ≤ 12; assumes Chilean D/M/Y order
  { regex: /(\d{2})[/-](\d{2})[/-](\d{4})/, fmt: ([, d, m, y]) => `${y}-${m}-${d}` },
  { regex: /(\d{4})[/-](\d{2})[/-](\d{2})/, fmt: ([, y, m, d]) => `${y}-${m}-${d}` },
  {
    regex: /(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(\d{4})/i,
    fmt: ([, d, mes, y]) => {
      const months = { enero:'01',febrero:'02',marzo:'03',abril:'04',mayo:'05',junio:'06',
                       julio:'07',agosto:'08',septiembre:'09',octubre:'10',noviembre:'11',diciembre:'12' };
      const m = months[mes.toLowerCase()] ?? '01';
      return `${y}-${m}-${d.padStart(2,'0')}`;
    },
  },
];

// ---------------------------------------------------------------------------
// MAIN EXTRACTOR
// ---------------------------------------------------------------------------

export function extractInvoiceData(text, projects = []) {
  if (!text || text.trim().length < 10) {
    return { rut: null, amount: 0, date: null, projectCode: null, projectId: null, clientName: null };
  }

  const normalized = text.replace(/\s+/g, ' ');

  // ---- 1. Detect IVA amounts to exclude them ----
  const ivaAmounts = new Set();
  for (const pattern of IVA_PATTERNS) {
    const matches = [...normalized.matchAll(new RegExp(pattern.source, 'gi'))];
    for (const m of matches) {
      const n = parseClpAmount(m[1]);
      if (n > 0) ivaAmounts.add(n);
    }
  }

  // ---- 2. Amount extraction ----
  let bestAmount = 0, bestWeight = -1, bestLabel = '';

  for (const { regex, weight, label } of AMOUNT_PATTERNS) {
    const candidates = [];
    let m;
    const iterRe = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
    while ((m = iterRe.exec(normalized)) !== null) {
      const n = parseClpAmount(m[1]);
      // Sanity: CLP invoices are usually > 500 and < 500,000,000
      if (n >= 500 && n <= 500_000_000) {
        // Skip if this exact amount matches a known IVA amount
        if (!ivaAmounts.has(n)) {
          candidates.push(n);
        }
      }
    }

    if (candidates.length > 0 && weight > bestWeight) {
      // For "total" patterns, pick the LARGEST (IVA-inclusive is always larger than neto)
      // For "neto" patterns, also pick largest
      bestAmount = Math.max(...candidates);
      bestWeight = weight;
      bestLabel = label;
    }
  }

  // ---- 3. RUT extraction ----
  let foundRut = null;
  // Collect ALL RUTs found in the document
  const allRuts = [];

  for (const pattern of RUT_PATTERNS) {
    const matches = [...normalized.matchAll(new RegExp(pattern.source, 'gi'))];
    for (const m of matches) {
      const candidate = m[1].trim();
      const withDash = candidate.includes('-') ? candidate : candidate.slice(0, -1) + '-' + candidate.slice(-1);
      if (validateRut(withDash)) {
        allRuts.push(formatRut(withDash));
      }
    }
  }

  // Deduplicate
  const uniqueRuts = [...new Set(allRuts)];
  
  // If we found multiple RUTs, the FIRST one is usually the emitter (ETFA),
  // the SECOND is the client/receptor.
  // For conciliation, we want the CLIENT RUT.
  if (uniqueRuts.length >= 2) {
    foundRut = uniqueRuts[1]; // Second RUT = client
  } else if (uniqueRuts.length === 1) {
    foundRut = uniqueRuts[0];
  }

  // ---- 4. Date extraction ----
  let foundDate = null;

  for (const { regex, fmt } of DATE_PATTERNS) {
    const m = normalized.match(regex);
    if (m) {
      try {
        const candidate = fmt(m);
        const year = parseInt(candidate.split('-')[0], 10);
        if (year >= 2015 && year <= 2035) {
          foundDate = candidate;
          break;
        }
      } catch { /* skip */ }
    }
  }

  // ---- 5. Client Name (Razón Social) ----
  let foundClientName = null;
  for (const pattern of RAZON_SOCIAL_PATTERNS) {
    const m = normalized.match(pattern);
    if (m && m[1]) {
      const candidate = m[1].trim().replace(/\s+/g, ' ');
      if (candidate.length > 2 && !candidate.toLowerCase().includes('r.u.t') && candidate.length < 100) {
        foundClientName = candidate;
        break;
      }
    }
  }

  // ---- 6. Project matching ----
  let foundProjectCode = null;
  let foundProjectId = null;
  let foundProject = null;

  if (projects.length > 0) {
    const lowerText = normalized.toLowerCase();
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Pass 1: code-only match (longer codes first to avoid partial matches)
    const sortedByCode = [...projects]
      .filter(p => p.code && p.code.length >= 2)
      .sort((a, b) => b.code.length - a.code.length);

    let codeOnlyMatch = null;
    for (const p of sortedByCode) {
      const codeRegex = new RegExp(`\\b${escape(p.code)}\\b`, 'i');
      if (codeRegex.test(lowerText)) {
        codeOnlyMatch = p;
        break;
      }
    }

    // Pass 2: code + recurrence combinations — more specific, preferred over code-only
    let codeRecurrenceMatch = null;
    const withRecurrence = sortedByCode.filter(p => p.recurrence);
    for (const p of withRecurrence) {
      const code = p.code.toLowerCase();
      const rec  = p.recurrence.toLowerCase().trim();
      const patterns = [
        `${code} ${rec}`,   // "ETF-001 A"
        `${code}-${rec}`,   // "ETF-001-A"
        `${code}${rec}`,    // "ETF-001A"
      ];
      const matched = patterns.some(pat => new RegExp(`\\b${escape(pat)}\\b`, 'i').test(lowerText));
      if (matched) { codeRecurrenceMatch = p; break; }
    }

    foundProject = codeRecurrenceMatch || codeOnlyMatch;
    if (foundProject) {
      foundProjectCode = foundProject.code;
      foundProjectId   = foundProject.id;
    }

    // Fallback: try by project name (only long names to avoid false positives)
    if (!foundProjectId) {
      const sortedByName = [...projects]
        .filter(p => p.name && p.name.length >= 6)
        .sort((a, b) => b.name.length - a.name.length);

      for (const p of sortedByName) {
        if (lowerText.includes(p.name.toLowerCase())) {
          foundProjectCode = p.code || null;
          foundProjectId = p.id;
          foundProject = p;
          break;
        }
      }
    }
  }

  return {
    rut:               foundRut,
    amount:            bestAmount,
    date:              foundDate,
    projectCode:       foundProjectCode,
    projectId:         foundProjectId,
    projectRecurrence: foundProject?.recurrence || null,
    clientName:        foundClientName,
    _debug: {
      amountLabel: bestLabel,
      amountWeight: bestWeight,
      ivaAmountsDetected: [...ivaAmounts],
      rutsFound: uniqueRuts
    }
  };
}

// ---------------------------------------------------------------------------
// PDF TEXT READER
// ---------------------------------------------------------------------------

export async function getPdfText(file, maxPages = 5) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const limit = Math.min(pdf.numPages, maxPages);
    let fullText = '';

    for (let p = 1; p <= limit; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      fullText += content.items.map((i) => i.str).join(' ') + '\n';
    }

    if (fullText.trim().length < 10) {
      return null; // Scanned PDF — return null so caller can handle
    }
    
    return fullText;
  } catch (e) {
    console.error('[getPdfText] Error reading PDF:', e);
    return null;
  }
}
