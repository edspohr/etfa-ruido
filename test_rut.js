import { validateRut, formatRut } from './src/utils/parseInvoicePDF.js';

const RUT_PATTERNS = [
  /(?:\s|^|RUT:?\s*)(\d{1,2}\.\d{3}\.\d{3}-[\dkK])(?:\s|$)/i,
  /(?:\s|^|RUT:?\s*)(\d{7,8}-[\dkK])(?:\s|$)/i,
  /(?:\s|^|RUT:?\s*)(\d{8,9})(?:\s|$)/i,
];

const normalized = "RUT: 76.123.456-7 Monto Neto 1.500.000 Total 1.785.000";

let foundRut = null;

for (const pattern of RUT_PATTERNS) {
  const matches = [...normalized.matchAll(new RegExp(pattern.source, 'ig'))];
  console.log(`Pattern ${pattern.source} found ${matches.length} matches`);
  for (const m of matches) {
    const candidate = m[1];
    console.log("Candidate:", candidate);
    const withDash = candidate.includes('-') ? candidate : candidate.slice(0, -1) + '-' + candidate.slice(-1);
    if (validateRut(withDash)) {
      foundRut = formatRut(withDash);
      console.log("Valid RUT found:", foundRut);
      break;
    } else {
      console.log("RUT validation failed for:", withDash);
    }
  }
  if (foundRut) break;
}
