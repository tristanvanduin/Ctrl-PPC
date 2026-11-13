"use client";

// Instellingen > Doelen & meten: de conversietrechter na de klik. Welke stappen meet deze klant
// (sjabloon Webshop, Formulier of Eigen), en welke conversieacties en events per kanaal horen bij
// elke stap. Alleen bronnen die bij deze klant echt voorkomen: de Google-acties uit de
// conversieacties, en per dagkanaal de kolommen die boven nul stonden. Gelezen via dezelfde
// laadConversiestappen als het Overzicht, met dezelfde termijn: wat hier herkend wordt, telt daar.
//
// BEWAARD in client_settings.checkout_action_map (een bestaand jsonb-veld, via dbUpsert): de keuze
// onder `trechter`, en de Google-posities die de sync leest, op BETEKENIS (checkoutMapUit in
// lib/overzicht/conversiestappen.ts). Een positie die geen stap dekt, houdt wat er stond. Zolang er
// niets bewaard is, toont dit blok de herkenning op naam (met de acties uit een oude kaart), en die
// geldt dan ook op het Overzicht.
//
// TOEGANKELIJK. Elke stap is een groep met een naamveld en per kanaal een fieldset met
// selectievakjes; verschuiven en verwijderen gaan met knoppen (toetsenbord en telefoon, geen slepen).
// Een stap heeft een vaste id: na omhoog of omlaag gaat de focus mee met de stap, en een
// aria-live-regel zegt waar hij nu staat. Elk tikvlak is minstens 44 px.

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, Filter, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { dbUpsert } from "@/lib/data-access/client-write";
import { vergeetClientSettingsRij } from "@/lib/client-settings";
import { ALLE_KANALEN, KANAAL_NAAM, type Kanaal } from "@/lib/kanalen/beschikbaar";
import {
  bronnenMetKeuze, checkoutMapUit, herkenStappen, positiesUitStappen, SJABLONEN, SJABLOON_NAAM,
  type GooglePositie, type Sjabloon, type StapBron, type StapInstelling,
} from "@/lib/overzicht/conversiestappen";
import { laadConversiestappen, vergeetConversiestappen } from "@/lib/overzicht/use-conversiestappen";

/** De dagkanalen: hun kolommen zijn de bronnen. Google komt uit de conversieacties. */
const DAGKANALEN: readonly Kanaal[] = ["meta", "linkedin", "microsoft"];

const POSITIE_NAAM: Record<GooglePositie, string> = { add_to_cart: "winkelwagen", begin_checkout: "afrekenen", purchase: "aankoop" };

interface Geladen { bronnen: StapBron[]; sjabloon: Sjabloon; stappen: StapInstelling[]; eigen: boolean; kaart: unknown }

/** Een stap met een vaste id, voor React en de focus. De id wordt niet bewaard. */
interface Rij { id: number; stap: StapInstelling }

let volgendeId = 1;
const metId = (stappen: readonly StapInstelling[]): Rij[] => stappen.map((stap) => ({ id: volgendeId++, stap }));

async function laad(clientId: string): Promise<Geladen> {
  const bron = await laadConversiestappen(clientId, DAGKANALEN);
  const t = bron.trechter;
  return { bronnen: bronnenMetKeuze(bron.bronnen, t.stappen), sjabloon: t.sjabloon, stappen: t.stappen, eigen: t.eigen, kaart: bron.checkoutActionMap };
}

const KNOP = "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-body text-brand-gray hover:bg-muted/50 disabled:opacity-40";

export function ConversieTrechterSettings({ clientId }: { clientId: string }) {
  const [geladen, setGeladen] = useState<Geladen | null>(null);
  const [sjabloon, setSjabloon] = useState<Sjabloon>("webshop");
  const [rijen, setRijen] = useState<Rij[]>([]);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const [bewaard, setBewaard] = useState(false);
  const [melding, setMelding] = useState("");
  const knoppen = useRef(new Map<string, HTMLButtonElement | null>());
  const focusNa = useRef<string | null>(null);

  useEffect(() => {
    let weg = false;
    laad(clientId)
      .then((g) => {
        if (weg) return;
        setGeladen(g); setSjabloon(g.sjabloon); setRijen(metId(g.stappen)); setFout(null); setBewaard(false);
      })
      .catch((e) => { if (!weg) setFout(e instanceof Error ? e.message : "laden mislukt"); });
    return () => { weg = true; };
  }, [clientId]);

  // Na een verschuiving: de focus naar dezelfde knop van dezelfde stap, of naar de andere richting
  // als die knop aan de rand nu uit staat.
  useEffect(() => {
    const doel = focusNa.current;
    if (!doel) return;
    focusNa.current = null;
    const [id, richting] = doel.split("|");
    const knop = knoppen.current.get(doel);
    const anders = knoppen.current.get(`${id}|${richting === "op" ? "neer" : "op"}`);
    (knop && !knop.disabled ? knop : anders)?.focus();
  }, [rijen]);

  const kanalen = useMemo(() => ALLE_KANALEN.filter((k) => geladen?.bronnen.some((b) => b.kanaal === k)), [geladen]);
  const stappen = useMemo(() => rijen.map((r) => r.stap), [rijen]);
  // Dezelfde functie als het Overzicht na het opslaan: een positie op betekenis, met een Google-actie.
  const posities = useMemo(() => positiesUitStappen(stappen), [stappen]);

  function wijzig(next: Rij[]) { setRijen(next); setBewaard(false); }
  function wijzigStap(id: number, f: (s: StapInstelling) => StapInstelling) {
    wijzig(rijen.map((r) => (r.id === id ? { ...r, stap: f(r.stap) } : r)));
  }

  function kiesSjabloon(s: Sjabloon) {
    setSjabloon(s);
    setBewaard(false);
    if (s !== "eigen" && geladen) setRijen(metId(herkenStappen(s, geladen.bronnen)));
  }

  function verschuif(i: number, richting: -1 | 1) {
    const j = i + richting;
    if (j < 0 || j >= rijen.length) return;
    const next = [...rijen];
    [next[i], next[j]] = [next[j], next[i]];
    focusNa.current = `${next[j].id}|${richting === -1 ? "op" : "neer"}`;
    setMelding(`${next[j].stap.naam || "Stap"} staat nu op plek ${j + 1} van ${next.length}.`);
    wijzig(next);
  }

  function verwijder(i: number) {
    setMelding(`${rijen[i].stap.naam || "Stap"} is verwijderd.`);
    wijzig(rijen.filter((_, x) => x !== i));
  }

  function zetBron(id: number, kanaal: Kanaal, sleutel: string, aan: boolean) {
    wijzigStap(id, (s) => {
      const huidig = s.bronnen[kanaal] ?? [];
      const lijst = aan ? [...new Set([...huidig, sleutel])] : huidig.filter((b) => b !== sleutel);
      return { ...s, bronnen: { ...s.bronnen, [kanaal]: lijst } };
    });
  }

  async function bewaar() {
    setBezig(true); setFout(null);
    const schoon = stappen
      .map((s) => ({ naam: s.naam.trim(), bronnen: s.bronnen }))
      .filter((s) => s.naam !== "");
    // De bestaande kaart gaat mee: een positie die geen stap dekt, blijft zoals hij was.
    const kaart = checkoutMapUit({ sjabloon, stappen: schoon }, geladen?.kaart ?? null);
    const { error } = await dbUpsert("client_settings", clientId, { checkout_action_map: kaart });
    vergeetClientSettingsRij(clientId);
    vergeetConversiestappen(clientId);
    setBezig(false);
    if (error) setFout(error.message);
    else { setRijen(metId(schoon)); setBewaard(true); setGeladen((g) => (g ? { ...g, eigen: true, kaart } : g)); }
  }

  if (fout && !geladen) {
    return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">{fout}</div>;
  }
  if (!geladen) {
    return <div className="flex items-center justify-center gap-2 py-8 text-body text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Laden...</div>;
  }

  return (
    <section aria-labelledby="conversietrechter-kop" className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
      <h2 id="conversietrechter-kop" className="mb-1 flex items-center gap-2 text-base font-semibold text-brand-blue-ink">
        <Filter className="h-5 w-5" aria-hidden /> Conversietrechter
      </h2>
      <p className="mb-3 text-meta text-muted-foreground">
        De stappen na de klik, zoals het Overzicht ze per kanaal toont. Per stap kies je welke conversieacties en events erbij
        horen; je ziet alleen wat bij deze klant echt voorkomt. Google telt per dag alleen winkelwagen, afrekenen en aankoop: een
        stap met die betekenis (op naam, of op zijn Google-acties), vanaf de volgende sync. Diezelfde drie gebruikt de
        maandanalyse. De landingspagina van Meta staat altijd direct na de klik.
      </p>
      {!geladen.eigen && (
        <p className="mb-3 rounded-md bg-muted/50 px-3 py-2 text-meta text-brand-gray">
          Nog niets gekozen: hieronder staat de herkenning op naam, en die geldt nu op het Overzicht. Google telt tot het opslaan
          de acties die al bewaard waren, of anders de acties die letterlijk add_to_cart, begin_checkout en purchase heten.
        </p>
      )}

      <fieldset className="mb-4">
        <legend className="mb-1 text-meta font-semibold text-brand-gray">Sjabloon</legend>
        <div className="flex flex-wrap gap-2">
          {(["webshop", "formulier", "eigen"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={sjabloon === s} onClick={() => kiesSjabloon(s)}
              className={`${KNOP} ${sjabloon === s ? "border-brand-blue-ink bg-brand-blue-ink/10 font-semibold text-brand-blue-ink" : ""}`}>
              {SJABLOON_NAAM[s]}
            </button>
          ))}
        </div>
        <p className="mt-1 text-micro text-muted-foreground">
          {sjabloon === "eigen"
            ? "Eigen stappen: geef ze een naam en kies per kanaal de bronnen."
            : `${SJABLONEN[sjabloon].map((s) => s.naam).join(", ")}. Een sjabloon kiezen zet de herkenning op naam terug.`}
        </p>
      </fieldset>

      {kanalen.length === 0 && (
        <p className="mb-3 text-meta text-muted-foreground">
          Er zijn bij deze klant nog geen conversieacties of events gevonden om uit te kiezen.
        </p>
      )}

      <ol className="space-y-3">
        {rijen.map(({ id, stap }, i) => {
          const label = stap.naam || `Stap ${i + 1}`;
          return (
            <li key={id} className="rounded-lg border border-border/70 p-3" data-trechterinstelling={i}>
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-0 flex-1 basis-48 text-meta text-muted-foreground">
                  Stap {i + 1}
                  <input value={stap.naam} onChange={(e) => wijzigStap(id, (s) => ({ ...s, naam: e.target.value }))}
                    className="mt-1 block min-h-11 w-full rounded-md border border-border px-3 text-body text-brand-gray" />
                </label>
                <div className="flex gap-1">
                  <button type="button" className={KNOP} ref={(el) => { knoppen.current.set(`${id}|op`, el); }}
                    onClick={() => verschuif(i, -1)} disabled={i === 0} aria-label={`${label} omhoog`}>
                    <ArrowUp className="h-4 w-4" aria-hidden />
                  </button>
                  <button type="button" className={KNOP} ref={(el) => { knoppen.current.set(`${id}|neer`, el); }}
                    onClick={() => verschuif(i, 1)} disabled={i === rijen.length - 1} aria-label={`${label} omlaag`}>
                    <ArrowDown className="h-4 w-4" aria-hidden />
                  </button>
                  <button type="button" className={KNOP} onClick={() => verwijder(i)} aria-label={`${label} verwijderen`}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {kanalen.map((k) => {
                  const keuze = new Set(stap.bronnen[k] ?? []);
                  const positie = posities[i];
                  return (
                    <fieldset key={k} className="min-w-0">
                      <legend className="text-meta font-semibold text-brand-gray">
                        {KANAAL_NAAM[k]}
                        {k === "google" && keuze.size > 0 && (
                          <span className="ml-1 font-normal text-muted-foreground">
                            {positie
                              ? `(telt als ${POSITIE_NAAM[positie]})`
                              : "(Google telt deze stap niet: hij is geen winkelwagen, afrekenen of aankoop, of een eerdere stap telt die al)"}
                          </span>
                        )}
                      </legend>
                      {geladen.bronnen.filter((b) => b.kanaal === k).map((b) => (
                        <label key={b.sleutel} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-muted/40">
                          <input type="checkbox" className="h-4 w-4 accent-brand-blue" checked={keuze.has(b.sleutel)}
                            onChange={(e) => zetBron(id, k, b.sleutel, e.target.checked)} />
                          <span className="min-w-0 break-words text-body text-brand-gray">{b.label}</span>
                        </label>
                      ))}
                    </fieldset>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="sr-only" aria-live="polite">{melding}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={KNOP} onClick={() => { wijzig([...rijen, ...metId([{ naam: `Stap ${rijen.length + 1}`, bronnen: {} }])]); setSjabloon("eigen"); }}>
          <Plus className="h-4 w-4" aria-hidden /> Stap toevoegen
        </button>
        <button type="button" onClick={bewaar} disabled={bezig}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-brand-blue-ink px-4 text-body font-semibold text-white disabled:opacity-50">
          {bezig ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />} Opslaan
        </button>
        {bewaard && <span className="flex items-center gap-1 text-meta text-emerald-700" role="status"><CheckCircle2 className="h-4 w-4" aria-hidden /> Opgeslagen</span>}
        {fout && geladen && <span className="text-meta text-amber-800" role="alert">{fout}</span>}
      </div>
    </section>
  );
}
