// Van Google's geo-rijen naar staten-rijen voor ads_region_monthly.
//
// WAAROM DIT BESTAND BESTAAT
//
// De tabel was gevuld, maar met onzin: elke rij droeg "LOCATION_OF_PRESENCE" in region_name en
// niets in region_code. Dat is `geographic_view.location_type` — het geo-DOELTYPE van Google,
// niet de naam van een staat — en het stond in de kolom waar de staat hoorde. De kaart las die
// tabel netjes uit, kreeg nul bruikbare codes terug, en de klik op de VS deed daardoor niets.
// Het was dus geen ontbrekende sync maar een sync die het verkeerde veld overschreef.
//
// De echte staat zit in `segments.geo_target_state`, dat een resource-naam levert
// (geoTargetConstants/21137). Die moet je apart oplossen naar een leesbare naam. Dit bestand is
// de vertaalstap daartussen, los van de API zodat hij te testen is zonder account.
//
// DE REGEL DIE HIER HET BELANGRIJKST IS
//
// Wat niet te vertalen valt, verdwijnt niet stilletjes. Rijen zonder bruikbare staat komen terug
// als `overgeslagen`, met reden en aantal. Anders is "geen staten gevonden" niet te onderscheiden
// van "de vertaling faalde" — en dat is precies hoe deze tabel de eerste keer stukging.

import { regionNameToUsps } from "./us-fips";

/** Eén rij zoals hij uit geographic_view komt, gesegmenteerd op staat. */
export interface RuweRegioRij {
  /** ISO-maand, "2026-07-01". */
  month: string;
  campaignId: string;
  campaignName: string;
  /** De resource-naam uit segments.geo_target_state, bijv. "geoTargetConstants/21137". */
  geoTargetState: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
}

/** Wat de geo_target_constant-lookup per resource-naam oplevert. */
export interface GeoDoelLabel {
  /** "California" */
  name: string;
  /** "US" */
  countryCode: string;
}

export interface RegioRij {
  month: string;
  country_code: string;
  /** De leesbare staatsnaam zoals Google hem geeft. */
  region_name: string;
  /** De USPS-code, bijv. "CA". Dit is wat de kaart nodig heeft. */
  region_code: string;
  /** Hoeveel verschillende campagnes in deze staat draaiden. */
  campaign_count: number;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
}

export type OverslaanReden = "geen_geo_doel" | "geen_label" | "geen_usps_code";

export interface RegioResultaat {
  rijen: RegioRij[];
  /** Per reden hoeveel rijen er afvielen; alleen redenen die voorkwamen staan erin. */
  overgeslagen: Partial<Record<OverslaanReden, number>>;
  /** De onvertaalbare namen, ontdubbeld — genoeg om te zien wát er ontbreekt. */
  onbekendeNamen: string[];
}

/**
 * Zet de ruwe rijen om naar staten-rijen, opgeteld per (maand, staat).
 *
 * Niet per campagne: ads_region_monthly heeft geen campagnekolommen maar een campaign_count. Dat
 * is de vorm van de tabel en die is hier leidend — een rij per campagne zou er niet in passen.
 *
 * Alleen de Verenigde Staten: de kaart-drilldown is een VS-statenkaart, en een Nederlandse
 * provincie in dezelfde tabel zou daar als niet-tekenbare code in terechtkomen. Andere landen
 * vallen daarom af onder "geen_usps_code" en zijn zo geteld terug te zien.
 */
export function buildRegionRows(ruw: RuweRegioRij[], labels: Map<string, GeoDoelLabel>): RegioResultaat {
  const opgeteld = new Map<string, RegioRij>();
  const campagnesPer = new Map<string, Set<string>>();
  const overgeslagen: Partial<Record<OverslaanReden, number>> = {};
  const onbekend = new Set<string>();

  const sla = (reden: OverslaanReden) => {
    overgeslagen[reden] = (overgeslagen[reden] ?? 0) + 1;
  };

  for (const r of ruw) {
    if (!r.geoTargetState) { sla("geen_geo_doel"); continue; }

    const label = labels.get(r.geoTargetState);
    if (!label) { sla("geen_label"); continue; }

    const usps = label.countryCode === "US" ? regionNameToUsps(label.name) : null;
    if (!usps) {
      sla("geen_usps_code");
      if (label.countryCode === "US") onbekend.add(label.name);
      continue;
    }

    const sleutel = `${r.month}|${usps}`;
    const a = opgeteld.get(sleutel) ?? {
      month: r.month,
      country_code: label.countryCode,
      region_name: label.name,
      region_code: usps,
      campaign_count: 0,
      impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0,
    };
    // Campagnes tellen, niet optellen: dezelfde campagne komt per maand meermaals terug.
    const gezien = campagnesPer.get(sleutel) ?? new Set<string>();
    gezien.add(r.campaignId);
    campagnesPer.set(sleutel, gezien);
    a.campaign_count = gezien.size;
    a.impressions += r.impressions;
    a.clicks += r.clicks;
    a.cost += r.cost;
    a.conversions += r.conversions;
    a.conversions_value += r.conversionsValue;
    opgeteld.set(sleutel, a);
  }

  return { rijen: [...opgeteld.values()], overgeslagen, onbekendeNamen: [...onbekend].sort() };
}

/**
 * Een leesbare regel over wat er afviel, of null als alles doorkwam. Bedoeld voor de synclog:
 * een sync die 12.000 rijen ophaalt en er 0 wegschrijft hoort dat te zeggen.
 */
export function overslaanSamenvatting(res: RegioResultaat): string | null {
  const delen = Object.entries(res.overgeslagen).map(([reden, n]) => `${n}× ${reden}`);
  if (delen.length === 0) return null;
  const staart = res.onbekendeNamen.length > 0 ? ` — onbekende VS-namen: ${res.onbekendeNamen.slice(0, 10).join(", ")}` : "";
  return `${delen.join(", ")}${staart}`;
}
