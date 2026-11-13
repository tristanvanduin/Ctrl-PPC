// Hoe vaak rondt een analyse af, per cadans: afgerond, mislukt, vastgelopen.
//
// WAAROM DIT BESTAAT. Gemeten op 13 november 2026 (started_at vanaf 1 augustus): de maandanalyse
// rondde 11 van de 40 keer af, 14 keer mislukt en 15 keer bleef hij op "running" staan, met een
// updated_at gelijk aan de startdag. Nergens stond een slagingspercentage, en het logboek leest
// alleen completed en failed, dus een vastgelopen run verscheen op geen enkel scherm. Het zwaarste
// en duurste onderdeel van het product viel zo in ruim de helft van de pogingen stil weg.
//
// WAT HIER TELT ALS WAT.
//   afgerond     status completed
//   mislukt      status failed
//   vastgelopen  status running zonder update sinds de verloopgrens (dezelfde grens als
//                isStaleRunning in lib/scheduler/core.ts; de aanroeper geeft hem mee)
//   bezig        status running binnen die grens, of queued: nog geen uitkomst, telt niet mee
// Het percentage is afgerond / (afgerond + mislukt + vastgelopen). Een vastgelopen run is een
// mislukte run die het niet zegt; hem weglaten zou het percentage juist mooier maken naarmate er
// meer stil wegvalt.
//
// Zuiver en zonder imports: scripts/check-analyse-slagingen.mjs laadt dit bestand rechtstreeks met
// node (typestripping), zonder bundler of padaliassen.

export interface GenerationJobRij {
  job_type: string | null;
  status: string | null;
  started_at: string | null;
  updated_at: string | null;
}

export interface CadansUitslag {
  cadans: string;
  afgerond: number;
  mislukt: number;
  vastgelopen: number;
  bezig: number;
  /** afgerond / (afgerond + mislukt + vastgelopen), of null zonder afgesloten pogingen. */
  slagingspercentage: number | null;
  /** Onder de grens en met genoeg pogingen om er iets over te zeggen. */
  waarschuwing: boolean;
}

export interface SlagingsOpties {
  nu: Date;
  /** Na hoeveel minuten zonder update een running-job als vastgelopen telt. */
  vastgelopenNaMinuten: number;
  /** Onder dit aandeel (0..1) volgt een waarschuwing. */
  grens: number;
  /** Onder dit aantal afgesloten pogingen geen waarschuwing: drie pogingen zijn geen percentage. */
  minimumPogingen: number;
}

export function vatSlagingenSamen(rijen: readonly GenerationJobRij[], opties: SlagingsOpties): CadansUitslag[] {
  const perCadans = new Map<string, CadansUitslag>();
  for (const rij of rijen) {
    const cadans = rij.job_type ?? "onbekend";
    let u = perCadans.get(cadans);
    if (!u) {
      u = { cadans, afgerond: 0, mislukt: 0, vastgelopen: 0, bezig: 0, slagingspercentage: null, waarschuwing: false };
      perCadans.set(cadans, u);
    }
    if (rij.status === "completed") u.afgerond += 1;
    else if (rij.status === "failed") u.mislukt += 1;
    else if (rij.status === "running") {
      const laatst = Date.parse(rij.updated_at ?? rij.started_at ?? "");
      // Een running-job zonder enige tijd is niet "bezig": er is niets dat zegt dat hij leeft.
      const stil = Number.isNaN(laatst) || opties.nu.getTime() - laatst >= opties.vastgelopenNaMinuten * 60_000;
      if (stil) u.vastgelopen += 1;
      else u.bezig += 1;
    } else u.bezig += 1;
  }
  for (const u of perCadans.values()) {
    const afgesloten = u.afgerond + u.mislukt + u.vastgelopen;
    u.slagingspercentage = afgesloten > 0 ? u.afgerond / afgesloten : null;
    u.waarschuwing = u.slagingspercentage !== null && afgesloten >= opties.minimumPogingen && u.slagingspercentage < opties.grens;
  }
  return [...perCadans.values()].sort((a, b) => a.cadans.localeCompare(b.cadans));
}

/** Een regel per cadans, voor de terminal. */
export function slagingsRegel(u: CadansUitslag): string {
  const pct = u.slagingspercentage === null ? "  -- " : `${Math.round(u.slagingspercentage * 100).toString().padStart(3)}%`;
  const label = u.waarschuwing ? "LAAG" : "    ";
  return `  ${label}  ${u.cadans.padEnd(18)} ${pct}  afgerond ${u.afgerond}, mislukt ${u.mislukt}, vastgelopen ${u.vastgelopen}${u.bezig ? `, bezig ${u.bezig}` : ""}`;
}

// ---------------------------------------------------------------------------------------------
// De eindbeslissing van de poort.
//
// WAAROM DIT HIER STAAT EN NIET IN HET SCRIPT. De eerste versie eindigde bij een leeg venster met
// exit 0 en de tekst "dat is geen 100%". De poort telde dat als groen. De keten draait sinds
// 1 september niet meer; met een venster van 90 dagen valt de laatste run eind november eruit, en
// vanaf dan zou deze poort groen zijn OMDAT er niets draait. Dat is precies het gebrek dat hij moest
// vangen ("een lege tabel leest als in orde"). Daarom is de beslisregel een zuivere functie met een
// test die eist dat een leeg venster niet groen is.
//
// Twee regels naast de grens:
//   - een leeg venster is rood, met per cadans de datum van de laatste afgeronde run;
//   - een cadans waarvan de laatste afgeronde run ouder is dan zijn eigen termijn is rood, ook als
//     het percentage in het venster nog goed oogt: een keten die stilvalt, levert geen mislukkingen
//     op, alleen stilte.

/** Hoeveel dagen een cadans zonder afgeronde run mag zitten voordat dat een melding is. */
export const MAX_DAGEN_ZONDER_AFRONDING: Readonly<Record<string, number>> = {
  // Een week plus drie dagen speling voor een gemiste nacht of een feestdag.
  weekly_sop: 10,
  biweekly_sop: 17,
  // Een maand plus een week: de maandanalyse draait begin van de maand, niet op een vaste dag.
  monthly_sop: 38,
};

export interface LaatsteAfronding {
  cadans: string;
  /** updated_at van de laatste completed-run, ooit; null als er nooit een afrondde. */
  laatst: string | null;
}

export interface PoortBeslissing {
  /** 0 groen, 1 rood. Overgeslagen (3) beslist het script zelf: dat gaat over de verbinding. */
  code: 0 | 1;
  meldingen: string[];
}

const dagenTussen = (nu: Date, iso: string): number => (nu.getTime() - Date.parse(iso)) / 86_400_000;
const datum = (iso: string | null): string => (iso ? iso.slice(0, 10) : "nooit");

export function beslisSlagingsPoort(
  uitslag: readonly CadansUitslag[],
  laatsteAfrondingen: readonly LaatsteAfronding[],
  opties: { nu: Date; maxDagen?: Readonly<Record<string, number>> }
): PoortBeslissing {
  const maxDagen = opties.maxDagen ?? MAX_DAGEN_ZONDER_AFRONDING;
  const meldingen: string[] = [];
  let rood = false;

  if (uitslag.length === 0) {
    meldingen.push("geen enkele gestarte analyse in dit venster: er is niets gedraaid om te beoordelen, en dat is geen groen.");
    const bekend = new Map(laatsteAfrondingen.map((l) => [l.cadans, l.laatst]));
    for (const cadans of Object.keys(maxDagen)) {
      if (!bekend.has(cadans)) bekend.set(cadans, null);
    }
    for (const [cadans, laatst] of [...bekend.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      meldingen.push(`  laatste afgeronde ${cadans}: ${datum(laatst)}`);
    }
    return { code: 1, meldingen };
  }

  const laag = uitslag.filter((u) => u.waarschuwing);
  if (laag.length > 0) {
    rood = true;
    meldingen.push(`${laag.length} cadans(en) onder de grens: ${laag.map((u) => u.cadans).join(", ")}. Een vastgelopen run telt als mislukt.`);
  }

  // Alleen de cadansen met een termijn: een pdf-job of rooktest heeft geen ritme om te missen.
  for (const [cadans, max] of Object.entries(maxDagen)) {
    const laatst = laatsteAfrondingen.find((l) => l.cadans === cadans)?.laatst ?? null;
    const oud = laatst === null || Number.isNaN(Date.parse(laatst)) || dagenTussen(opties.nu, laatst) > max;
    if (oud) {
      rood = true;
      meldingen.push(`${cadans}: laatste afgeronde run ${datum(laatst)}, langer dan ${max} dagen geleden. De keten staat stil.`);
    }
  }

  return { code: rood ? 1 : 0, meldingen };
}
