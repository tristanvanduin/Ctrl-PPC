"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import { OWNER_TEAM, OWNER_CLIENT, ownerLabel, toewijzingLabel, normalizeOwner, normalizeSoort } from "@/lib/branding/brand";
import { EigenaarKiezer, haalTeam, type Teamlid } from "./eigenaar-kiezer";
import { Download, ChevronDown, ChevronUp, Loader2, Calendar, Plus, X, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { dbSelect } from "@/lib/data-access/client-read";
import { channelOfSource, CHANNEL_LABEL, type InsightChannel } from "@/lib/insights/channel-of";
import { dbInsert, dbUpdate, dbUpdateIn } from "@/lib/data-access/client-write";
import { ChannelFilter, ChannelBadge } from "./channel-filter";
import { today } from "@/lib/reporting-date";
import { metriekLabel } from "@/lib/util/tekst";

interface SprintItem {
  id: string;
  client_id: string;
  hypothesis_id: string | null;
  week_number: number | null;
  task: string;
  status: string;
  // De KANT: 'Bureau' of 'Klant'. Historische rijen dragen nog namen; normalizeOwner vertaalt
  // die bij het lezen. Zie lib/branding/brand.ts.
  owner: string;
  // De toewijzing binnen die kant, uit migratie 033. Alle drie mogen leeg zijn en zijn dat bij
  // elke bestaande rij — leeg betekent: de kant als geheel.
  owner_soort: string | null;
  owner_naam: string | null;
  owner_user_id: string | null;
  metrics: string | null;
  review_timeframe: string | null;
  created_at: string;
  updated_at: string;
}

interface HypothesisRef {
  id: string;
  hypothesis: string;
  status: string;
  ice_total: number;
  source: string | null;
}

const STATUS_OPTIONS = [
  { value: "todo", label: "To Do", color: "bg-blue-100 text-blue-700" },
  { value: "in_planning", label: "in Planning", color: "bg-yellow-100 text-yellow-700" },
  { value: "ongoing", label: "On going", color: "bg-purple-100 text-purple-700" },
  { value: "done", label: "Klaar", color: "bg-emerald-100 text-emerald-700" },
  { value: "backlog", label: "Backlog", color: "bg-gray-100 text-gray-600" },
  { value: "expired", label: "Verlopen", color: "bg-red-100 text-red-600" },
];

const STATUS_COLOR = (status: string) =>
  STATUS_OPTIONS.find((s) => s.value === status)?.color || "bg-gray-100 text-gray-600";

interface Props {
  clientId: string;
  refreshKey?: number;
}

export function SprintPlanning({ clientId, refreshKey }: Props) {
  const [items, setItems] = useState<SprintItem[]>([]);
  const [hypotheses, setHypotheses] = useState<Map<string, HypothesisRef>>(new Map());
  const [loading, setLoading] = useState(true);
  const [fout, setFout] = useState<string | null>(null);
  const [filter, setFilter] = useState<"active" | "done" | "all">("all");
  const [channelFilter, setChannelFilter] = useState<InsightChannel | null>(null);
  const [collapsedHypotheses, setCollapsedHypotheses] = useState<Set<string>>(new Set());
  const [showAddHypothesis, setShowAddHypothesis] = useState(false);
  const [newHypothesis, setNewHypothesis] = useState("");
  const [newMetrics, setNewMetrics] = useState("");
  const [newTimeframe, setNewTimeframe] = useState("");
  const [showAddTask, setShowAddTask] = useState<string | null>(null); // hypothesis_id or "standalone"
  const [newTask, setNewTask] = useState("");
  const [newOwner, setNewOwner] = useState(OWNER_TEAM);
  const [importing, setImporting] = useState(false);
  // Eén keer voor de hele tabel, niet per rij — zie haalTeam.
  const [team, setTeam] = useState<Teamlid[]>([]);
  // ok=false betekent "niet opgehaald", niet "leeg". De kiezer zegt daardoor iets anders.
  const [teamOk, setTeamOk] = useState(true);
  useEffect(() => {
    let levend = true;
    haalTeam().then((r) => { if (levend) { setTeam(r.leden); setTeamOk(r.ok); } });
    return () => { levend = false; };
  }, []);

  const currentWeek = Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));

  const refresh = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    // try/finally om de spinner: zonder dit bleef de pagina bij élke fout onbeperkt laden, en dan
    // is niet te zien of het traag is, leeg, of stuk. Dat gebeurde ook echt — sprint_items
    // ontbrak in de demo-data, de mock viel terug op de onbereikbare echte database, en de
    // afwijzing sloeg setLoading(false) over. Een laadtoestand hoort altijd te eindigen.
    try {
    const [{ data: itemsData }, { data: hypData }] = await Promise.all([
      dbSelect<SprintItem>("sprint_items", { select: "*", clientId, order: { column: "week_number", ascending: true } }),
      dbSelect<{ id: string; hypothesis: string; status: string; ice_total: number; source: string | null }>("sprint_hypotheses", {
        select: "id, hypothesis, status, ice_total, source", clientId,
        filters: [{ op: "in", column: "status", values: ["accepted", "completed"] }],
      }),
    ]);

    const allItems = itemsData;

    // Auto-expire: items with week_number > 2 weeks ago that aren't done
    const expiredIds: string[] = [];
    for (const item of allItems) {
      if (
        item.week_number &&
        item.week_number < currentWeek - 2 &&
        !["done", "expired"].includes(item.status)
      ) {
        expiredIds.push(item.id);
        item.status = "expired";
      }
    }
    // Batch update expired items in Supabase
    if (expiredIds.length > 0) {
      await dbUpdateIn("sprint_items", clientId,
        { status: "expired", updated_at: new Date().toISOString() }, "id", expiredIds);
    }

    setItems(allItems);
    const map = new Map<string, HypothesisRef>();
    for (const h of (hypData ?? []) as HypothesisRef[]) {
      map.set(h.id, h);
    }
    setHypotheses(map);
    setFout(null);
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Sprintitems konden niet geladen worden.");
    } finally {
      setLoading(false);
    }
  }, [clientId, currentWeek]);

  useEffect(() => { refresh(); }, [refresh, refreshKey]);

  async function updateItem(id: string, field: string, value: string) {
    await updateItemFields(id, { [field]: value });
  }

  /**
   * Meerdere velden in één schrijfactie.
   *
   * De toewijzing verandert nooit één veld tegelijk: van 'persoon' naar 'functie' schakelen zet
   * `owner_soort`, wist `owner_user_id` en vult `owner_naam`. Via drie losse updateItem-aanroepen
   * zijn dat drie verzoeken en drie tussentoestanden, en de middelste daarvan — soort 'functie'
   * met nog een gebruiker eraan — breekt de aanname dat de velden bij elkaar horen. Eén schrijf
   * dus, en één keer de lokale staat bijwerken.
   */
  async function updateItemFields(id: string, velden: Record<string, string | null>) {
    if (!supabase) return;

    // EERST het scherm, DAN de database — en niet andersom.
    //
    // Hier stond `await dbUpdate(...)` vóór `setItems`. Gemeten: bij het wisselen van soort in de
    // eigenaarkiezer bleef dat verzoek na vier seconden nog onbeantwoord, dus werd setItems nooit
    // bereikt en verdween de klik zonder spoor — geen wijziging, geen melding. Wie klikt, ziet
    // dan niets gebeuren en klikt nog eens.
    //
    // Een celeditor hoort niet op een netwerkronde te wachten om je eigen keuze te tonen. De
    // wijziging gaat daarom meteen in de lijst, en pas als de schrijfactie faalt wordt hij
    // teruggedraaid — met de reden erbij, want een stille terugdraai is net zo verwarrend als
    // een stille mislukking.
    //
    // De oude velden worden in de updater zelf gelezen en niet uit `items`: die closure is bij
    // twee wijzigingen kort na elkaar al verouderd, en dan draait de terugrol de verkeerde
    // waarde terug.
    const terug: Record<string, unknown> = {};
    setItems((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      for (const sleutel of Object.keys(velden)) {
        terug[sleutel] = (item as unknown as Record<string, unknown>)[sleutel];
      }
      return { ...item, ...velden } as SprintItem;
    }));

    const { error } = await dbUpdate("sprint_items", clientId, { ...velden, updated_at: new Date().toISOString() }, { id });
    if (error) {
      setItems((prev) => prev.map((item) => item.id === id ? ({ ...item, ...terug } as SprintItem) : item));
      setFout(`De wijziging kon niet worden opgeslagen: ${error.message}`);
    }
  }

  async function addHypothesisWithTask() {
    if (!supabase || !newHypothesis.trim()) return;
    const currentWeek = Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));

    const { data: hypRows } = await dbInsert("sprint_hypotheses", clientId, {
      hypothesis: newHypothesis.trim(),
      measurement_metric: newMetrics.trim() || null,
      timeframe: newTimeframe.trim() || null,
      status: "accepted",
      accepted_at: new Date().toISOString(),
    });
    const hyp = hypRows?.[0] as { id: string } | undefined;

    if (hyp && newTask.trim()) {
      await dbInsert("sprint_items", clientId, {
        hypothesis_id: hyp.id,
        week_number: currentWeek,
        task: newTask.trim(),
        status: "todo",
        owner: newOwner,
        metrics: newMetrics.trim() || null,
        review_timeframe: newTimeframe.trim() || null,
      });
    }

    setNewHypothesis("");
    setNewMetrics("");
    setNewTimeframe("");
    setNewTask("");
    setShowAddHypothesis(false);
    await refresh();
  }

  async function addTaskToHypothesis(hypothesisId: string | null) {
    if (!supabase || !newTask.trim()) return;
    const currentWeek = Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));

    await dbInsert("sprint_items", clientId, {
      hypothesis_id: hypothesisId,
      week_number: currentWeek,
      task: newTask.trim(),
      status: "todo",
      owner: newOwner,
    });

    setNewTask("");
    setNewOwner(OWNER_TEAM);
    setShowAddTask(null);
    await refresh();
  }

  async function importCSV(file: File) {
    if (!supabase) return;
    setImporting(true);

    try {
      const text = await file.text();
      const lines = text.split("\n");
      const headers = lines[0].split(",").map((h) => h.trim());

      // Parse CSV with quote handling
      const rows: Record<string, string>[] = [];
      let currentRow: string[] = [];
      let inQuote = false;

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!inQuote) currentRow = [];

        let field = inQuote ? currentRow[currentRow.length - 1] + "\n" : "";
        for (let j = 0; j < line.length; j++) {
          const ch = line[j];
          if (ch === '"') { inQuote = !inQuote; }
          else if (ch === "," && !inQuote) { currentRow.push(field); field = ""; }
          else { field += ch; }
        }
        if (inQuote) { currentRow[currentRow.length - 1] = field; continue; }
        currentRow.push(field);

        const obj: Record<string, string> = {};
        for (let k = 0; k < headers.length; k++) obj[headers[k]] = (currentRow[k] || "").trim();
        if (obj["Taak"] || obj["taak"] || obj["Task"]) rows.push(obj);
      }

      const statusMap: Record<string, string> = {
        "Klaar": "done", "To Do": "todo", "in Planning": "in_planning",
        "On going": "ongoing", "Backlog / Verlopen": "expired", "Backlog": "backlog", "Verlopen": "expired",
      };

      // Group by hypothesis
      const groups = new Map<string, typeof rows>();
      for (const row of rows) {
        const hyp = row["Hypothese"] || row["hypothese"] || "(geen hypothese)";
        if (!groups.has(hyp)) groups.set(hyp, []);
        groups.get(hyp)!.push(row);
      }

      for (const [hypothesis, tasks] of groups) {
        const allDone = tasks.every((t) => statusMap[t["Status"]] === "done");
        const metrics = tasks[0]["Metrics"] || tasks[0]["metrics"] || null;
        const timeframe = tasks[0]["Looptijd tot Beoordeling"] || tasks[0]["looptijd"] || null;

        const { data: hypRows } = await dbInsert("sprint_hypotheses", clientId, {
          hypothesis: hypothesis === "(geen hypothese)" ? "Import: geen hypothese" : hypothesis,
          measurement_metric: metrics, timeframe,
          status: allDone ? "completed" : "accepted",
          accepted_at: new Date().toISOString(),
        });
        const hyp = hypRows?.[0] as { id: string } | undefined;

        if (!hyp) continue;

        const sprintItems = tasks.map((t) => ({
          hypothesis_id: hyp.id,
          week_number: t["Week"] || t["week"] ? parseInt(t["Week"] || t["week"]) : null,
          task: t["Taak"] || t["taak"] || t["Task"] || "(geen taak)",
          status: statusMap[t["Status"] || t["status"]] || "todo",
          // De KANT komt uit "Kant" en niet uit "Verantwoordelijke". Dat onderscheid is de reden
          // dat de rommel in deze kolom ooit is ontstaan: die kolom bevat sinds de toewijzing een
          // persoons-, functie- of bedrijfsnaam, en die als kant terugschrijven maakt van elke
          // bureaupersoon stilzwijgend een klant-taak — `normalizeOwner` kent de naam immers niet.
          //
          // Oudere bestanden hebben geen Kant-kolom; daar stond wel een rol of een bureaunaam in
          // Verantwoordelijke, en die wordt genormaliseerd. Vandaar de terugval.
          //
          // De verbijzondering zelf wordt BEWUST niet teruggelezen: uit "Sanne" valt niet af te
          // leiden of dat een persoon, een functie of een bedrijf is, en een gok zou hier een
          // verwijzing naar de verkeerde gebruiker kunnen opleveren. Een geïmporteerde taak komt
          // dus op de kant binnen en wordt daarna in de planning verbijzonderd.
          owner: normalizeOwner(t["Kant"] || t["kant"] || t["Verantwoordelijke"] || t["verantwoordelijke"] || OWNER_TEAM),
          metrics: t["Metrics"] || t["metrics"] || null,
          review_timeframe: t["Looptijd tot Beoordeling"] || t["looptijd"] || null,
        }));

        await dbInsert("sprint_items", clientId, sprintItems);
      }

      await refresh();
    } catch (err) {
      console.error("CSV import failed:", err);
    } finally {
      setImporting(false);
    }
  }

  function toggleCollapse(hypId: string) {
    setCollapsedHypotheses((prev) => {
      const next = new Set(prev);
      if (next.has(hypId)) next.delete(hypId);
      else next.add(hypId);
      return next;
    });
  }

  function exportCSV() {
    // "Kant" staat er los naast, en dat is geen dubbeling. Verantwoordelijke draagt sinds de
    // toewijzing een persoons- of functienaam, en uit "Sanne" is niet meer af te lezen of dat
    // werk bij het bureau of bij de klant ligt. Die verdeling is juist waar deze export op
    // gelezen wordt, en hij is de enige kolom die de import terugleest.
    const headers = ["Week", "Taak", "Kanaal", "Status", "Kant", "Verantwoordelijke", "Hypothese", "Looptijd tot Beoordeling", "Metrics"];
    const rows = filteredItems.map((item) => {
      const hyp = item.hypothesis_id ? hypotheses.get(item.hypothesis_id) : null;
      const statusLabel = STATUS_OPTIONS.find((s) => s.value === item.status)?.label || item.status;
      const ch = channelOfItem(item);
      return [
        item.week_number || "",
        `"${(item.task || "").replace(/"/g, '""')}"`,
        ch ? CHANNEL_LABEL[ch] : "",
        statusLabel,
        ownerLabel(item.owner),
        `"${toewijzingLabel(
          { kant: item.owner, soort: normalizeSoort(item.owner_soort), naam: item.owner_naam, userId: item.owner_user_id },
          { personen: new Map(team.map((l) => [l.id, l.naam])) },
        ).replace(/"/g, '""')}"`,
        `"${(hyp?.hypothesis || "").replace(/"/g, '""')}"`,
        item.review_timeframe || "",
        item.metrics || "",
      ].join(",");
    });

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sprintplanning-${clientId}-${today()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Kanaal per taak: via de bron van zijn hypothese; losse taken hebben geen kanaal (—).
  const channelOfItem = (item: SprintItem): InsightChannel | null => {
    if (!item.hypothesis_id) return null;
    const hyp = hypotheses.get(item.hypothesis_id);
    return hyp ? channelOfSource(hyp.source) : null;
  };

  const filteredItems = items.filter((item) => {
    if (filter === "active" && ["done", "expired"].includes(item.status)) return false;
    if (filter === "done" && item.status !== "done") return false;
    if (channelFilter && channelOfItem(item) !== channelFilter) return false;
    return true;
  });

  // Aantallen per kanaal (binnen het status-filter), voor de chips.
  const channelCounts: Partial<Record<InsightChannel, number>> = {};
  for (const item of items) {
    if (filter === "active" && ["done", "expired"].includes(item.status)) continue;
    if (filter === "done" && item.status !== "done") continue;
    const ch = channelOfItem(item);
    if (ch) channelCounts[ch] = (channelCounts[ch] ?? 0) + 1;
  }

  // Group by hypothesis
  const grouped = new Map<string, SprintItem[]>();
  const noHypothesis: SprintItem[] = [];

  for (const item of filteredItems) {
    if (item.hypothesis_id) {
      if (!grouped.has(item.hypothesis_id)) grouped.set(item.hypothesis_id, []);
      grouped.get(item.hypothesis_id)!.push(item);
    } else {
      noHypothesis.push(item);
    }
  }

  if (fout) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">
        {fout}
      </div>
    );
  }
  if (loading) {
    return (
      <div className="bg-card rounded-xl border border-border p-8 shadow-sm flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-rm-blue-ink" />
      </div>
    );
  }

  if (items.length === 0 && !showAddHypothesis && !showAddTask) {
    return (
      <div className="bg-card rounded-xl border border-border p-8 shadow-sm text-center">
        <Calendar className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
        <p className="text-body text-muted-foreground mb-3">Nog geen sprintplanning.</p>
        <button
          onClick={() => setShowAddHypothesis(true)}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-rm-blue text-white hover:bg-rm-blue/90 transition-colors"
        >
          <Plus className="w-3 h-3 inline mr-1" /> Hypothese + taak toevoegen
        </button>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-rm-blue-ink uppercase tracking-wide">Sprintplanning</h3>
          <p className="text-micro text-muted-foreground mt-0.5">
            {filteredItems.length} taken · Week {currentWeek} ({new Date().toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" })})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 bg-gray-100 rounded-md p-0.5">
            {(["active", "done", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 text-micro font-medium rounded-md transition-colors ${
                  filter === f ? "bg-card text-rm-blue-ink shadow-sm" : "text-muted-foreground"
                }`}
              >
                {f === "active" ? "Actief" : f === "done" ? "Klaar" : "Alles"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 px-3 py-1.5 text-micro font-medium rounded-md border border-emerald-300 text-emerald-700 hover:bg-emerald-50 transition-colors cursor-pointer">
            {importing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
            {importing ? "Importeren..." : "CSV Import"}
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) importCSV(e.target.files[0]); e.target.value = ""; }}
            />
          </label>
          <button
            onClick={() => setShowAddHypothesis(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-micro font-medium rounded-md bg-rm-blue text-white hover:bg-rm-blue/90 transition-colors"
          >
            <Plus className="w-3 h-3" /> Hypothese + taak
          </button>
          <button
            onClick={() => setShowAddTask("standalone")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-micro font-medium rounded-md border border-rm-blue/30 text-rm-blue-ink hover:bg-rm-blue/5 transition-colors"
          >
            <Plus className="w-3 h-3" /> Losse taak
          </button>
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 text-micro font-medium rounded-md border border-border hover:bg-gray-50 transition-colors"
          >
            <Download className="w-3 h-3" /> CSV Export
          </button>
        </div>
      </div>

      {/* Kanaal-filter: snel zien wat er per kanaal op de lijst staat. */}
      <div className="px-5 py-2.5 border-b border-border bg-gray-50/40">
        <ChannelFilter value={channelFilter} onChange={setChannelFilter} counts={channelCounts} />
      </div>

      {/* Add hypothesis form */}
      {showAddHypothesis && (
        <div className="px-5 py-4 border-b border-border bg-purple-50/30 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-purple-700">Nieuwe hypothese + taak toevoegen</p>
            <button onClick={() => setShowAddHypothesis(false)} className="p-1 hover:bg-purple-100 rounded"><X className="w-3.5 h-3.5 text-purple-400" /></button>
          </div>
          <textarea
            value={newHypothesis}
            onChange={(e) => setNewHypothesis(e.target.value)}
            placeholder="Hypothese: Met het [actie] verwachten we [verwachting]..."
            className="w-full text-sm border border-purple-200 rounded-lg px-3 py-2 bg-card focus:outline-none focus:border-purple-400 resize-none"
            rows={2}
          />
          <input
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            placeholder="Eerste taak (optioneel)"
            className="w-full text-sm border border-purple-200 rounded-lg px-3 py-2 bg-card focus:outline-none focus:border-purple-400"
          />
          <div className="flex gap-3">
            <input value={newMetrics} onChange={(e) => setNewMetrics(e.target.value)} placeholder="Metrics (bijv. ROAS, CR)" className="flex-1 text-xs border border-purple-200 rounded-lg px-3 py-1.5 bg-card focus:outline-none focus:border-purple-400" />
            <input value={newTimeframe} onChange={(e) => setNewTimeframe(e.target.value)} placeholder="Looptijd (bijv. 3 maanden)" className="flex-1 text-xs border border-purple-200 rounded-lg px-3 py-1.5 bg-card focus:outline-none focus:border-purple-400" />
            <select value={newOwner} onChange={(e) => setNewOwner(e.target.value)} className="text-xs border border-purple-200 rounded-lg px-3 py-1.5 bg-card">
              <option value={OWNER_TEAM}>{ownerLabel(OWNER_TEAM)}</option>
              <option value={OWNER_CLIENT}>{ownerLabel(OWNER_CLIENT)}</option>
            </select>
          </div>
          <button onClick={addHypothesisWithTask} disabled={!newHypothesis.trim()} className="px-4 py-1.5 text-xs font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40 transition-colors">
            Toevoegen
          </button>
        </div>
      )}

      {/* Add standalone task form */}
      {showAddTask === "standalone" && (
        <div className="px-5 py-4 border-b border-border bg-blue-50/30 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-rm-blue-ink">Losse taak toevoegen (zonder hypothese)</p>
            <button onClick={() => setShowAddTask(null)} className="p-1 hover:bg-blue-100 rounded"><X className="w-3.5 h-3.5 text-blue-400" /></button>
          </div>
          <div className="flex gap-3">
            <input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Taakomschrijving" className="flex-1 text-sm border border-blue-200 rounded-lg px-3 py-2 bg-card focus:outline-none focus:border-rm-blue" />
            <select value={newOwner} onChange={(e) => setNewOwner(e.target.value)} className="text-xs border border-blue-200 rounded-lg px-3 py-1.5 bg-card">
              <option value={OWNER_TEAM}>{ownerLabel(OWNER_TEAM)}</option>
              <option value={OWNER_CLIENT}>{ownerLabel(OWNER_CLIENT)}</option>
            </select>
            <button onClick={() => addTaskToHypothesis(null)} disabled={!newTask.trim()} className="px-4 py-1.5 text-xs font-medium rounded-lg bg-rm-blue text-white hover:bg-rm-blue/90 disabled:opacity-40 transition-colors">
              Toevoegen
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50/50 border-b border-border">
            <tr>
              <th className="px-3 py-2.5 text-micro font-semibold text-muted-foreground uppercase tracking-wider text-left w-16">Week</th>
              <th className="px-3 py-2.5 text-micro font-semibold text-muted-foreground uppercase tracking-wider text-left">Taak</th>
              <th className="px-3 py-2.5 text-micro font-semibold text-muted-foreground uppercase tracking-wider text-left w-24">Kanaal</th>
              <th className="px-3 py-2.5 text-micro font-semibold text-muted-foreground uppercase tracking-wider text-left w-28">Status</th>
              <th className="px-3 py-2.5 text-micro font-semibold text-muted-foreground uppercase tracking-wider text-left w-36">Verantwoordelijke</th>
              <th className="px-3 py-2.5 text-micro font-semibold text-muted-foreground uppercase tracking-wider text-left w-24">Looptijd</th>
              <th className="px-3 py-2.5 text-micro font-semibold text-muted-foreground uppercase tracking-wider text-left w-32">Metrics</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {/* Grouped by hypothesis */}
            {Array.from(grouped.entries()).map(([hypId, groupItems]) => {
              const hyp = hypotheses.get(hypId);
              const isCollapsed = collapsedHypotheses.has(hypId);

              return (
                <Fragment key={`group-${hypId}`}>
                  {/* Hypothesis header row */}
                  <tr
                    key={`hyp-${hypId}`}
                    className="bg-purple-50/40 cursor-pointer hover:bg-purple-50/60"
                    onClick={() => toggleCollapse(hypId)}
                  >
                    {/*
                      Dit was één cel met colSpan={7} en een flexrij erin. Daardoor zweefde de
                      kanaalbadge direct achter de hypothesetekst, en die tekst is per rij een
                      andere lengte — de badge landde zo op vier verschillende posities, terwijl
                      de badges van de taken eronder allemaal in de kanaalkolom staan. Een
                      overspannende cel kan zich per definitie niet aan het kolomraster houden.

                      Nu draagt de rij echte cellen: tekst over Week+Taak, de badge in Kanaal, en
                      de groepsgegevens over de rest. De band ziet er hetzelfde uit, maar alles
                      staat in de kolom waar het bij hoort.
                    */}
                    <td colSpan={2} className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {isCollapsed
                          ? <ChevronDown className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                          : <ChevronUp className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                        }
                        <span className="text-meta font-medium text-purple-700">
                          {hyp?.hypothesis || "Hypothese"}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <ChannelBadge channel={hyp ? channelOfSource(hyp.source) : null} className={OP_KOP_BADGE} />
                    </td>
                    <td colSpan={4} className="px-3 py-2">
                      <span className="flex items-center justify-end gap-2 text-micro text-purple-400">
                        {groupItems.length} taken · ICE {hyp?.ice_total?.toFixed(1) || "?"}
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowAddTask(hypId); setNewTask(""); setNewOwner(OWNER_TEAM); }}
                          className="p-0.5 rounded hover:bg-purple-200 transition-colors"
                          title="Taak toevoegen"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </span>
                    </td>
                  </tr>

                  {/* Task rows */}
                  {!isCollapsed && groupItems.map((item) => (
                    <SprintRow key={item.id} item={item} onUpdate={updateItem} onUpdateFields={updateItemFields} team={team} teamOk={teamOk} currentWeek={currentWeek} channel={channelOfItem(item)} />
                  ))}
                  {!isCollapsed && showAddTask === hypId && (
                    <tr className="bg-purple-50/20">
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2" colSpan={4}>
                        <div className="flex items-center gap-2">
                          <input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Nieuwe taak..." className="flex-1 text-xs border border-purple-200 rounded px-2 py-1 bg-card focus:outline-none focus:border-purple-400" />
                          <select value={newOwner} onChange={(e) => setNewOwner(e.target.value)} className="text-xs border border-purple-200 rounded px-2 py-1 bg-card">
                            <option value={OWNER_TEAM}>{ownerLabel(OWNER_TEAM)}</option>
                            <option value={OWNER_CLIENT}>{ownerLabel(OWNER_CLIENT)}</option>
                          </select>
                          <button onClick={() => addTaskToHypothesis(hypId)} disabled={!newTask.trim()} className="px-2 py-1 text-micro font-medium rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40">Voeg toe</button>
                          <button onClick={() => setShowAddTask(null)} className="p-1 hover:bg-purple-100 rounded"><X className="w-3 h-3 text-purple-400" /></button>
                        </div>
                      </td>
                      <td colSpan={2} />
                    </tr>
                  )}
                </Fragment>
              );
            })}

            {/* Items without hypothesis */}
            {noHypothesis.map((item) => (
              <SprintRow key={item.id} item={item} onUpdate={updateItem} onUpdateFields={updateItemFields} team={team} teamOk={teamOk} currentWeek={currentWeek} channel={channelOfItem(item)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Elke cel met een bedieningselement stond op een andere inspringing dan zijn kolomkop.
//
// De cel geeft `px-4`, en daar bovenop draagt het element zijn eigen opvulling: de pil `px-2.5`,
// de badge `px-1.5` plus een rand, de keuzelijst `px-1` plus een rand, en het weekveld stond
// bovendien gecentreerd in een vak van 48px. Gemeten afwijking ten opzichte van de kop, per
// kolom: 17, 0, 7, 10, 5, 0, 0 — vijf verschillende waarden over zeven kolommen. De koprij is
// een liniaal, en het lichaam hield zich er niet aan.
//
// Vier van de zeven kolommen lijnen hun tékst uit op de kop, dus dat is hier de maat: het
// element wordt met een negatieve marge exact zijn eigen inspringing naar links getrokken,
// zodat de letters op de kop staan en de pil zijn vorm houdt. De marge blijft binnen de 16px
// celopvulling, dus niets raakt de buurkolom.
const OP_KOP_PIL = "-ml-[10px]";   // px-2.5, geen rand
const OP_KOP_BADGE = "-ml-[7px]";  // px-1.5 + 1px rand
const OP_KOP_VELD = "-ml-[5px]";   // px-1 + 1px rand

function SprintRow({ item, onUpdate, onUpdateFields, team, teamOk, currentWeek, channel }: { item: SprintItem; onUpdate: (id: string, field: string, value: string) => void; onUpdateFields: (id: string, velden: Record<string, string | null>) => void; team: readonly Teamlid[]; teamOk: boolean; currentWeek: number; channel: InsightChannel | null }) {
  const isOverdue = item.week_number != null && item.week_number < currentWeek && !["done", "expired"].includes(item.status);
  const isCurrent = item.week_number != null && item.week_number === currentWeek;

  return (
    <tr className={`hover:bg-gray-50/50 transition-colors ${isOverdue ? "bg-red-50/30" : ""} ${item.status === "expired" ? "opacity-50" : ""}`}>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={item.week_number || ""}
            onChange={(e) => onUpdate(item.id, "week_number", e.target.value)}
            className={`w-12 text-xs text-left border rounded px-1 py-0.5 ${OP_KOP_VELD} focus:bg-card focus:border-rm-blue focus:outline-none ${
              isOverdue ? "border-red-300 bg-red-50 text-red-600 font-bold" :
              isCurrent ? "border-emerald-300 bg-emerald-50 text-emerald-600 font-bold" :
              "border-transparent hover:border-border bg-transparent"
            }`}
            placeholder="—"
          />
          {isOverdue && <span className="text-micro text-red-500 font-bold">!</span>}
        </div>
      </td>
      <td className="px-3 py-2 text-sm text-rm-gray">{item.task}</td>
      <td className="px-3 py-2"><ChannelBadge channel={channel} className={OP_KOP_BADGE} /></td>
      <td className="px-3 py-2">
        <select
          value={item.status}
          onChange={(e) => onUpdate(item.id, "status", e.target.value)}
          className={`text-micro font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer ${OP_KOP_PIL} ${STATUS_COLOR(item.status)}`}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        {/*
          Was een <select> met twee opties. Wat er in de database staat is van alles: de merknaam
          van twee rebrandings geleden, klantnamen, en in vier rijen een hele hypothese die bij een
          import in het verkeerde veld belandde. Geen van die waarden kwam met een <option>
          overeen, dus de lijst stond bij 45 van de 49 rijen leeg.

          De kiezer leest die ruwe waarde nog steeds als KANT — daar verandert niets aan — en zet
          de verbijzondering ernaast. Zie migratie 033 en het toewijzingsmodel in brand.ts.
        */}
        <EigenaarKiezer
          waarde={{ kant: item.owner, soort: normalizeSoort(item.owner_soort), naam: item.owner_naam, userId: item.owner_user_id }}
          team={team}
          teamOk={teamOk}
          onChange={(t) => onUpdateFields(item.id, {
            owner: t.kant ?? OWNER_TEAM,
            owner_soort: t.soort,
            owner_naam: t.naam,
            owner_user_id: t.userId,
          })}
          className={OP_KOP_VELD}
        />
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{item.review_timeframe || "—"}</td>
      {/* Vertaald, niet ruw: hier stond `one_click_leads` in beeld. Zie metriekLabel. */}
      <td className="px-3 py-2 text-xs text-muted-foreground">{metriekLabel(item.metrics) || "—"}</td>
    </tr>
  );
}
