// Vandaag: verlopen AI-taken, het kanaal en de ouderdom van een taak, en wat de knop belooft
// (lib/feed/adapters.ts).
// Draaien: tsx lib/__vandaag_taken_test.ts
//
// Het tegenvoorbeeld uit de doorlichting van 13 november: 151 rode kaarten met deadlines van eind
// augustus, elke taak met de chip "Google" (ook "Pauzeer campagne ... in LinkedIn Campaign
// Manager"), elke taak "Nieuw" en "Nieuw sinds gisteren +151", en knoppen "Keur goed" en
// "Afronden" die alleen het Overzicht van de klant openden.

import { taskToFeedItem, recommendationToFeedItem, kanaalVanTaak, VERLOPEN_NA_DAGEN } from "./feed/adapters";
import { isNewSince } from "./feed/feed-item";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  FAIL  ${label}  ${detail}`); }
}

const NU = new Date("2026-11-13T09:00:00Z");
const taak = (over: Partial<Parameters<typeof taskToFeedItem>[0]>) => taskToFeedItem({
  id: "t", client_id: "demo-greentech", title: "Pauzeer campagne GreenTech Gids Downloads", description: "",
  priority: "high", due_date: "2026-09-03", status: "open", created_at: "2026-09-01T06:00:00Z", ...over,
}, "GreenTech", NU);

const oud = taak({});
check("deadline van 3 september is op 13 november niet rood", oud.severity !== "critical", oud.severity);
check("en zegt dat hij verlopen is", oud.impactLabel.includes("verlopen sinds 2026-09-03"), oud.impactLabel);
check("een taak van 1 september is niet nieuw sinds gisteren", !isNewSince(oud.createdAt, NU), oud.createdAt);

const net = taak({ due_date: "2026-11-10" });
check("net verlopen (3 dagen) blijft rood", net.severity === "critical", net.severity);
const grens = taak({ due_date: new Date(NU.getTime() - (VERLOPEN_NA_DAGEN + 1) * 86_400_000).toISOString().slice(0, 10) });
check("ruim verlopen: grijs", grens.severity === "watch", grens.severity);

check("LinkedIn Campaign Manager is LinkedIn", taak({ title: "Pauzeer campagne GRT ABM in LinkedIn Campaign Manager" }).channel === "linkedin");
check("Events Manager is Meta", taak({ title: "Audit data-reconciliatie in Events Manager" }).channel === "meta");
check("sop_type gaat voor de tekst", kanaalVanTaak({ sop_type: "linkedin_biweekly", title: "Pas het bod aan", description: "" }) === "linkedin");
// Tegenvoorbeeld van de controleur: het losse woord "meta" maakte een SEO-taak een Meta-taak.
check("'meta description' is geen Meta", kanaalVanTaak({ title: "Herschrijf de meta description van de landingspagina", description: "" }) === "google");
check("'Meta Ads' wel", kanaalVanTaak({ title: "Verlaag het budget in Meta Ads", description: "" }) === "meta");
check("Events Manager wel", kanaalVanTaak({ title: "Audit data-reconciliatie in Events Manager", description: "" }) === "meta");
check("'bingo' is geen Microsoft", kanaalVanTaak({ title: "Voeg uitsluitingszoekwoord bingo toe", description: "" }) === "google");
check("'Bing' wel", kanaalVanTaak({ title: "Importeer de campagne in Bing", description: "" }) === "microsoft");
check("zonder aanwijzing blijft het Google", kanaalVanTaak({ title: "Voeg uitsluitingszoekwoorden toe", description: "" }) === "google");

check("de taakknop belooft geen afronding", oud.primaryAction.label !== "Afronden" && oud.primaryAction.kind === "view", oud.primaryAction.label);
const rec = recommendationToFeedItem({ id: "r", client_id: "c", sop_type: null, hypothesis: "x", expected_result: "", ice_total: 7, status: "open" }, "K");
check("de aanbevelingsknop belooft geen goedkeuring", rec.primaryAction.label !== "Keur goed" && rec.primaryAction.kind === "view", rec.primaryAction.label);

console.log(`vandaag taken: ${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);
