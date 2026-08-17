"use client";

// De toewijzing van een sprinttaak: de kant, en desgewenst wie binnen die kant.
//
// WAAROM DIT GEEN <select> MEER IS
//
// Het was er een, met twee opties. Dat werkt zolang er twee mogelijke eigenaren zijn en breekt
// zodra er een vrije tekst bij komt: een keuzelijst kan niet typen. De voor de hand liggende
// uitweg — één lange lijst met alle personen, functies en bedrijven door elkaar — verliest juist
// wat de twee assen opleveren, want dan is "Sanne" weer een waarde waaruit niemand kan afleiden
// aan welke kant het werk ligt.
//
// Vandaar dit paneel: eerst de kant (die blijft altijd bekend), dan pas de verbijzondering.
//
// WAT DE GEBRUIKER ZIET ALS ER NIETS IS
//
// auth.users is nu leeg, dus de personenlijst is dat ook. Een lege keuzelijst leest als "er is
// niemand" terwijl het "er is nog niemand aangemaakt" betekent. Daarom staat er in dat geval een
// regel die dat zegt, met de verwijzing waar accounts vandaan komen. Hetzelfde geldt voor de
// klantkant, waar personen per definitie ontbreken.

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import {
  OWNER_TEAM, OWNER_CLIENT, isTeamOwner, normalizeOwner, ownerLabel,
  normalizeSoort, toewijzingLabel, toewijzingCompleet,
  type EigenaarSoort, type Toewijzing,
} from "@/lib/branding/brand";
import { ROLES, ROL_LABEL } from "@/lib/auth/roles";

export interface Teamlid { id: string; naam: string }

/**
 * De teamlijst wordt één keer per paginabezoek opgehaald en gedeeld.
 *
 * Zonder dit haalt elke rij in de sprintplanning zijn eigen kopie op — bij 49 taken zijn dat 49
 * verzoeken naar een route die de admin-API van Supabase aanroept. Dezelfde fout als `npx` in
 * een lus, alleen dan over het netwerk.
 */
export interface TeamResultaat {
  leden: Teamlid[];
  /** Is de lijst daadwerkelijk opgehaald? Onwaar bij een weigering of een netwerkfout. */
  ok: boolean;
}

let teamCache: Promise<TeamResultaat> | null = null;
export function haalTeam(): Promise<TeamResultaat> {
  if (!teamCache) {
    teamCache = fetch("/api/team")
      .then(async (r) => {
        // "Niet mogen" en "er is niemand" leveren allebei nul namen op, en dat mag het scherm
        // niet als hetzelfde tonen. De route weigert met 401/403 zodra je niet bent ingelogd of
        // geen sprint:write hebt — in de demo gebeurt dat gewoon. Zou dat als een lege lijst
        // doorgaan, dan meldt de kiezer "er zijn nog geen gebruikers aangemaakt" terwijl er een
        // hele afdeling kan bestaan die jij alleen niet mag zien.
        if (!r.ok) return { leden: [], ok: false };
        const d = await r.json();
        return { leden: Array.isArray(d?.leden) ? (d.leden as Teamlid[]) : [], ok: true };
      })
      // Een mislukte lijst is geen reden om de hele planning te laten struikelen: je kunt dan
      // nog steeds op kant, functie en bedrijf toewijzen.
      .catch(() => ({ leden: [], ok: false }));
  }
  return teamCache;
}

const SOORT_LABEL: Record<EigenaarSoort | "globaal", string> = {
  globaal: "De hele kant",
  persoon: "Een persoon",
  functie: "Een functie",
  bedrijf: "Een bedrijf",
};

interface Props {
  waarde: Toewijzing;
  team: readonly Teamlid[];
  /** Onwaar als de teamlijst niet opgehaald kon worden. Zie haalTeam. */
  teamOk?: boolean;
  onChange: (t: Toewijzing) => void;
  /** De bureaunaam van de tenant, als die bekend is. Zie ownerLabel. */
  bureauNaam?: string;
  className?: string;
}

export function EigenaarKiezer({ waarde, team, teamOk = true, onChange, bureauNaam, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const houder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const buiten = (e: MouseEvent) => {
      if (houder.current && !houder.current.contains(e.target as Node)) setOpen(false);
    };
    const toets = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", buiten);
    document.addEventListener("keydown", toets);
    return () => { document.removeEventListener("mousedown", buiten); document.removeEventListener("keydown", toets); };
  }, [open]);

  const personen = new Map(team.map((l) => [l.id, l.naam]));
  const label = toewijzingLabel(waarde, { bureauNaam, personen });
  const compleet = toewijzingCompleet(waarde);
  const soort = normalizeSoort(waarde.soort);
  const bureauKant = isTeamOwner(waarde.kant);

  const zet = (deel: Partial<Toewijzing>) => onChange({ ...waarde, ...deel });

  // Van kant wisselen gooit een persoonstoewijzing weg, en dat is opzet: mensen aan klantzijde
  // bestaan niet als gebruiker, dus die verwijzing zou naar de verkeerde kant blijven wijzen.
  const zetKant = (kant: string) => {
    const houdtPersoon = soort === "persoon" && isTeamOwner(kant);
    onChange({
      kant,
      soort: soort === "persoon" && !houdtPersoon ? null : soort,
      naam: waarde.naam,
      userId: houdtPersoon ? waarde.userId : null,
    });
  };

  const zetSoort = (nieuw: EigenaarSoort | null) => {
    // De velden van de vorige soort gaan mee weg. Bleef "webdeveloper" in `naam` staan nadat je
    // naar 'persoon' schakelde, dan verscheen die tekst weer zodra je terugschakelde — een
    // waarde die de gebruiker allang had losgelaten.
    onChange({ kant: waarde.kant, soort: nieuw, naam: null, userId: null });
  };

  return (
    <div ref={houder} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs rounded px-1 py-0.5 border border-transparent hover:border-border focus:outline-none focus:border-brand-blue cursor-pointer max-w-full"
        title={`${ownerLabel(waarde.kant, bureauNaam)}${soort ? ` · ${SOORT_LABEL[soort]}` : ""}`}
      >
        <span className="truncate">{label}</span>
        {/* Half ingevuld hoort zichtbaar te zijn. Het label valt terug op de kant en leest dan
            als een bewuste globale toewijzing, wat het niet is. */}
        {!compleet && <span className="text-amber-600 shrink-0" title="Nog niet ingevuld">•</span>}
        <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-60 rounded-lg border border-border bg-[var(--tip-vlak)] backdrop-blur-md shadow-lg p-2 text-xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Kant</span>
            <button type="button" onClick={() => setOpen(false)} className="p-0.5 rounded hover:bg-[var(--zweef-vlak)]" title="Sluiten">
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1 mb-2.5">
            {[OWNER_TEAM, OWNER_CLIENT].map((k) => {
              const actief = normalizeOwner(waarde.kant) === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => zetKant(k)}
                  className={`px-2 py-1 rounded border text-xs transition-colors ${
                    actief ? "border-brand-blue bg-[var(--zweef-vlak)] font-medium" : "border-border hover:bg-[var(--zweef-vlak)]"
                  }`}
                >
                  {ownerLabel(k, bureauNaam)}
                </button>
              );
            })}
          </div>

          <div className="text-micro font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Toewijzen aan</div>
          <div className="space-y-0.5 mb-2">
            {([null, "persoon", "functie", "bedrijf"] as const).map((s) => {
              // Personen bestaan alleen aan bureaukant; zie de kop van dit bestand.
              if (s === "persoon" && !bureauKant) return null;
              const actief = soort === s;
              return (
                <button
                  key={s ?? "globaal"}
                  type="button"
                  onClick={() => zetSoort(s)}
                  className="flex items-center gap-1.5 w-full px-1.5 py-1 rounded text-left hover:bg-[var(--zweef-vlak)] transition-colors"
                >
                  <Check className={`w-3 h-3 shrink-0 ${actief ? "text-brand-blue" : "opacity-0"}`} />
                  {SOORT_LABEL[s ?? "globaal"]}
                </button>
              );
            })}
          </div>

          {soort === "persoon" && (
            team.length === 0 ? (
              <p className="text-micro text-muted-foreground leading-snug px-1.5 pb-1">
                {teamOk
                  ? "Er zijn nog geen gebruikers aangemaakt, dus er valt niemand te kiezen. Accounts komen uit het beheerscherm."
                  : "De lijst met collega's kon niet worden opgehaald. Dat betekent niet dat er niemand is — log opnieuw in, of wijs toe op functie of bedrijf."}
              </p>
            ) : (
              <select
                value={waarde.userId ?? ""}
                onChange={(e) => zet({ userId: e.target.value || null })}
                className="w-full text-xs border border-border rounded px-1.5 py-1 bg-card focus:outline-none focus:border-brand-blue"
              >
                <option value="">Kies een persoon…</option>
                {team.map((l) => <option key={l.id} value={l.id}>{l.naam}</option>)}
              </select>
            )
          )}

          {(soort === "functie" || soort === "bedrijf") && (
            <>
              <input
                value={waarde.naam ?? ""}
                onChange={(e) => zet({ naam: e.target.value })}
                list={soort === "functie" && bureauKant ? "ctrl-functie-suggesties" : undefined}
                placeholder={soort === "functie" ? "bv. webdeveloper" : "bv. het bureau, of een partner"}
                className="w-full text-xs border border-border rounded px-1.5 py-1 bg-card focus:outline-none focus:border-brand-blue"
              />
              {/* De app-rollen zijn suggestie en geen keuzelijst: ze gaan over rechten in het
                  dashboard, niet over wie werk uitvoert. Aan klantzijde slaan ze nergens op,
                  dus daar wordt de datalist niet gekoppeld. */}
              {soort === "functie" && bureauKant && (
                <datalist id="ctrl-functie-suggesties">
                  {ROLES.map((r) => <option key={r} value={ROL_LABEL[r]} />)}
                </datalist>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
