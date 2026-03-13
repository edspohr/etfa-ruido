function validateRut(rut) {
  if (!rut) return false;
  const clean = rut.replace(/[.\-\s]/g, '').toUpperCase();
  if (!/^\d{7,8}[0-9K]$/.test(clean)) return false;

  const body = clean.slice(0, -1);
  const dv   = clean.slice(-1);
  let sum = 0, factor = 2;

  console.log("Validating:", clean, "Body:", body, "DV:", dv);

  for (let i = body.length - 1; i >= 0; i--) {
    let part = parseInt(body[i], 10) * factor;
    sum += part;
    console.log(`char: ${body[i]} * ${factor} = ${part} (sum: ${sum})`);
    factor = factor === 7 ? 2 : factor + 1;
  }

  const expected = 11 - (sum % 11);
  let dvExpected = expected === 11 ? '0' : expected === 10 ? 'K' : String(expected);

  console.log("Expected DV:", dvExpected, "Actual DV:", dv);
  return dv === dvExpected;
}

validateRut('76.123.456-7');
validateRut('76.123.456-1'); // testing if 7 is just a bad test RUT
