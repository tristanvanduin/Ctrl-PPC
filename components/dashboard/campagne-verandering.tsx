// De verandering per campagne in een tabelcel, voor de campagnetabellen in de nieuwe weergave
// ("Wat er draait" bij Alle kanalen en per kanaal). Een plek, zodat "nieuw", "gestopt" en een
// streep zonder percentage overal hetzelfde lezen, en de reden overal voor een schermlezer staat.

import { formatCampagneVerandering, type CampagneRegel } from "@/lib/campagnes/campagne-periode";
import { GetalCel } from "./data-table";

/** Eén verandering: het percentage, of een streep met de reden (voor een schermlezer en in `title`). */
function Verandering({ v, wat }: { v: CampagneRegel["kosten"]; wat: string }) {
  if (!v) return null;
  if (v.pct === null) {
    return (
      <span className="block" title={`${wat}: geen percentage, ${v.reden}`}>
        <span aria-hidden>{wat} —</span>
        <span className="sr-only">{wat}: geen percentage, {v.reden}</span>
      </span>
    );
  }
  return <span className="block">{wat} {formatCampagneVerandering(v.pct)}</span>;
}

/** De cel "Verandering": nieuw of gestopt als label, anders conversies en kosten. */
export function CampagneStatusCel({ r }: { r: CampagneRegel }) {
  if (r.status === "nieuw" || r.status === "gestopt") {
    const uitleg = r.status === "nieuw"
      ? "liep in de vergelijkingsperiode niet, dus geen percentage"
      : "liep in deze periode niet meer, dus geen percentage";
    return (
      <GetalCel>
        <span
          data-campagne-status={r.status}
          title={uitleg}
          className={`inline-block rounded-full border px-2 py-px text-micro ${r.status === "nieuw" ? "border-brand-blue/30 bg-brand-blue/5 text-brand-blue-ink" : "border-border text-muted-foreground"}`}
        >
          {r.status}
        </span>
        <span className="sr-only">: {uitleg}</span>
      </GetalCel>
    );
  }
  return (
    <GetalCel zacht className="text-micro">
      <Verandering v={r.conversies} wat="conv." />
      <Verandering v={r.kosten} wat="kosten" />
    </GetalCel>
  );
}
