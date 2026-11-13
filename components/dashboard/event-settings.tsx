"use client";

import { useState, useEffect } from "react";
import { Loader2, CalendarClock, Save, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { dbUpsert } from "@/lib/data-access/client-write";
import { vergeetClientSettingsRij } from "@/lib/client-settings";
import { vergeetBlendedClientData } from "@/lib/use-blended-client-data";
import { dbSelectOne } from "@/lib/data-access/client-read";
import { AccountEventPacing } from "./account-event-pacing";
import { standardB2cEvents } from "@/lib/events/standard-b2c-events";
import type { Edition } from "@/lib/fair/geo-clone-settings";
import { editieDag, editieHint, eventsVoorOpslag, foutenVoorOpslag, valideerEditie, type EditieVeld } from "@/lib/events/editie-invoer";

// Beurs-event-instellingen per klant: beurzen/geo-clones met cadans (jaarlijks/2-jaarlijks/anders)
// en de datums van de afgelopen edities. Slaat op in client_settings.rai_events (migratie 024).
// Deze input voedt de event-relatieve vergelijking en forecast (lib/fair): waarmee moet de
// huidige editie vergeleken worden. Voorloper op de per-geo-clone entiteit-laag.
//
// Per editie optioneel een begin en een eind naast de datum (de periode van een actie of beurs; de
// datum blijft het ankerpunt). Controle en opslagvorm staan in lib/events/editie-invoer.ts: een
// leeg begin of eind wordt weggelaten, zodat een editie zonder periode opgeslagen wordt als voorheen.

type Cadence = "annual" | "biennial" | "custom";
const CADENCE_LABEL: Record<Cadence, string> = {
  annual: "Jaarlijks",
  biennial: "2-jaarlijks",
  custom: "Anders",
};

interface FairEvent { id: string; name: string; abbrev: string; cadence: Cadence; editions: Edition[] }

function emptyEvent(): FairEvent {
  return { id: (globalThis.crypto?.randomUUID?.() ?? String(Date.now())), name: "", abbrev: "", cadence: "annual", editions: [{ date: "", label: "" }] };
}

export function EventSettings({ clientId }: { clientId: string }) {
  const [events, setEvents] = useState<FairEvent[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumpt na een geslaagde save zodat de T-minus-pacing hieronder de net opgeslagen edities
  // leest i.p.v. de vorige stand (de pacing-route leest server-side, niet de lokale formstate).
  const [savedTick, setSavedTick] = useState(0);
  // Alleen true direct na het automatisch invullen van de b2c-suggestie, tot de eerste bewerking
  // of save -- puur voor de hint hieronder, geen server-state.
  const [suggested, setSuggested] = useState(false);

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setError("Supabase is niet geconfigureerd"); return; }
    let cancelled = false;
    setEvents(null); setError(null); setSaved(false); setSuggested(false);
    dbSelectOne<{ rai_events: unknown; bedrijfsmodel: string | null }>("client_settings", { select: "rai_events, bedrijfsmodel", clientId })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setError(error.message); setEvents([]); return; }
        const raw = (data?.rai_events as { events?: FairEvent[] } | null) ?? null;
        const saved = Array.isArray(raw?.events) ? raw!.events : [];
        // Suggestie alleen bij een helemaal lege lijst -- zodra er iets opgeslagen is (ook een
        // lege lijst na bewust verwijderen), niet opnieuw opdringen.
        if (saved.length === 0 && data?.bedrijfsmodel === "b2c") {
          setEvents(standardB2cEvents());
          setSuggested(true);
        } else {
          setEvents(saved);
        }
      });
    return () => { cancelled = true; };
  }, [clientId]);

  function patchEvent(id: string, next: Partial<FairEvent>) {
    setEvents((evs) => evs?.map((e) => (e.id === id ? { ...e, ...next } : e)) ?? evs);
    setSaved(false); setSuggested(false);
  }
  function patchEdition(eventId: string, idx: number, next: Partial<Edition>) {
    setEvents((evs) => evs?.map((e) => e.id === eventId ? { ...e, editions: e.editions.map((ed, i) => i === idx ? { ...ed, ...next } : ed) } : e) ?? evs);
    setSaved(false); setSuggested(false);
  }

  async function save() {
    const sb = supabase;
    if (!sb || !events) return;
    setSaving(true); setError(null);
    // Niet opslaan zolang een editie een fout heeft: een begin zonder datum zou anders stil wegvallen.
    const fouten = foutenVoorOpslag(events);
    if (fouten.length > 0) {
      setSaving(false);
      setError(`Niet opgeslagen: ${fouten.length === 1 ? "één editie heeft een fout" : `${fouten.length} fouten in de edities`}. ${fouten[0]}`);
      return;
    }
    // lege edities eruit, en een leeg begin of eind weggelaten (niet als "" bewaard)
    const clean = eventsVoorOpslag(events);
    const { error } = await dbUpsert("client_settings", clientId, { rai_events: { events: clean } });
    // De gedeelde client_settings-rij (lib/client-settings.ts) na elke schrijfactie vergeten: de
    // beurs-editie van het Overzicht (useUpcomingEdition) leest de beurzen eruit.
    vergeetClientSettingsRij(clientId);
    setSaving(false);
    if (error) setError(error.message.includes("rai_events") ? "Kolom ontbreekt — draai eerst migratie 024_rai_events.sql." : error.message);
    else {
      // De ene vergeet-ingang voor de blended route: gemounte lezers (de beursstrip op Alle
      // kanalen leest de editie naast de blended data) halen opnieuw op.
      vergeetBlendedClientData(clientId);
      setSaved(true); setSavedTick((t) => t + 1); setTimeout(() => setSaved(false), 4000);
    }
  }

  if (error && !events) {
    return <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">{error}</div>;
  }
  if (!events) {
    return <div className="flex items-center gap-2 text-body text-muted-foreground py-8 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Laden...</div>;
  }

  return (
    <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <CalendarClock className="w-5 h-5 text-brand-blue-ink" />
        <h2 className="text-base font-semibold text-brand-blue-ink">Beurzen & momenten</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        Leg per beurs, geo-clone of ander terugkerend moment (bijv. Black Friday) vast of het jaarlijks of
        2-jaarlijks is en wanneer de afgelopen edities plaatsvonden. Dit bepaalt met welke vorige editie de
        huidige data vergeleken wordt, en voedt de event-prognose.
      </p>

      {suggested && (
        <div className="mb-4 rounded-md border border-brand-blue/20 bg-brand-blue/5 px-3 py-2 text-meta text-brand-blue-ink">
          Alvast ingevuld op basis van het bedrijfsmodel (b2c): Black Friday, Cyber Monday, Kerst en
          Valentijnsdag. Pas de data aan of verwijder wat niet van toepassing is, en klik daarna op
          Opslaan.
        </div>
      )}
      <div className="space-y-4">
        {events.length === 0 && (
          <p className="text-body text-muted-foreground">Nog geen beurzen of momenten ingesteld. Voeg er een toe.</p>
        )}
        {events.map((ev) => (
          <div key={ev.id} className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="block sm:col-span-2">
                  <span className="text-meta font-medium text-brand-gray">Naam</span>
                  <input type="text" value={ev.name} placeholder="bijv. GreenTech Amsterdam"
                    onChange={(e) => patchEvent(ev.id, { name: e.target.value })}
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 text-lead focus:border-brand-blue/50 focus:outline-none" />
                </label>
                <label className="block">
                  <span className="text-meta font-medium text-brand-gray">Afkorting (campagne)</span>
                  <input type="text" value={ev.abbrev} placeholder="bijv. GTA"
                    onChange={(e) => patchEvent(ev.id, { abbrev: e.target.value })}
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 text-lead font-mono focus:border-brand-blue/50 focus:outline-none" />
                </label>
              </div>
              <button onClick={() => { setEvents((evs) => evs?.filter((e) => e.id !== ev.id) ?? evs); setSaved(false); setSuggested(false); }}
                className="mt-6 text-muted-foreground hover:text-red-500 transition-colors" title="Verwijderen">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-meta font-medium text-brand-gray">Cadans:</span>
              {(Object.keys(CADENCE_LABEL) as Cadence[]).map((c) => (
                <button key={c} onClick={() => patchEvent(ev.id, { cadence: c })}
                  className={`px-2.5 py-1 rounded-md text-meta font-medium transition-colors ${ev.cadence === c ? "bg-brand-blue text-white" : "bg-gray-100 text-muted-foreground hover:text-brand-gray"}`}>
                  {CADENCE_LABEL[c]}
                </button>
              ))}
            </div>

            <div>
              <span className="text-meta font-medium text-brand-gray">Afgelopen edities</span>
              <div className="space-y-2 mt-1">
                {ev.editions.map((ed, idx) => {
                  const fouten = valideerEditie(ed);
                  const hint = editieHint(ed);
                  const basis = `editie-${ev.id}-${idx}`;
                  // Een veld wijst naar zijn eigen foutmelding, en begin en eind ook naar de uitleg
                  // over de lege grens (die verschijnt pas als er maar één van de twee is ingevuld).
                  const beschrijving = (veld: EditieVeld) => [
                    fouten[veld] ? `${basis}-${veld}-fout` : null,
                    hint && veld !== "date" ? `${basis}-hint` : null,
                  ].filter(Boolean).join(" ") || undefined;
                  const veldKlasse = (veld: EditieVeld) =>
                    `mt-1 w-full min-w-0 min-h-11 sm:min-h-0 rounded-md border px-3 py-1.5 text-body focus:outline-none ${fouten[veld] ? "border-red-400 focus:border-red-500" : "border-border focus:border-brand-blue/50"}`;
                  return (
                    <div key={idx} className="rounded-md border border-border/60 p-3">
                      <div className="flex items-start gap-2">
                        {/* Twee gelijke kolommen vanaf een tablet: Begin en Eind staan onder Datum en Label
                            en zijn even breed (een smalle datumkolom naast een brede maakte Eind
                            breder dan Begin). Op een telefoon alles onder elkaar. */}
                        <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
                          <div className="min-w-0">
                            <label className="block min-w-0">
                              <span className="text-meta font-medium text-brand-gray">Datum (ankerpunt)</span>
                              <input type="date" value={ed.date}
                                aria-invalid={fouten.date ? true : undefined} aria-describedby={beschrijving("date")}
                                onChange={(e) => patchEdition(ev.id, idx, { date: e.target.value })}
                                className={veldKlasse("date")} />
                            </label>
                            {fouten.date && <p id={`${basis}-date-fout`} className="mt-1 text-meta text-red-600">{fouten.date}</p>}
                          </div>
                          <label className="block min-w-0">
                            <span className="text-meta font-medium text-brand-gray">Label</span>
                            <input type="text" value={ed.label} placeholder="bijv. 2026"
                              onChange={(e) => patchEdition(ev.id, idx, { label: e.target.value })}
                              className="mt-1 w-full min-w-0 min-h-11 sm:min-h-0 rounded-md border border-border px-3 py-1.5 text-body focus:border-brand-blue/50 focus:outline-none" />
                          </label>
                          <div className="min-w-0">
                            <label className="block min-w-0">
                              <span className="text-meta font-medium text-brand-gray">Begin (optioneel)</span>
                              <input type="date" value={editieDag(ed.start)}
                                aria-invalid={fouten.start ? true : undefined} aria-describedby={beschrijving("start")}
                                onChange={(e) => patchEdition(ev.id, idx, { start: e.target.value })}
                                className={veldKlasse("start")} />
                            </label>
                            {fouten.start && <p id={`${basis}-start-fout`} className="mt-1 text-meta text-red-600">{fouten.start}</p>}
                          </div>
                          <div className="min-w-0">
                            <label className="block min-w-0">
                              <span className="text-meta font-medium text-brand-gray">Eind (optioneel)</span>
                              <input type="date" value={editieDag(ed.end)} min={editieDag(ed.start) || undefined}
                                aria-invalid={fouten.end ? true : undefined} aria-describedby={beschrijving("end")}
                                onChange={(e) => patchEdition(ev.id, idx, { end: e.target.value })}
                                className={veldKlasse("end")} />
                            </label>
                            {fouten.end && <p id={`${basis}-end-fout`} className="mt-1 text-meta text-red-600">{fouten.end}</p>}
                          </div>
                          {hint && <p id={`${basis}-hint`} className="sm:col-span-2 text-meta text-muted-foreground">{hint}</p>}
                        </div>
                        <button type="button" onClick={() => patchEvent(ev.id, { editions: ev.editions.filter((_, i) => i !== idx) })}
                          className="mt-5 flex items-center justify-center min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 text-muted-foreground hover:text-red-500"
                          title="Editie verwijderen" aria-label="Editie verwijderen">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                <button type="button" onClick={() => patchEvent(ev.id, { editions: [...ev.editions, { date: "", label: "" }] })}
                  className="flex items-center gap-1 min-h-11 sm:min-h-0 text-meta text-brand-blue-ink hover:underline">
                  <Plus className="w-3 h-3" /> Editie toevoegen
                </button>
              </div>
            </div>

            {/* Live T-minus-preview, alleen zodra er een opgeslagen datum is: de pacing-route
                leest server-side, dus een net toegevoegde maar nog niet opgeslagen editie zou
                hier stil de vorige (of geen) stand tonen. */}
            {ev.editions.some((ed) => ed.date) && (
              <AccountEventPacing clientId={clientId} eventId={ev.id} refreshKey={savedTick} />
            )}
          </div>
        ))}

        <button type="button" onClick={() => { setEvents((evs) => [...(evs ?? []), emptyEvent()]); setSaved(false); setSuggested(false); }}
          className="flex items-center gap-1.5 min-h-11 sm:min-h-0 text-body text-brand-blue-ink hover:underline">
          <Plus className="w-4 h-4" /> Beurs of moment toevoegen
        </button>
      </div>

      {error && <p role="alert" className="text-meta text-red-500 mt-3">{error}</p>}
      <button onClick={save} disabled={saving}
        className="mt-4 flex items-center gap-2 px-4 py-2 rounded-md bg-brand-blue text-white text-body font-medium hover:bg-brand-blue/90 disabled:opacity-50 transition-all">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
        {saving ? "Opslaan..." : saved ? "Opgeslagen" : "Opslaan"}
      </button>
    </div>
  );
}
