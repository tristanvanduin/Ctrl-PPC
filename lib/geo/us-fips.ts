// us-atlas identificeert Amerikaanse staten met hun FIPS-code (feature.id, bv. "06" = Californië),
// terwijl geo-data staten doorgaans met de USPS-afkorting labelt (CA, TX, NY). Deze tabel koppelt
// FIPS → USPS zodat de staten-choropleth de waarden (gekeyd op USPS) op de juiste vorm kan leggen.
// De omgekeerde richting (USPS → FIPS) wordt afgeleid voor waar dat handig is.

export const FIPS_TO_USPS: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT",
  "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL",
  "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD",
  "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE",
  "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
  "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV",
  "55": "WI", "56": "WY", "72": "PR",
};

export const USPS_TO_NAME: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "Californië",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaï", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};

export function stateLabel(usps: string): string {
  return USPS_TO_NAME[usps.toUpperCase()] ?? usps;
}

// Google Ads levert regio's als Engelse staatsnaam (region_name = "California", "New York").
// Deze omgekeerde tabel koppelt de Engelse naam → USPS zodat de sync/read-laag de VS-staten
// op de kaart kan leggen. Genormaliseerd op lowercase; onbekende namen vallen weg (blijven wél
// in de onderliggende tabel, komen alleen niet op de staten-kaart).
const ENGLISH_STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
  washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
};

// Zet een Google region_name (of losse USPS-code) om naar een USPS-staatcode; null als het geen
// herkenbare Amerikaanse staat is.
export function regionNameToUsps(regionName: string | null | undefined): string | null {
  if (!regionName) return null;
  const raw = regionName.trim();
  if (/^[A-Za-z]{2}$/.test(raw) && FIPS_TO_USPS && Object.values(FIPS_TO_USPS).includes(raw.toUpperCase())) {
    return raw.toUpperCase();
  }
  return ENGLISH_STATE_NAMES[raw.toLowerCase()] ?? null;
}
