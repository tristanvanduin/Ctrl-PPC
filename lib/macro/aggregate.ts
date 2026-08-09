import type { MacroInvoerRij, MacroMetrics, MacroTrendCell, MacroSleutel } from "./types";

// De pure aggregator. Geen database, geen fetch -- alleen invoerrijen naar cellen, zodat hij met
// vaste getallen te testen is. IO (blended_account_monthly + client_settings + accounts bevragen,
// begrensd tot één bureau) zit in de aanroepende route, niet hier.

function legeMetrics(): MacroMetrics {
  return { impressions: 0, clicks: 0, spend: 0, conversions: 0, conversionValue: 0, leads: 0 };
}

function optellen(a: MacroMetrics, r: MacroInvoerRij): void {
  a.impressions += r.impressions;
  a.clicks += r.clicks;
  a.spend += r.spend;
  a.conversions += r.conversions;
  a.conversionValue += r.conversionValue;
  a.leads += r.leads;
}

function sleutelTekst(s: MacroSleutel): string {
  return `${s.agencyId}|${s.channel}|${s.bedrijfsmodel ?? ""}|${s.niche ?? ""}|${s.maand}`;
}

/**
 * Bouwt de macro-trendcellen uit een verzameling maandrijen.
 *
 * Elke rij telt mee op ELK segmentniveau waarop de klant is afgebakend -- geen segment (het
 * agency-brede totaal per kanaal en maand), alleen bedrijfsmodel, alleen niche, en beide samen.
 * Zelfde regel als celoverzicht() in lib/benchmark/cel.ts, met hetzelfde motief: de vraag "hoe
 * doet mijn e-com portfolio het" mag niet de klanten missen die toevallig ook een niche hebben
 * ingevuld.
 *
 * `accounts` telt DISTINCTE klanten per cel, niet het aantal rijen -- een klant met twaalf
 * maandrijen mag niet als twaalf accounts meetellen.
 */
export function bouwMacroTrends(rijen: readonly MacroInvoerRij[]): MacroTrendCell[] {
  const groepen = new Map<string, { sleutel: MacroSleutel; metrics: MacroMetrics; klanten: Set<string> }>();

  const voegToe = (sleutel: MacroSleutel, rij: MacroInvoerRij) => {
    const k = sleutelTekst(sleutel);
    let g = groepen.get(k);
    if (!g) { g = { sleutel, metrics: legeMetrics(), klanten: new Set() }; groepen.set(k, g); }
    optellen(g.metrics, rij);
    g.klanten.add(rij.clientId);
  };

  for (const r of rijen) {
    const basis = { agencyId: r.agencyId, channel: r.channel, maand: r.maand };
    voegToe({ ...basis, bedrijfsmodel: null, niche: null }, r);
    if (r.bedrijfsmodel) voegToe({ ...basis, bedrijfsmodel: r.bedrijfsmodel, niche: null }, r);
    if (r.niche) voegToe({ ...basis, bedrijfsmodel: null, niche: r.niche }, r);
    if (r.bedrijfsmodel && r.niche) voegToe({ ...basis, bedrijfsmodel: r.bedrijfsmodel, niche: r.niche }, r);
  }

  return [...groepen.values()]
    .map((g) => ({ sleutel: g.sleutel, metrics: g.metrics, accounts: g.klanten.size }))
    .sort((a, b) =>
      a.sleutel.maand.localeCompare(b.sleutel.maand) ||
      a.sleutel.channel.localeCompare(b.sleutel.channel) ||
      b.accounts - a.accounts
    );
}
