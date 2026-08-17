"use client";

// Bulk-invulscherm voor bedrijfsmodel en niche, over alle klanten tegelijk.
//
// ── WAAROM DIT ER IS ─────────────────────────────────────────────────────────
//
// lib/benchmark/segment.ts (bedrijfsmodel/niche) en de aggregatie in lib/benchmark/cel.ts hangen
// van dekking af. Gemeten op 9 augustus 2026: 5 van de 71 accounts hadden een bedrijfsmodel, 2
// een niche -- via components/dashboard/client-settings.tsx, ÉÉN klant per paginabezoek. Dat is
// 71 paginabezoeken om de dekking te sluiten. Dit scherm doet het in één tabel.
//
// ── WAT DIT NIET DOET ─────────────────────────────────────────────────────────
//
// Geen andere velden dan bedrijfsmodel en niche. De rest van client-settings.tsx (KPI's,
// conversies, landen) blijft per klant, want die verschillen per klant en horen niet in een
// bulkscherm. app/api/admin/segmentatie/route.ts schrijft daarom ook alleen deze twee kolommen
// plus updated_at.

import { useEffect, useMemo, useState } from "react";
import { BEDRIJFSMODELLEN, isBekendeNiche, nichesPerGroep, normaliseerNiche } from "@/lib/benchmark/segment";
import { Tabel, Kop, KolomKop, Body, Rij, NaamCel, Cel } from "./data-table";

interface KlantRij {
  clientId: string;
  naam: string;
  agencyNaam: string;
  bedrijfsmodel: string | null;
  niche: string | null;
}

interface RijState {
  bedrijfsmodel: string;
  niche: string;
  /** Los van niche bewaard: schakelt iemand van "Anders" terug en weer terug, dan staat zijn
   * getypte tekst er nog. Zelfde patroon als client-settings.tsx. */
  vrijeNiche: string;
}

function naarState(r: KlantRij): RijState {
  return {
    bedrijfsmodel: r.bedrijfsmodel ?? "",
    niche: r.niche ?? "",
    vrijeNiche: isBekendeNiche(r.niche) ? "" : (r.niche ?? ""),
  };
}

export function SegmentatieBulk() {
  const [rijen, setRijen] = useState<KlantRij[] | null>(null);
  const [anoniem, setAnoniem] = useState(false);
  const [bewerkt, setBewerkt] = useState<Record<string, RijState>>({});
  const [alleenOnvolledig, setAlleenOnvolledig] = useState(true);
  const [bezigMetOpslaan, setBezigMetOpslaan] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);

  useEffect(() => {
    let af = false;
    fetch("/api/admin/segmentatie")
      .then(async (res) => {
        if (af) return;
        if (res.status === 401 || res.status === 403) { setAnoniem(true); return; }
        if (!res.ok) return;
        const data = (await res.json()) as { rijen: KlantRij[] };
        setRijen(data.rijen);
        setBewerkt(Object.fromEntries(data.rijen.map((r) => [r.clientId, naarState(r)])));
      })
      .catch(() => { /* stil: dit scherm mag de rest van de admin-pagina niet breken */ });
    return () => { af = true; };
  }, []);

  const onvolledig = useMemo(
    () => (rijen ?? []).filter((r) => !r.bedrijfsmodel && !r.niche).length,
    [rijen]
  );

  const zichtbaar = useMemo(() => {
    if (!rijen) return [];
    return alleenOnvolledig ? rijen.filter((r) => !r.bedrijfsmodel && !r.niche) : rijen;
  }, [rijen, alleenOnvolledig]);

  // Alleen rijen waarvan de bewerkte staat afwijkt van wat er nog staat -- zodat "Opslaan" niet
  // 71 ongewijzigde rijen meestuurt telkens als iemand op de knop klikt.
  const gewijzigd = useMemo(() => {
    if (!rijen) return [];
    return rijen.filter((r) => {
      const s = bewerkt[r.clientId];
      if (!s) return false;
      return (s.bedrijfsmodel || null) !== r.bedrijfsmodel || normaliseerNiche(s.niche) !== r.niche;
    });
  }, [rijen, bewerkt]);

  function zet(clientId: string, deel: Partial<RijState>) {
    setBewerkt((prev) => ({ ...prev, [clientId]: { ...prev[clientId], ...deel } }));
    setMelding(null);
  }

  async function opslaan() {
    if (gewijzigd.length === 0) return;
    setBezigMetOpslaan(true);
    setMelding(null);
    try {
      const payload = gewijzigd.map((r) => {
        const s = bewerkt[r.clientId];
        return {
          clientId: r.clientId,
          bedrijfsmodel: s.bedrijfsmodel || null,
          niche: normaliseerNiche(s.niche),
        };
      });
      const res = await fetch("/api/admin/segmentatie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rijen: payload }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; aantal?: number; error?: string } | null;
      if (!res.ok || !json?.ok) {
        setMelding(json?.error ?? `Opslaan mislukt (${res.status})`);
        return;
      }
      // Lokaal bijwerken zodat "gewijzigd" weer leeg is, zonder een herlaad-rondje.
      setRijen((prev) =>
        (prev ?? []).map((r) => {
          const opgeslagen = payload.find((p) => p.clientId === r.clientId);
          return opgeslagen ? { ...r, bedrijfsmodel: opgeslagen.bedrijfsmodel, niche: opgeslagen.niche } : r;
        })
      );
      setMelding(`${json.aantal} klant${json.aantal === 1 ? "" : "en"} opgeslagen.`);
    } finally {
      setBezigMetOpslaan(false);
    }
  }

  if (anoniem || !rijen) return null;

  const metModel = rijen.filter((r) => r.bedrijfsmodel).length;
  const metNiche = rijen.filter((r) => r.niche).length;

  return (
    <section className="mb-8">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-title font-semibold text-brand-gray">Bedrijfsmodel & niche</h2>
        <span className="text-meta text-muted-foreground">
          {metModel} van {rijen.length} met bedrijfsmodel · {metNiche} van {rijen.length} met niche
        </span>
      </div>
      <p className="mb-3 text-meta text-muted-foreground">
        Voor elke klant apart in te vullen bij Instellingen; hier in één tabel voor alle klanten
        tegelijk. Wijzigingen worden pas geschreven bij &ldquo;Opslaan&rdquo;.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-meta text-brand-gray">
          <input
            type="checkbox"
            checked={alleenOnvolledig}
            onChange={(e) => setAlleenOnvolledig(e.target.checked)}
          />
          Alleen klanten zonder bedrijfsmodel én zonder niche ({onvolledig})
        </label>
        <button
          type="button"
          onClick={opslaan}
          disabled={gewijzigd.length === 0 || bezigMetOpslaan}
          className="ml-auto rounded-lg bg-brand-blue-ink px-3 py-1.5 text-meta font-medium text-white disabled:opacity-40"
        >
          {bezigMetOpslaan ? "Opslaan…" : `Opslaan (${gewijzigd.length})`}
        </button>
      </div>
      {melding && <p className="mb-3 text-meta text-brand-gray">{melding}</p>}

      {zichtbaar.length === 0 ? (
        <p className="rounded-lg border border-border bg-gray-50/70 px-3 py-2 text-meta text-muted-foreground">
          {alleenOnvolledig ? "Geen klanten zonder bedrijfsmodel en niche meer over." : "Geen klanten."}
        </p>
      ) : (
        <Tabel>
          <Kop>
            <KolomKop breed>Klant</KolomKop>
            <KolomKop>Bureau</KolomKop>
            <KolomKop>Bedrijfsmodel</KolomKop>
            <KolomKop>Niche</KolomKop>
          </Kop>
          <Body>
            {zichtbaar.map((r) => {
              const s = bewerkt[r.clientId] ?? naarState(r);
              const isVrij = s.niche !== "" && !isBekendeNiche(s.niche);
              return (
                <Rij key={r.clientId}>
                  <NaamCel>{r.naam}</NaamCel>
                  <Cel nowrap zacht>{r.agencyNaam}</Cel>
                  <Cel nowrap>
                    <select
                      value={s.bedrijfsmodel}
                      onChange={(e) => zet(r.clientId, { bedrijfsmodel: e.target.value })}
                      className="rounded border border-border bg-card px-2 py-1 text-meta focus:border-brand-blue focus:outline-none"
                    >
                      <option value="">—</option>
                      {BEDRIJFSMODELLEN.map((m) => (
                        <option key={m.waarde} value={m.waarde}>{m.label}</option>
                      ))}
                    </select>
                  </Cel>
                  <Cel nowrap>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={isBekendeNiche(s.niche) || !s.niche ? s.niche : "__vrij__"}
                        onChange={(e) => {
                          const waarde = e.target.value;
                          zet(r.clientId, waarde === "__vrij__" ? { niche: s.vrijeNiche || " " } : { niche: waarde });
                        }}
                        className="rounded border border-border bg-card px-2 py-1 text-meta focus:border-brand-blue focus:outline-none"
                      >
                        <option value="">— Geen niche —</option>
                        {nichesPerGroep().map((g) => (
                          <optgroup key={g.groep} label={g.groep}>
                            {g.opties.map((o) => <option key={o.waarde} value={o.waarde}>{o.label}</option>)}
                          </optgroup>
                        ))}
                        <option value="__vrij__">Anders…</option>
                      </select>
                      {isVrij && (
                        <input
                          type="text"
                          value={s.vrijeNiche}
                          placeholder="bijv. tandheelkunde"
                          onChange={(e) => zet(r.clientId, { vrijeNiche: e.target.value, niche: e.target.value })}
                          onBlur={(e) => zet(r.clientId, { niche: normaliseerNiche(e.target.value) ?? "" })}
                          className="w-32 rounded border border-border px-2 py-1 text-meta focus:border-brand-blue focus:outline-none"
                        />
                      )}
                    </div>
                  </Cel>
                </Rij>
              );
            })}
          </Body>
        </Tabel>
      )}
    </section>
  );
}
