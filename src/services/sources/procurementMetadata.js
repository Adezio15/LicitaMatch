const states = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));

export function normalizeUf(value) {
  const uf = String(value || '').trim().toUpperCase();
  return states.has(uf) ? uf : null;
}

// These are PNCP IDs, not Compras.gov's distinct codigoModalidade domain.
export function pncpModalidade(id, name) {
  if (Number(id) === 6) return 'Pregão - Eletrônico';
  if (Number(id) === 7) return 'Pregão - Presencial';
  return String(name || 'N/D').trim() || 'N/D';
}
