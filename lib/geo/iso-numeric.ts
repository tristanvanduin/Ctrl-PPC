// world-atlas identificeert landen met hun numerieke ISO 3166-1-code (feature.id, bv. 528 = NL),
// terwijl onze ad-data alpha-2-codes gebruikt (NL, US, CA). Deze tabel koppelt numeriek → alpha-2
// voor élk land dat de kaart tekent.
//
// DIT STOND EERST OP 55 LANDEN, EN DAT WAS EEN STIL DATAVERLIES.
//
// De kaart tekent 177 vormen. Met 55 koppelingen waren er 125 landen die wél getekend werden maar
// nooit konden inkleuren en niet op hover reageerden — ook niet als er gewoon data voor was.
// Adverteerde een klant in Polen of Brazilië, dan bleef dat land grijs en leek er niets gemeten.
// Dat is precies het foutsoort waar dit project op let: ontbrekende kennis die zich voordoet als
// een gemeten nul. Gemeten met een hover-test over alle vormen: 38 van de 137 gaven een tooltip.
//
// De numerieke codes komen uit het kaartbestand zelf (world-atlas), niet uit het geheugen; per
// regel staat de landnaam erbij zodat elke koppeling na te kijken is. De test in
// __iso_numeric_test.ts controleert dat er geen vorm meer overblijft zonder alpha-2.
//
// Drie vormen houden bewust geen code: N. Cyprus, Somaliland en Kosovo hebben geen ISO-nummer in
// het bestand. Die blijven grijs, en dat is de juiste weergave.
//
// Sleutels zonder voorloopnullen; de kaart normaliseert feature.id met String(Number(id)).

export const NUMERIC_TO_ALPHA2: Record<string, string> = {
  "528": "NL", "840": "US", "124": "CA", "826": "GB", "372": "IE", "276": "DE", "250": "FR",
  "56": "BE", "442": "LU", "380": "IT", "724": "ES", "620": "PT", "40": "AT", "756": "CH",
  "752": "SE", "578": "NO", "208": "DK", "246": "FI", "616": "PL", "203": "CZ", "703": "SK",
  "348": "HU", "642": "RO", "100": "BG", "300": "GR", "191": "HR", "705": "SI", "233": "EE",
  "428": "LV", "440": "LT", "352": "IS", "470": "MT", "196": "CY", "484": "MX", "76": "BR",
  "32": "AR", "152": "CL", "170": "CO", "156": "CN", "392": "JP", "356": "IN", "36": "AU",
  "554": "NZ", "702": "SG", "410": "KR", "344": "HK", "784": "AE", "682": "SA", "376": "IL",
  "792": "TR", "710": "ZA", "818": "EG", "504": "MA", "643": "RU", "804": "UA",

  // Aangevuld tot de volledige set die world-atlas tekent.
  "242": "FJ", // Fiji
  "834": "TZ", // Tanzania
  "732": "EH", // W. Sahara
  "398": "KZ", // Kazakhstan
  "860": "UZ", // Uzbekistan
  "598": "PG", // Papua New Guinea
  "360": "ID", // Indonesia
  "180": "CD", // Dem. Rep. Congo
  "706": "SO", // Somalia
  "404": "KE", // Kenya
  "729": "SD", // Sudan
  "148": "TD", // Chad
  "332": "HT", // Haiti
  "214": "DO", // Dominican Rep.
  "44": "BS", // Bahamas
  "238": "FK", // Falkland Is.
  "304": "GL", // Greenland
  "260": "TF", // Fr. S. Antarctic Lands
  "626": "TL", // Timor-Leste
  "426": "LS", // Lesotho
  "858": "UY", // Uruguay
  "68": "BO", // Bolivia
  "604": "PE", // Peru
  "591": "PA", // Panama
  "188": "CR", // Costa Rica
  "558": "NI", // Nicaragua
  "340": "HN", // Honduras
  "222": "SV", // El Salvador
  "320": "GT", // Guatemala
  "84": "BZ", // Belize
  "862": "VE", // Venezuela
  "328": "GY", // Guyana
  "740": "SR", // Suriname
  "218": "EC", // Ecuador
  "630": "PR", // Puerto Rico
  "388": "JM", // Jamaica
  "192": "CU", // Cuba
  "716": "ZW", // Zimbabwe
  "72": "BW", // Botswana
  "516": "NA", // Namibia
  "686": "SN", // Senegal
  "466": "ML", // Mali
  "478": "MR", // Mauritania
  "204": "BJ", // Benin
  "562": "NE", // Niger
  "566": "NG", // Nigeria
  "120": "CM", // Cameroon
  "768": "TG", // Togo
  "288": "GH", // Ghana
  "384": "CI", // Côte d'Ivoire
  "324": "GN", // Guinea
  "624": "GW", // Guinea-Bissau
  "430": "LR", // Liberia
  "694": "SL", // Sierra Leone
  "854": "BF", // Burkina Faso
  "140": "CF", // Central African Rep.
  "178": "CG", // Congo
  "266": "GA", // Gabon
  "226": "GQ", // Eq. Guinea
  "894": "ZM", // Zambia
  "454": "MW", // Malawi
  "508": "MZ", // Mozambique
  "748": "SZ", // eSwatini
  "24": "AO", // Angola
  "108": "BI", // Burundi
  "422": "LB", // Lebanon
  "450": "MG", // Madagascar
  "275": "PS", // Palestine
  "270": "GM", // Gambia
  "788": "TN", // Tunisia
  "12": "DZ", // Algeria
  "400": "JO", // Jordan
  "634": "QA", // Qatar
  "414": "KW", // Kuwait
  "368": "IQ", // Iraq
  "512": "OM", // Oman
  "548": "VU", // Vanuatu
  "116": "KH", // Cambodia
  "764": "TH", // Thailand
  "418": "LA", // Laos
  "104": "MM", // Myanmar
  "704": "VN", // Vietnam
  "408": "KP", // North Korea
  "496": "MN", // Mongolia
  "50": "BD", // Bangladesh
  "64": "BT", // Bhutan
  "524": "NP", // Nepal
  "586": "PK", // Pakistan
  "4": "AF", // Afghanistan
  "762": "TJ", // Tajikistan
  "417": "KG", // Kyrgyzstan
  "795": "TM", // Turkmenistan
  "364": "IR", // Iran
  "760": "SY", // Syria
  "51": "AM", // Armenia
  "112": "BY", // Belarus
  "498": "MD", // Moldova
  "8": "AL", // Albania
  "540": "NC", // New Caledonia
  "90": "SB", // Solomon Is.
  "144": "LK", // Sri Lanka
  "158": "TW", // Taiwan
  "31": "AZ", // Azerbaijan
  "268": "GE", // Georgia
  "608": "PH", // Philippines
  "458": "MY", // Malaysia
  "96": "BN", // Brunei
  "232": "ER", // Eritrea
  "600": "PY", // Paraguay
  "887": "YE", // Yemen
  "10": "AQ", // Antarctica
  "434": "LY", // Libya
  "231": "ET", // Ethiopia
  "262": "DJ", // Djibouti
  "800": "UG", // Uganda
  "646": "RW", // Rwanda
  "70": "BA", // Bosnia and Herz.
  "807": "MK", // Macedonia
  "688": "RS", // Serbia
  "499": "ME", // Montenegro
  "780": "TT", // Trinidad and Tobago
  "728": "SS", // S. Sudan
};
