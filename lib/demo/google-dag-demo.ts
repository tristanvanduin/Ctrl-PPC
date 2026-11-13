// Google per dag in de demo (ads_campaign_daily en ads_account_daily, migratie 111).
//
// VOORBEELDEN, geen echte cijfers. Afgeleid uit de maandreeks per campagne (ads_campaign_monthly in
// lib/demo/demo-rows.ts) en niet los verzonnen: elke campagnemaand wordt over zijn dagen verdeeld
// met splitInt (grootste rest), dus de dagen van een maand tellen EXACT op tot die maand, per
// campagne en dus ook voor het account. Wie in de nieuwe weergave een event kiest, ziet dezelfde
// cijfers als de maanden eromheen, alleen fijner.
//
// De lopende maand is in de demo een maand-tot-nu (lopendeMaandFractie in demo-rows.ts): die wordt
// over de dagen t/m vandaag verdeeld, niet over de hele maand. Een dag in de toekomst heeft geen rij.
//
// Het verloop binnen een maand is niet vlak, want dan valt er per dag niets te zien:
// - weekdagen: het weekend lichter (een vakbeurspubliek zoekt doordeweeks);
// - de twee weken voor elke beurs (de edities in de demo-instellingen) draaien de campagnes van die
//   beurs harder, en Brand een beetje mee;
// - Black Friday (21 nov t/m 1 dec) en de Moederdag-actie (1 t/m 10 mei) duwen de merchandise-
//   webshop (Shopping) omhoog;
// - een lichte, vaste golf, zodat twee gelijke weken niet tot op de euro gelijk zijn.
// Alles deterministisch: dezelfde dag geeft altijd dezelfde rij.

import { splitAlong, splitInt } from "./split";

type Row = Record<string, unknown>;
const DAG_MS = 86_400_000;

/** Vandaag in UTC, zoals monthISO en lopendeMaandFractie in demo-rows.ts. */
function vandaagUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** De beursdag per campagnevoorvoegsel (maand-dag), uit de demo-instellingen. */
const BEURS: Record<string, string[]> = { GRT: ["06-11"], GRA: ["09-15", "09-16"], GRN: ["11-04"] };

function voorBeurs(dag: string, md: string): boolean {
  const tot = Date.parse(`${dag.slice(0, 4)}-${md}T00:00:00Z`) - Date.parse(`${dag}T00:00:00Z`);
  return tot >= 0 && tot <= 14 * DAG_MS;
}

/** Het gewicht van een dag voor een campagne: weekdag, events en een vaste golf. */
export function demoDagGewicht(dag: string, campagne: string, i: number): number {
  const wd = new Date(`${dag}T00:00:00Z`).getUTCDay();
  const weekdag = wd === 0 ? 0.62 : wd === 6 ? 0.74 : 1;
  const md = dag.slice(5);
  const voorvoegsel = campagne.slice(0, 3);
  const eigenBeurs = (BEURS[voorvoegsel] ?? []).some((b) => voorBeurs(dag, b)) ? 1.6 : 1;
  const merk = /Brand/.test(campagne) && Object.values(BEURS).flat().some((b) => voorBeurs(dag, b)) ? 1.2 : 1;
  const shop = /Shopping/.test(campagne)
    ? ((md >= "11-21" && md <= "11-30") || md === "12-01" ? 2.2 : md >= "05-01" && md <= "05-10" ? 1.5 : 1)
    : 1;
  return weekdag * eigenBeurs * merk * shop * (1 + 0.08 * Math.sin(i * 1.3 + campagne.length));
}

/** De dagen van een maand ("YYYY-MM-01"), t/m vandaag als het de lopende maand is. */
function dagenVan(maand: string, vandaag: string): string[] {
  const [j, m] = maand.split("-").map(Number);
  const n = new Date(Date.UTC(j, m, 0)).getUTCDate();
  const uit: string[] = [];
  for (let d = 1; d <= n; d++) {
    const dag = `${maand.slice(0, 8)}${String(d).padStart(2, "0")}`;
    if (dag > vandaag) break;
    uit.push(dag);
  }
  return uit;
}

/**
 * De dagrijen per campagne en voor het account, uit de maandrijen per campagne. De som per maand is
 * per constructie de maandrij: zie lib/period/__dag_opslag_test.ts.
 */
export function googleDagRijen(clientId: string, campagneMaanden: readonly Row[]): { campagnes: Row[]; account: Row[] } {
  const vandaag = vandaagUtc();
  const campagnes: Row[] = [];
  const perDag = new Map<string, { impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number }>();
  for (const r of campagneMaanden) {
    const maand = String(r.month ?? "");
    const naam = String(r.campaign_name ?? "");
    const dagen = dagenVan(maand, vandaag);
    if (dagen.length === 0) continue;
    const gewichten = dagen.map((d, i) => demoDagGewicht(d, naam, i));
    const imp = splitInt(Number(r.impressions ?? 0), gewichten);
    const clk = splitInt(Number(r.clicks ?? 0), gewichten);
    const cost = splitInt(Number(r.cost ?? 0), gewichten);
    const conv = splitInt(Number(r.conversions ?? 0), gewichten);
    const val = splitAlong(Number(r.conversions_value ?? 0), conv, gewichten);
    dagen.forEach((date, i) => {
      campagnes.push({
        client_id: clientId, date, campaign_id: r.campaign_id, campaign_name: naam, campaign_type: r.campaign_type ?? null,
        impressions: imp[i], clicks: clk[i], cost: cost[i], conversions: conv[i], conversions_value: val[i],
      });
      const a = perDag.get(date) ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0 };
      a.impressions += imp[i]; a.clicks += clk[i]; a.cost += cost[i]; a.conversions += conv[i]; a.conversions_value += val[i];
      perDag.set(date, a);
    });
  }
  const account = [...perDag.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, t]) => ({ client_id: clientId, date, ...t }));
  return { campagnes, account };
}
