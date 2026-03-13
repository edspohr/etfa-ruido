import { extractInvoiceData } from './src/utils/parseInvoicePDF.js';

const t1 = `RUT: 76.123.456-7 Total Neto $ 1.500.000 IVA $ 285.000 Total a Pagar $ 1.785.000`;
console.log("Test 1:", extractInvoiceData(t1));

const t2 = `RUT: 76123456-7 Monto Neto $1.500.000 Total $ 1.785.000`;
console.log("Test 2:", extractInvoiceData(t2));
