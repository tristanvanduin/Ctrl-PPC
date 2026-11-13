// Regressietest: de aansluitingen die bij de integratie van stap 0 zijn rechtgezet.
// Draaien: tsx lib/__stap0_bedrading_test.ts
//
// Het rekenwerk zelf heeft eigen tests (lib/sync/__volle_maand_test.ts, lib/__forecast_gerealiseerd_test.ts,
// lib/period/__apply_period_test.ts, ...). Dit bestand bewaakt dat de plekken die er nog omheen
// stonden dezelfde regel gebruiken, en niet een eigen kopie of de browserklok. Waar het kan op
// gedrag; waar een component aan een provider of een route aan de database hangt, op de bron. Een
// bronbewaking breekt bij een andere schrijfwijze met hetzelfde gedrag: pas dan de regex aan, niet
// het gedrag.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as datastand from "./sync/datastand";
import { gezamenlijkeDataTot } from "./sync/datastand";
// Als namespace: tegen een versie zonder deze export een FAIL-regel, geen crash bij het laden.
import * as blend from "./analysis/channel-report-blend";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}
const bron = (pad: string) => readFileSync(join(__dirname, "..", pad), "utf8");

// ── 1. Een gepauzeerd kanaal remt een actuele bron niet af ─────────────────────────────────────
// De lezers zetten syncDraait OOK bij een bron die gewoon actueel is. Rauw doorgegeven stonden een
// actuele Google en een gepauzeerde LinkedIn dan allebei "stil", en dan remmen ze volgens
// gezamenlijkeDataTot weer allebei: het venster van LinkedIn (maart) in plaats van oktober.
console.log("remtNietBijAchterstand (lib/sync/datastand.ts)");
{
  const f = (datastand as { remtNietBijAchterstand?: (s: { syncDraait: boolean; toestand: string }) => boolean }).remtNietBijAchterstand;
  check("remtNietBijAchterstand bestaat", typeof f === "function");
  if (f) {
    check("actueel met draaiende sync: remt gewoon mee", f({ syncDraait: true, toestand: "actueel" }) === false);
    check("achter met draaiende sync (gepauzeerd): remt niet", f({ syncDraait: true, toestand: "achter" }) === true);
    check("achter zonder sync: remt", f({ syncDraait: false, toestand: "achter" }) === false);
    const google = { bron: "google", dataTot: "2026-10-31", stand: { syncDraait: true, toestand: "actueel" } };
    const linkedin = { bron: "linkedin", dataTot: "2026-03-15", stand: { syncDraait: true, toestand: "achter" } };
    // De voorwaarde gebruikte eerst dit paar, en leunde op "alles stil: de vroegste dag". Die regel
    // was zelf fout (review [11]): staat alles stil, dan telt nu de laatste dag. Rauw doorgeven gaat
    // nog steeds mis bij twee ACTUELE bronnen: dan heten ze allebei stil, en telt de laatste dag van
    // de ene terwijl de andere de twee dagen erna nog niet binnen heeft.
    const meta = { bron: "meta", dataTot: "2026-10-29", stand: { syncDraait: true, toestand: "actueel" } };
    const rauw = gezamenlijkeDataTot([google, meta].map((b) => ({ bron: b.bron, dataTot: b.dataTot, syncDraait: b.stand.syncDraait })));
    const goed = gezamenlijkeDataTot([google, linkedin].map((b) => ({ bron: b.bron, dataTot: b.dataTot, syncDraait: f(b.stand) })));
    check("voorwaarde: rauw doorgegeven telt twee nog niet gesyncte Meta-dagen als nul", rauw.dataTot === "2026-10-31", String(rauw.dataTot));
    const metaGoed = gezamenlijkeDataTot([google, meta].map((b) => ({ bron: b.bron, dataTot: b.dataTot, syncDraait: f(b.stand) })));
    check("via remtNietBijAchterstand remt de actuele Meta gewoon mee", metaGoed.dataTot === "2026-10-29", String(metaGoed.dataTot));
    check("via remtNietBijAchterstand: het venster van Google, LinkedIn uitgesloten",
      goed.dataTot === "2026-10-31" && goed.uitgesloten.join(",") === "linkedin", JSON.stringify(goed));
  }
  const bh = bron("lib/api/blended-historical.ts");
  check("blended-historical geeft syncDraait via remtNietBijAchterstand door",
    (bh.match(/syncDraait:\s*remtNietBijAchterstand\(s\)/g) ?? []).length === 2 && !/s\.syncDraait\s*&&/.test(bh));
}

// ── 2. De tweede sorteersleutel hoort bij de ene kanaal-dagbrontabel ───────────────────────────
console.log("KANAAL_DAGBRON.entityField");
{
  const kaart = ((blend as { KANAAL_DAGBRON?: unknown }).KANAAL_DAGBRON ?? {}) as Record<string, { entityField?: string }>;
  check("Meta en Microsoft: entity_id, LinkedIn: entity_urn",
    kaart.meta_ads?.entityField === "entity_id" && kaart.microsoft_ads?.entityField === "entity_id" && kaart.linkedin_ads?.entityField === "entity_urn",
    JSON.stringify(kaart));
  const bh = bron("lib/api/blended-historical.ts");
  check("blended-historical heeft geen eigen kolomkaart meer", !bh.includes("ENTITEIT_KOLOM"));
  check("blended-historical sorteert op KANAAL_DAGBRON[channel].entityField", bh.includes(".order(KANAAL_DAGBRON[channel].entityField)"));
}

// ── 3. Een telling is geen positie (dezelfde fout als de forecast-indexfout) ───────────────────
console.log("budget-scenario.tsx");
{
  const b = bron("components/dashboard/budget-scenario.tsx");
  check("restmaanden uit kpi.realizedThroughMonth", /12\s*-\s*forecast\.conversions\.kpi\.realizedThroughMonth/.test(b));
  check("geen telling van gevulde punten als grens", !/points\.filter\(\(p\)\s*=>\s*p\.realized\s*!==\s*null\)\.length/.test(b));
}

// ── 4. De blended route alleen vragen als hij gebruikt wordt ───────────────────────────────────
console.log("forecast-table.tsx");
{
  const b = bron("components/dashboard/forecast-table.tsx");
  check("useBlendedClientData staat uit op de Google-weergave", b.includes('useBlendedClientData(clientId, channel === "blended")'));
}

// ── 5. Na het opslaan van een selectie: eerst opslaan, dan de cache verversen ─────────────────
console.log("opslaan en verversen");
{
  const cs = bron("components/dashboard/client-settings.tsx");
  const wacht = cs.indexOf("await saveClientSettings(");
  const ververs = cs.indexOf("invalidateClientCache(clientId)");
  check("client-settings wacht de opslag af vóór invalidateClientCache", wacht > 0 && ververs > wacht, `${wacht} / ${ververs}`);
  check("client-settings meldt een mislukte opslag", cs.includes("setOpslaanFout(error)"));
  const lib = bron("lib/client-settings.ts");
  check("saveClientSettings geeft de schrijffout terug", /saveClientSettings\(settings: ClientSettings\): Promise<\{ error: string \| null \}>/.test(lib)
    && /const \{ error \} = await dbUpsert\("client_settings"/.test(lib));
  const ccs = bron("components/dashboard/channel-conversion-settings.tsx");
  check("de kanaalselectie leegt na opslaan de blended cache", /vergeetBlendedClientData\(clientId\)/.test(ccs));
  // De KPI-band blijft gemount terwijl Instellingen open staat; zonder seintje hield hij de oude
  // selectie vast (review [4], [22], [40]). Het gedrag zelf: lib/__channel_period_data_test.ts.
  check("de kanaalselectie seint de KPI-band na opslaan", /meldKanaalselectieOpgeslagen\(clientId\)/.test(ccs));

  // Mislukt de opslag, dan geen doelen naar client_targets: anders stond daar het nieuwe CPA-doel
  // terwijl het paneel "niet opgeslagen" zei (review [24]).
  const opslaan = cs.slice(wacht);
  const foutCheck = opslaan.indexOf("if (error)");
  const sync = opslaan.indexOf("syncClientTargets(");
  check("client-settings controleert de fout vóór syncClientTargets", foutCheck > 0 && sync > foutCheck, `${foutCheck} / ${sync}`);
  // De blended cache bevat de KPI-doelen al samengevoegd (mergeKpiTargets in haal()); zonder dit
  // toonde "Alle kanalen" na het opslaan nog vijf minuten het oude doel (review [39]).
  const vergeet = opslaan.indexOf("vergeetBlendedClientData(clientId)");
  check("client-settings leegt na een geslaagde opslag ook de blended cache", vergeet > foutCheck && foutCheck > 0, `${vergeet} / ${foutCheck}`);
}

// ── 5b. "Alle kanalen" leest de prognose uit de hook: de som per kanaal ───────────────────────
// computeForecast op de optelling las de kanaalmix als groei (demo: 5.182 conversies waar 4.782
// hoort, ROAS-kaart +9% boven het doel waar -10% hoort). Het rekenwerk: lib/__forecast_som_test.ts.
console.log("blended prognose: de som uit de hook");
{
  const ccv = bron("components/dashboard/cross-channel-view.tsx");
  const ft = bron("components/dashboard/forecast-table.tsx");
  check("cross-channel-view rekent niet zelf op de optelling", !/computeForecast\(blended\.data\)/.test(ccv) && /blended\.forecast/.test(ccv));
  check("forecast-table rekent niet zelf op de optelling", !/computeForecast\(blended\.data\)/.test(ft) && /forecast: blended\.forecast/.test(ft));
  // Zonder bekende kanalen geen verzoek: de route is zwaar, en een Google-only klant heeft geen
  // blended weergave (review [38]).
  check("cross-channel-view haalt pas op bij meer dan één kanaal", /useBlendedClientData\(clientId, kanalen\.length > 1\)/.test(ccv));
  // Een kanaal dat het venster niet meer remt, telt na zijn laatste dag als nul. Het Jaaroverzicht
  // zegt dat met dezelfde zin als de KPI-band (uitgeslotenZin), uit de stand van de route.
  check("het Jaaroverzicht noemt een kanaal dat het venster niet tegenhoudt",
    /uitgeslotenZin\(uitgeslotenMetDag\(blended\.dataStand\)\)/.test(ccv));
}

// ── 6. Sync en route bouwen hetzelfde Google-actiefilter ───────────────────────────────────────
console.log("orchestrator.ts");
{
  const o = bron("lib/sync/orchestrator.ts");
  check("de sync gebruikt dashboardConversionActionIds", o.includes("dashboardConversionActionIds(settingsData?.conversion_actions)"));
  check("geen eigen filter op includedInDashboard meer", !/\.filter\(\(a\)\s*=>\s*a\.includedInDashboard\)/.test(o));
}

// ── 7. Vensters vanaf de Amsterdamse kalenderdag ───────────────────────────────────────────────
console.log("klok in de geraakte routes en componenten");
{
  const cc = bron("app/api/analysis/cross-channel/route.ts");
  check("cross-channel: geen UTC-klok voor het venster",
    !/new Date\(\)\.toISOString\(\)/.test(cc) && !/setMonth\(/.test(cc) && !/Date\.now\(\)\s*-/.test(cc));
  check("cross-channel: de lopende maand uit today()", cc.includes("const currentMonthStart = `${vandaag.slice(0, 7)}-01`;"));
  const cpc = bron("components/dashboard/campaigns-per-channel.tsx");
  check("campaigns-per-channel: geen UTC-klok voor het venster", !/Date\.now\(\)/.test(cpc) && cpc.includes("campagneVensters(today())"));
  const mp = bron("lib/kanalen/maand-pacing.ts");
  check("maand-pacing rekent een maand terug op de tekst", mp.includes("addMonths(dezeMaand, -1)") && !/setMonth\(/.test(mp));
}

// ── 8. Fase 1, stap 4: band en kanalen uit de route, band buiten de poort, één vergeet-ingang ──
// De bedrading in client-dashboard.tsx, die geen test mount (de pagina hangt aan Next-navigatie en
// een dozijn zware kinderen). Het gedrag eronder is wel gemount getoetst: de band uit de route in
// lib/__channel_period_data_test.ts (1b), het herladen zonder laadflits in
// lib/api/__blended_client_data_hook_test.ts, de gelijkheid in lib/__kanaaltab_gelijk_alle_kanalen_test.ts.
console.log("stap 4: band, kanalen en de vergeet-ingang");
{
  const dash = bron("components/dashboard/client-dashboard.tsx");
  // Zonder commentaar: de uitleg in de bron noemt juist wat er NIET meer staat.
  const code = dash.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
  check("de blended route staat voor elke klant aan, zonder waterval achter de kanalen",
    /useBlendedClientData\(client\.id\)/.test(code) && !/blendedAan/.test(code));
  check("de band krijgt de route mee", /useChannelPeriodData\(\{[^}]*route: blendedStand[^}]*\}\)/.test(code));
  // De kanalenlijst: niet alleen de route. Het proefje loopt als race ernaast (geen wachten op een
  // routefout of een time-out), tenzij de server het antwoord van de route met de pagina meestuurt:
  // die beslissing zit in proefjeNodig (getoetst in lib/kanalen/__beschikbaar_test.ts). Google komt
  // uit het Google-antwoord.
  // Het effect met precies deze deps; de (?!useEffect) houdt de greep binnen dat ene effect.
  const proefje = /useEffect\(\(\) => \{((?:(?!useEffect\()[\s\S])*?)\}, \[client\.id, startProefje\]\);/.exec(code)?.[1] ?? "";
  check("het kanalenproefje vertrekt zodra proefjeNodig het zegt, zonder eigen wachten",
    proefje.includes("if (!startProefje) return;") && proefje.includes("laadBeschikbareKanalen(dbSelectAlsSupabase, client.id)") && !/setTimeout/.test(proefje), proefje.slice(0, 160));
  check("proefjeNodig krijgt de routefout, de stilte en het zaad mee",
    /proefjeNodig\(\{\s*routeKlaar, routeFout, routeStil: routeStilVoor === client\.id, proefjeBekend: proefje\?\.clientId === client\.id, zaadVerwacht,\s*\}\)/.test(code)
    && /setTimeout\(\(\) => setRouteStilVoor\(client\.id\), PROEFJE_WACHT_MS\)/.test(code));
  check("zonder belofte van de server is er geen zaad verwacht: dan geldt de race, zoals het was",
    /const zaadVerwacht = blendedVanServer != null && zaadZonderAntwoord !== blendedVanServer;/.test(code));
  // De regel zelf (route vóór proefje, null zolang onbekend) is getoetst in lib/kanalen/__beschikbaar_test.ts.
  check("de kanalenlijst loopt via kanalenUitBronnen", /kanalenUitBronnen\(\{\s*googleLaadt: clientData\.loading,/.test(code));
  // De regel staat sinds de kerncijfers uit het zaad (band-uit-zaad.tsx) op één plek, googleHeeftData,
  // zodat de server de kanalen precies zo bepaalt als het dashboard.
  check("Google in de kanalenlijst komt uit het Google-antwoord", /google: googleHeeftData\(googleData\),/.test(code)
    && /return googleData \? flattenMonths\(googleData\)\.some\(heeftData\) : null;/.test(bron("lib/period/apply-period.ts")));
  check("de dagkanalen uit perKanaal van de route", /routePerKanaal \?\? \[\]\)\.map\(\(r\) => r\.kanaal\)/.test(code));
  // bandKlaar: per tabblad de eigen bron; geen losse wacht op de blended route (het Google-tabblad
  // van een klant met alleen Google hing daaraan).
  const klaar = /const bandKlaar = ([^;]*);/.exec(code)?.[1] ?? "";
  check("bandKlaar wacht niet los op de blended route", klaar === "kanalen !== null && eigenStandBekend", klaar);
  check("het Google-tabblad is klaar op de Google-route alleen", /const eigenStandBekend = channel === "google" \? !clientData\.loading\b/.test(code));
  check("de dagkanalen zijn klaar op `klaar` van de band", /NIET_GOOGLE\.every\(\(k\) => periodSummary\.klaar\[k\]\)/.test(code) && /: periodSummary\.klaar\[channel\];/.test(code));

  // De band staat buiten de datapoort, alleen op het Overzicht en niet naast een fout.
  const band = code.indexOf("<PeriodSummary ");
  const poort = code.indexOf("<ClientDataProvider ");
  check("de KPI-band staat vóór (buiten) de ClientDataProvider", band > 0 && poort > band, `${band} / ${poort}`);
  check("en maar één keer", code.indexOf("<PeriodSummary ", band + 1) === -1);
  const voorBand = code.slice(0, band);
  check("alleen op het Overzicht, en verborgen bij een fout van de Google-route",
    /\{activeTab === "dashboard" && !clientData\.error && \(\s*<div[^>]*>\s*<ChannelTabs [^>]*\/>\s*$/.test(voorBand), voorBand.slice(-200));
  // Geen dubbel skelet: de band toont zijn eigen laadvlak, dus het paginavlak begint zonder.
  check("het laadvlak van de pagina begint zonder band-deel", /\{clientData\.loading && <PaginaLaadvlak metBand=\{false\} \/>\}/.test(code));
  check("ook het wachtvlak van de provider", /<ClientDataProvider clientId=\{client\.id\}[^>]*wachtvlak=\{<PaginaLaadvlak metBand=\{false\} \/>\}>/.test(code));
  check("de provider gebruikt het meegegeven wachtvlak", bron("lib/client-data-provider.tsx").includes("return wachtvlak ?? <PaginaLaadvlak />;"));

  // Na een sync: de ene vergeet-ingang, en niets dat de Google-data op null zet (de syncmelding
  // staat achter `!clientData.loading` en verdween dan voor je hem las).
  check("na een sync vergeet het dashboard de blended route", /onSyncComplete=\{\(\) => vergeetBlendedClientData\(client\.id\)\}/.test(code));
  // Alleen binnen ClientDashboard zelf: de Analyseren-tab verderop heeft een eigen, wel gelezen refreshKey.
  const dashboard = /export function ClientDashboard\([\s\S]*?\n\}\n/.exec(code)?.[0] ?? "";
  check("de ongelezen refreshKey is weg", dashboard.includes("onSyncComplete=") && !/refreshKey/i.test(dashboard));
  check("geen invalidateClientCache op het syncpad", !/invalidateClientCache/.test(code));

  // De ene vergeet-ingang: wissen én gemounte lezers laten herladen, bewaakt buiten de browser.
  const hook = bron("lib/use-blended-client-data.ts");
  const vergeet = /export function vergeetBlendedClientData\(clientId: string\): void \{([\s\S]*?)\n\}/.exec(hook)?.[1] ?? "";
  check("vergeetBlendedClientData wist cache, lopend verzoek en generatie",
    vergeet.includes("cache.delete(clientId)") && vergeet.includes("onderweg.delete(clientId)") && vergeet.includes("generatie.set(clientId"));
  check("en seint gemounte lezers, achter een guard op dispatchEvent",
    /typeof window === "undefined" \|\| typeof window\.dispatchEvent !== "function"\) return;\s*window\.dispatchEvent\(new CustomEvent\(BLENDED_VERGETEN/.test(vergeet), vergeet.slice(-220));
  check("de hook herlaadt op het seintje via zijn effect-deps", /\}, \[clientId, enabled, versie\]\);/.test(hook));
  // Elke opslag op client_settings die de route of haar lezers raakt, gaat langs die ingang.
  for (const pad of ["ga4-settings.tsx", "search-console-settings.tsx", "event-settings.tsx", "branding-view.tsx", "channel-conversion-settings.tsx", "client-settings.tsx"]) {
    const b = bron(`components/dashboard/${pad}`);
    const opslag = Math.max(b.indexOf('dbUpsert("client_settings"'), b.indexOf("await saveClientSettings("));
    check(`${pad} vergeet de blended route na het opslaan`, opslag > 0 && b.indexOf("vergeetBlendedClientData(clientId)", opslag) > opslag, String(opslag));
  }
}

console.log(`\n${passed} geslaagd, ${failed} gefaald`);
process.exit(failed > 0 ? 1 : 0);
