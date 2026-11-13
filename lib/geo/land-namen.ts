// Van de landaanduiding van een platform naar onze alpha-2-code, voor de kaart per dag.
//
// Elk platform noemt een land anders. Google en Meta geven de alpha-2-code (of een criterium dat
// lib/countries.ts kent), Microsoft de Engelse naam ("Netherlands"), LinkedIn een geo-urn
// ("urn:li:geo:102890719"). De kaart rekent in alpha-2 (lib/geo/iso-numeric.ts).
//
// WAT NIET TE VERTALEN VALT, VERDWIJNT NIET STIL. De lezers tellen de rijen die hier null opleveren
// en noemen ze ("3 rijen met een onbekend land"), zoals lib/geo/region-rows.ts dat voor staten doet.
//
// De LinkedIn-urns zijn de geo-ids van de landen waar onze klanten adverteren. Ze zijn nog niet
// tegen een echte LinkedIn-sync gelegd (die is er nog niet): een urn die hier ontbreekt, valt als
// onbekend af en wordt genoemd, en hoort dan hier bij.

/** Engelse landnaam (kleine letters) naar alpha-2. */
const ENGELS: Record<string, string> = {
  "netherlands": "NL", "the netherlands": "NL", "germany": "DE", "belgium": "BE", "france": "FR",
  "united kingdom": "GB", "great britain": "GB", "austria": "AT", "switzerland": "CH", "spain": "ES",
  "italy": "IT", "portugal": "PT", "poland": "PL", "sweden": "SE", "denmark": "DK", "norway": "NO",
  "finland": "FI", "ireland": "IE", "luxembourg": "LU", "united states": "US",
  "united states of america": "US", "canada": "CA", "australia": "AU", "new zealand": "NZ",
  "czech republic": "CZ", "czechia": "CZ", "slovakia": "SK", "hungary": "HU", "romania": "RO",
  "bulgaria": "BG", "greece": "GR", "croatia": "HR", "slovenia": "SI", "estonia": "EE", "latvia": "LV",
  "lithuania": "LT", "iceland": "IS", "malta": "MT", "cyprus": "CY", "mexico": "MX", "brazil": "BR",
  "argentina": "AR", "chile": "CL", "colombia": "CO", "china": "CN", "japan": "JP", "india": "IN",
  "singapore": "SG", "south korea": "KR", "hong kong": "HK", "united arab emirates": "AE",
  "saudi arabia": "SA", "israel": "IL", "turkey": "TR", "turkiye": "TR", "south africa": "ZA",
  "egypt": "EG", "morocco": "MA", "ukraine": "UA",
};

/** Een landnaam of -code naar alpha-2; null als hij niet te herkennen is. */
export function landcodeUitNaam(naam: string | null | undefined): string | null {
  const w = (naam ?? "").trim();
  if (!w) return null;
  if (/^[A-Za-z]{2}$/.test(w)) return w.toUpperCase();
  return ENGELS[w.toLowerCase()] ?? null;
}

/** LinkedIn-geo-urn van een land naar alpha-2. */
const LINKEDIN_LAND: Record<string, string> = {
  "urn:li:geo:102890719": "NL", "urn:li:geo:101282230": "DE", "urn:li:geo:100565514": "BE",
  "urn:li:geo:105015875": "FR", "urn:li:geo:101165590": "GB", "urn:li:geo:103644278": "US",
  "urn:li:geo:101174742": "CA", "urn:li:geo:105646813": "ES", "urn:li:geo:103350119": "IT",
  "urn:li:geo:101452733": "AU", "urn:li:geo:103883259": "AT", "urn:li:geo:106693272": "CH",
};

/** Een LinkedIn MEMBER_COUNTRY-urn naar alpha-2; null als de urn onbekend is. */
export function landcodeUitLinkedInUrn(urn: string | null | undefined): string | null {
  return LINKEDIN_LAND[(urn ?? "").trim()] ?? null;
}
