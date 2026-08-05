// De Google Ads-credentials: deels van het product, deels van het bureau.
//
// Wat hier vastligt is welk deel waar vandaan komt, en -- belangrijker -- dat een terugval op de
// omgeving ZICHTBAAR is. Een stille terugval betekent dat bureau B zonder eigen koppeling met de
// sleutels van het platform praat, en dat merk je dan nergens aan.

import { credentialsVoorBureau, credentialsUitOmgeving } from "./credentials";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + "  " + detail); }
}

const BUREAU_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const BUREAU_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

const OMGEVING = {
  GOOGLE_ADS_DEVELOPER_TOKEN: "dev-token-van-het-product",
  GOOGLE_ADS_CLIENT_ID: "oauth-client-van-het-product",
  GOOGLE_ADS_CLIENT_SECRET: "oauth-secret-van-het-product",
  GOOGLE_ADS_REFRESH_TOKEN: "refresh-uit-de-omgeving",
  GOOGLE_ADS_MANAGER_CUSTOMER_ID: "111-111-1111",
};

function zetOmgeving(waarden: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(waarden)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/** Een database met nul of meer gekoppelde bureaus. */
function nepDb(koppelingen: Array<{
  agency_id: string; provider: string; external_id: string | null;
  token_ref: string | null; status: string; token?: string;
}>) {
  return {
    rpc(naam: string, args: Record<string, string>) {
      if (naam === "lees_oauth_geheim") {
        const k = koppelingen.find((x) => args.p_naam === `oauth_${x.provider}_${x.agency_id}`);
        return Promise.resolve({ data: k?.token ?? null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from() {
      const bouw = (rijen: typeof koppelingen) => ({
        eq(k: string, v: unknown) {
          return bouw(rijen.filter((r) => (r as unknown as Record<string, unknown>)[k] === v));
        },
        maybeSingle() { return Promise.resolve({ data: rijen[0] ?? null, error: null }); },
      });
      return { select: () => bouw(koppelingen) };
    },
  };
}

const GEKOPPELD = [{
  agency_id: BUREAU_A, provider: "google_ads", external_id: "222-222-2222",
  token_ref: "vault-1", status: "actief", token: "refresh-van-bureau-a",
}];

async function main() {
  zetOmgeving(OMGEVING);

  console.log("credentialsUitOmgeving");
  const omg = credentialsUitOmgeving();
  check("levert alle vijf de waarden", omg?.developerToken === OMGEVING.GOOGLE_ADS_DEVELOPER_TOKEN
    && omg?.refreshToken === OMGEVING.GOOGLE_ADS_REFRESH_TOKEN, JSON.stringify(omg));
  zetOmgeving({ GOOGLE_ADS_REFRESH_TOKEN: undefined });
  check("zonder refresh token: null", credentialsUitOmgeving() === null);
  zetOmgeving({ GOOGLE_ADS_REFRESH_TOKEN: OMGEVING.GOOGLE_ADS_REFRESH_TOKEN });

  console.log("\ncredentialsVoorBureau — een gekoppeld bureau");
  const a = await credentialsVoorBureau(nepDb(GEKOPPELD) as never, BUREAU_A);
  check("de bron is het bureau", a?.bron === "bureau", String(a?.bron));
  check("het refresh token komt van het bureau",
    a?.credentials.refreshToken === "refresh-van-bureau-a", String(a?.credentials.refreshToken));
  check("het MCC-id komt van het bureau",
    a?.credentials.managerCustomerId === "222-222-2222", String(a?.credentials.managerCustomerId));
  // DIT is het punt van de hele constructie: de sleutel blijft van het product.
  check("het developer token blijft van het product",
    a?.credentials.developerToken === OMGEVING.GOOGLE_ADS_DEVELOPER_TOKEN);
  check("de OAuth-client blijft van het product",
    a?.credentials.clientId === OMGEVING.GOOGLE_ADS_CLIENT_ID
    && a?.credentials.clientSecret === OMGEVING.GOOGLE_ADS_CLIENT_SECRET);

  console.log("\ncredentialsVoorBureau — een bureau zonder koppeling");
  const b = await credentialsVoorBureau(nepDb(GEKOPPELD) as never, BUREAU_B);
  check("valt terug op de omgeving", b?.credentials.refreshToken === OMGEVING.GOOGLE_ADS_REFRESH_TOKEN);
  // Zonder dit veld is de terugval stil, en dan draait bureau B ongemerkt op de sleutels van het
  // platform. Zichtbaarheid is hier de hele functie.
  check("en zegt dat het een terugval was", b?.bron === "omgeving", String(b?.bron));
  check("het bureau staat er wel bij", b?.agencyId === BUREAU_B);

  console.log("\ncredentialsVoorBureau — een koppeling die niet bruikbaar is");
  const ingetrokken = [{ ...GEKOPPELD[0], status: "ingetrokken" }];
  check("een ingetrokken koppeling telt niet",
    (await credentialsVoorBureau(nepDb(ingetrokken) as never, BUREAU_A))?.bron === "omgeving");
  const zonderToken = [{ ...GEKOPPELD[0], token_ref: null, token: undefined }];
  check("een koppeling zonder geheim telt niet",
    (await credentialsVoorBureau(nepDb(zonderToken) as never, BUREAU_A))?.bron === "omgeving");
  // De kluis leeg terwijl de tabel 'actief' zegt: dat is een kapotte koppeling, en de terugval
  // hoort dan óók te melden dat hij terugviel.
  const leegInDeKluis = [{ ...GEKOPPELD[0], token: undefined }];
  check("token_ref zonder waarde in de kluis telt niet",
    (await credentialsVoorBureau(nepDb(leegInDeKluis) as never, BUREAU_A))?.bron === "omgeving");

  console.log("\nHet product-deel is een harde voorwaarde");
  zetOmgeving({ GOOGLE_ADS_DEVELOPER_TOKEN: undefined });
  check("zonder developer token: null, ook mét een gekoppeld bureau",
    (await credentialsVoorBureau(nepDb(GEKOPPELD) as never, BUREAU_A)) === null);
  zetOmgeving({ GOOGLE_ADS_DEVELOPER_TOKEN: OMGEVING.GOOGLE_ADS_DEVELOPER_TOKEN });

  console.log("\nZonder bureau");
  const geen = await credentialsVoorBureau(nepDb(GEKOPPELD) as never, null);
  check("geen bureau geeft de omgeving", geen?.bron === "omgeving");
  check("en agencyId blijft null", geen?.agencyId === null);

  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
