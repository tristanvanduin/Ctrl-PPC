"use client";

import { useState, useEffect, useCallback } from "react";
import { Inbox, Check, X, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { dbSelect } from "@/lib/data-access/client-read";
import { prioritizeQueue, summarizePlan } from "@/lib/learning/prioritize-queue";
import { channelOfSource, type InsightChannel } from "@/lib/insights/channel-of";
import { dbUpdate, dbInsert } from "@/lib/data-access/client-write";
import { ChannelBadge } from "./channel-filter";
import { metriekLabel } from "@/lib/util/tekst";
import { OWNER_TEAM } from "@/lib/branding/brand";

// De goedkeuringswachtrij: ALLE pending voorstellen uit sprint_hypotheses, ongeacht bron
// (zoektermen, losse analyses, second opinion, Meta/LinkedIn/cross-signalen). De maand-
// hypotheses hebben hun eigen workflow-block (via de structured output); dit block maakt de
// rest zichtbaar — tot nu toe stonden die voorstellen wel in de wachtrij maar nergens in de
// UI. Accepteren zet status accepted (verschijnt in de sprintplanning); afwijzen vraagt een
// reden en bewaart die in decision_reason.

export interface Proposal {
  id: string;
  hypothesis: string;
  expected_result: string | null;
  measurement_metric: string | null;
  timeframe: string | null;
  rationale: string | null;
  ice_total: number | null;
  // De losse ICE-onderdelen zijn nodig voor de tie-breaks in prioritizeQueue. Zonder deze
  // velden viel de volgorde bij een gelijke totaalscore terug op wat de database toevallig
  // teruggaf, en dan staat een voorstel de ene keer boven en de andere keer onder.
  ice_impact: number | null;
  ice_confidence: number | null;
  ice_ease: number | null;
  source: string | null;
  created_at: string;
  /** Migratie 088, generiek. lib/second-opinion/findings-to-hypotheses.ts vult
   *  confidence_recalibration wanneer Loop 5's kalibratie de ice_confidence heeft bijgesteld op
   *  basis van de historische trefzekerheid van deze bron -- zie lib/learning/signal-calibration.ts. */
  metadata?: { confidence_recalibration?: { base: number; calibrated: number; detail: string | null } } | null;
}

// De maand-bron heeft zijn eigen workflow-block; hier bewust uitgesloten (geen dubbele UI).
const EXCLUDED_SOURCES = new Set(["analysis"]);

/**
 * Hoeveel voorstellen er in de eerstvolgende sprint passen. Bewust een vast getal en geen
 * instelling: de waarde zegt "dit is wat een team in een sprint werkelijk afrondt", en die
 * discipline verdwijnt zodra iemand hem kan ophogen om de lijst korter te laten lijken.
 * Blijkt vijf structureel te laag of te hoog, dan is dat een gesprek en geen schuifje.
 */
const SPRINT_CAPACITEIT = 5;

/**
 * Maakt van de opgehaalde voorstellen een geprioriteerd plan.
 *
 * Sorteren op ice_total alleen liet twee dingen liggen. Bij een gelijke totaalscore bepaalde de
 * database de volgorde, dus stond hetzelfde voorstel de ene keer boven en de andere keer onder;
 * prioritizeQueue breekt gelijkstand op impact, dan confidence, dan ease, en houdt bij volledige
 * gelijkheid de invoervolgorde aan. En een lijst van dertig voorstellen zegt niet wat er in de
 * eerstvolgende sprint past — de splitsing doet dat wel.
 *
 * Staat los van de component zodat het te testen is zonder een renderer.
 */
export function planVoorWachtrij(voorstellen: Proposal[]) {
  const plan = prioritizeQueue(
    voorstellen.map((p) => ({
      id: p.id,
      hypothesis: p.hypothesis,
      source: p.source,
      // Ontbrekende ICE-onderdelen tellen als nul. Dat mag hier: het schema geeft ze een
      // default van 0, en een voorstel zonder score hoort onderaan te eindigen, niet bovenaan.
      iceImpact: p.ice_impact ?? 0,
      iceConfidence: p.ice_confidence ?? 0,
      iceEase: p.ice_ease ?? 0,
      iceTotal: p.ice_total ?? 0,
    })),
    { sprintCapacity: SPRINT_CAPACITEIT }
  );
  const perId = new Map(voorstellen.map((p) => [p.id, p]));
  return {
    plan,
    plaatsing: new Map(plan.map((item) => [item.id!, item])),
    // De volgorde van het plan, met de oorspronkelijke rijen erbij. Een voorstel dat om welke
    // reden dan ook niet terug te vinden is valt weg in plaats van als undefined te renderen.
    geordend: plan.map((item) => perId.get(item.id!)).filter((p): p is Proposal => p !== undefined),
    samenvatting: summarizePlan(plan),
    bronnen: Object.entries(summarizePlan(plan).bySource).sort((a, b) => b[1] - a[1]),
  };
}

export function ProposalQueue({ clientId, refreshKey, channel, onWorkflowChange }: {
  clientId: string;
  refreshKey?: number;
  channel?: InsightChannel | null;
  onWorkflowChange?: () => void;
}) {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data } = await dbSelect<Proposal>("sprint_hypotheses", {
      select: "id, hypothesis, expected_result, measurement_metric, timeframe, rationale, ice_total, ice_impact, ice_confidence, ice_ease, source, created_at, metadata",
      clientId,
      filters: [{ op: "eq", column: "status", value: "pending" }],
      // De database sorteert grof; de fijne volgorde en de sprint/backlog-splitsing komen uit
      // prioritizeQueue hieronder. Deze order blijft staan zodat de lijst ook klopt als de
      // prioritering ooit wegvalt.
      order: { column: "ice_total", ascending: false },
    });
    setProposals(data.filter((p) => !EXCLUDED_SOURCES.has((p.source ?? "").toLowerCase())));
  }, [clientId]);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  async function decide(p: Proposal, action: "accept" | "reject") {
    if (!supabase) return;
    let reason = "";
    if (action === "reject") {
      reason = window.prompt("Waarom wijs je dit voorstel af?")?.trim() || "";
      if (!reason) return;
    }
    setBusyId(p.id);
    const now = new Date().toISOString();
    const patch = action === "accept"
      ? { status: "accepted", accepted_at: now, decided_at: now }
      : { status: "rejected", decision_reason: reason, decided_at: now };
    const { error } = await dbUpdate("sprint_hypotheses", clientId, patch, { id: p.id, status: "pending" });
    setBusyId(null);
    if (!error) {
      // Fase 4: het match-filter op status "pending" hierboven maakt dit al idempotent-veilig --
      // een tweede decide() op dezelfde rij matcht niets meer (al accepted/rejected), dus dit
      // event komt maar één keer per echte beslissing.
      void dbInsert("agency_memory_events", clientId, {
        hypothesis_id: p.id,
        event_type: action === "accept" ? "hypothesis_accepted" : "hypothesis_rejected",
        reason: action === "reject" ? reason : null,
      });
      // Feedback: "Hypothese goedkeuren maakt niet een sprintplanning aan als die nog niet
      // bestaat." Klopte -- dit was de enige van de drie goedkeuringspaden (naast
      // sprint-planning.tsx's addHypothesisWithTask en de maand-structured-output-route) die de
      // hypothese wel accepteerde maar nooit een sprint_items-rij aanmaakte. Zonder gekoppelde
      // taken (deze voorstellen hebben geen linked_task_ids, in tegenstelling tot de
      // maand-workflow) is de hypothesetekst zelf de taak -- zelfde aanname als
      // addHypothesisWithTask maakt voor een handmatig aangemaakte hypothese.
      if (action === "accept") {
        const currentWeek = Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
        void dbInsert("sprint_items", clientId, {
          hypothesis_id: p.id,
          week_number: currentWeek,
          task: p.hypothesis,
          status: "todo",
          owner: OWNER_TEAM,
          metrics: p.measurement_metric,
          review_timeframe: p.timeframe,
        });
      }
      setProposals((prev) => prev?.filter((x) => x.id !== p.id) ?? prev);
      onWorkflowChange?.();
    }
  }

  const filtered = (proposals ?? []).filter((p) => !channel || channelOfSource(p.source) === channel);

  const { geordend, plaatsing, samenvatting, bronnen } = planVoorWachtrij(filtered);

  if (proposals === null) {
    return (
      <div className="bg-card rounded-xl border border-border p-5 shadow-sm flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-brand-blue-ink" />
      </div>
    );
  }
  if (filtered.length === 0) return null; // lege wachtrij: geen loze kaart

  return (
    <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <Inbox className="w-4 h-4 text-brand-blue-ink" />
        <h3 className="text-sm font-semibold text-brand-blue-ink uppercase tracking-wide">Goedkeuringswachtrij</h3>
        <span className="text-micro text-muted-foreground">{filtered.length} voorstel{filtered.length === 1 ? "" : "len"}</span>
      </div>
      <p className="text-micro text-muted-foreground mb-3">
        Voorstellen uit de losse analyses en signaal-detecties. Accepteren zet ze in de sprintplanning; afwijzen bewaart de reden.
      </p>

      {/* Het plan in één regel: wat past er in de sprint, en domineert één bron de wachtrij? */}
      <div className="flex items-center gap-2 flex-wrap mb-3 text-micro">
        <span className="px-2 py-0.5 rounded-md bg-brand-blue/10 text-brand-blue-ink font-semibold">
          {samenvatting.sprintCount} in de eerstvolgende sprint
        </span>
        {samenvatting.backlogCount > 0 && (
          <span className="px-2 py-0.5 rounded-md bg-gray-100 text-muted-foreground font-medium">
            {samenvatting.backlogCount} naar de backlog
          </span>
        )}
        {bronnen.length > 1 && (
          <span className="text-muted-foreground">
            bronnen: {bronnen.map(([bron, n]) => `${bron} ${n}`).join(" · ")}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {geordend.map((p) => (
          <div
            key={p.id}
            className={`rounded-lg border px-3 py-2.5 ${
              plaatsing.get(p.id)?.placement === "backlog"
                ? "border-border bg-gray-50/60"
                : "border-border"
            }`}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-micro font-semibold text-muted-foreground tabular-nums">
                    #{plaatsing.get(p.id)?.rank}
                  </span>
                  <ChannelBadge channel={channelOfSource(p.source)} />
                  <span className="text-micro text-muted-foreground">{p.source ?? "onbekend"}</span>
                  {p.ice_total != null && <span className="text-micro font-semibold text-brand-blue-ink">ICE {p.ice_total.toFixed(1)}</span>}
                  {p.metadata?.confidence_recalibration && (
                    <span
                      className="text-micro px-1.5 py-0.5 rounded bg-brand-blue-ink/10 text-brand-blue-ink font-medium cursor-help"
                      title={p.metadata.confidence_recalibration.detail ?? "Confidence bijgesteld o.b.v. eerdere uitkomsten van deze bron"}
                    >
                      confidence bijgesteld
                    </span>
                  )}
                  {plaatsing.get(p.id)?.placement === "backlog" && (
                    <span className="text-micro px-1.5 py-0.5 rounded bg-gray-100 text-muted-foreground font-medium">backlog</span>
                  )}
                </div>
                <p className="text-body text-brand-gray font-medium mt-1">{p.hypothesis}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => decide(p, "accept")}
                  disabled={busyId === p.id}
                  className="flex items-center gap-1 px-2.5 py-1 text-micro font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busyId === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Accepteer
                </button>
                <button
                  onClick={() => decide(p, "reject")}
                  disabled={busyId === p.id}
                  className="flex items-center gap-1 px-2.5 py-1 text-micro font-medium rounded-md border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  <X className="w-3 h-3" /> Wijs af
                </button>
              </div>
            </div>
            <button
              onClick={() => setExpanded(expanded === p.id ? null : p.id)}
              className="flex items-center gap-1 text-micro text-brand-blue-ink hover:underline mt-1.5"
            >
              {expanded === p.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded === p.id ? "Verberg detail" : "Detail"}
            </button>
            {expanded === p.id && (
              <div className="mt-2 space-y-1 text-meta text-muted-foreground">
                {p.rationale && <p><span className="font-medium text-brand-gray">Onderbouwing:</span> {p.rationale}</p>}
                {p.expected_result && <p><span className="font-medium text-brand-gray">Verwacht:</span> {p.expected_result}</p>}
                {p.measurement_metric && <p><span className="font-medium text-brand-gray">Meting:</span> {metriekLabel(p.measurement_metric)}</p>}
                {p.timeframe && <p><span className="font-medium text-brand-gray">Termijn:</span> {p.timeframe}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
