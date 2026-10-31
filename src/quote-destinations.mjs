// The address a shipping quote is asked for when only the country is known.
// Printful needs a state for the US, Canada and Australia, and Gooten and
// Lumaprints price by postcode, so a comparison quotes one reference address
// per country (a central or capital-city one). The quote's basis names it;
// a buyer elsewhere in the country can pay a different rate.
// QUOTE_REFERENCE_ADDRESSES (JSON, by country code) replaces any of them.
export const REFERENCE_ADDRESSES = Object.freeze({
  US: { city: 'Kansas City', state: 'MO', postalCode: '64105', address1: '1 W Pershing Rd' },
  CA: { city: 'Toronto', state: 'ON', postalCode: 'M5H 2N2', address1: '100 Queen St W' },
  GB: { city: 'London', state: '', postalCode: 'EC1A 1BB', address1: '1 St Martin\'s Le Grand' },
  AU: { city: 'Sydney', state: 'NSW', postalCode: '2000', address1: '1 Martin Pl' },
  DE: { city: 'Berlin', state: '', postalCode: '10117', address1: 'Unter den Linden 1' },
  FR: { city: 'Paris', state: '', postalCode: '75001', address1: '1 Rue de Rivoli' },
  IT: { city: 'Roma', state: '', postalCode: '00186', address1: 'Via del Corso 1' },
  NL: { city: 'Amsterdam', state: '', postalCode: '1012 JS', address1: 'Dam 1' },
  DK: { city: 'København', state: '', postalCode: '1550', address1: 'Rådhuspladsen 1' },
  IE: { city: 'Dublin', state: '', postalCode: 'D02 X285', address1: '1 O\'Connell St' },
  NO: { city: 'Oslo', state: '', postalCode: '0150', address1: 'Karl Johans gate 1' },
  AT: { city: 'Wien', state: '', postalCode: '1010', address1: 'Stephansplatz 1' },
  BE: { city: 'Bruxelles', state: '', postalCode: '1000', address1: 'Grand-Place 1' },
  PT: { city: 'Lisboa', state: '', postalCode: '1100-148', address1: 'Praça do Comércio 1' },
  ES: { city: 'Madrid', state: '', postalCode: '28013', address1: 'Puerta del Sol 1' },
  CZ: { city: 'Praha', state: '', postalCode: '110 00', address1: 'Staroměstské nám. 1' },
  FI: { city: 'Helsinki', state: '', postalCode: '00100', address1: 'Mannerheimintie 1' },
  LU: { city: 'Luxembourg', state: '', postalCode: '1648', address1: 'Place Guillaume II 1' },
  NZ: { city: 'Auckland', state: '', postalCode: '1010', address1: '1 Queen St' },
  SE: { city: 'Stockholm', state: '', postalCode: '111 52', address1: 'Drottninggatan 1' },
  CH: { city: 'Zürich', state: '', postalCode: '8001', address1: 'Bahnhofstrasse 1' },
  PL: { city: 'Warszawa', state: '', postalCode: '00-001', address1: 'Plac Zamkowy 1' }
});

export function referenceAddress(countryCode) {
  const code = String(countryCode || '').trim().toUpperCase();
  let overrides = {};
  try { overrides = JSON.parse(process.env.QUOTE_REFERENCE_ADDRESSES || '{}') || {}; } catch { overrides = {}; }
  const chosen = overrides[code] || REFERENCE_ADDRESSES[code] || null;
  return chosen ? { countryCode: code, city: '', state: '', postalCode: '', address1: '', ...chosen } : { countryCode: code, city: '', state: '', postalCode: '', address1: '' };
}

export function describeReferenceAddress(address) {
  return [address.city, address.state, address.postalCode, address.countryCode].filter(Boolean).join(', ');
}
