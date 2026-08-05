"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Plus, FileCode2, AlertCircle } from "lucide-react";
import { supabase, type Script } from "@/lib/supabase";
import { dbDelete } from "@/lib/data-access/client-write";
import { ScriptCard } from "./script-card";
import { ScriptEditor } from "./script-editor";

export function ScriptLibrary() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [editing, setEditing] = useState<Script | null | "new">(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchScripts = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    // Zie client-notes: een laadtoestand zonder finally eindigt bij een fout nooit.
    try {
      const { data } = await supabase
        .from("scripts")
        .select("*")
        .order("updated_at", { ascending: false });
      setScripts(data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchScripts(); }, [fetchScripts]);

  // Unique tags across all scripts
  const allTags = [...new Set(scripts.flatMap((s) => s.tags))].sort();

  // Filter
  const filtered = scripts.filter((s) => {
    const matchesSearch = !search ||
      s.title.toLowerCase().includes(search.toLowerCase()) ||
      (s.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
      s.tags.some((t) => t.includes(search.toLowerCase()));
    const matchesTag = !activeTag || s.tags.includes(activeTag);
    return matchesSearch && matchesTag;
  });

  async function handleDelete(id: string) {
    if (!supabase) return;
    await dbDelete("scripts", null, { id });
    setDeleteConfirm(null);
    fetchScripts();
  }

  if (!supabase) {
    return (
      <div className="bg-card rounded-xl border border-border p-8 shadow-sm text-center">
        <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
        <p className="text-sm text-rm-gray font-medium mb-1">Supabase niet geconfigureerd</p>
        <p className="text-meta text-muted-foreground">
          Voeg NEXT_PUBLIC_SUPABASE_URL en NEXT_PUBLIC_SUPABASE_ANON_KEY toe aan .env.local
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          {/* Dit was een <h2> op text-lg terwijl elke andere pagina zijn titel in een <h1> zet.
              Voor een schermlezer begon deze pagina daarmee zonder kop. */}
          <h1 className="text-page font-bold text-rm-blue-ink">Scriptbibliotheek</h1>
          <p className="mt-1 text-body text-muted-foreground">
            Bewaar en organiseer je Google Ads scripts
          </p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-rm-blue text-white hover:bg-rm-blue/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Nieuw script
        </button>
      </div>

      {/* Search + tag filter */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek op titel, beschrijving of tag..."
            className="w-full text-sm border border-border rounded-lg pl-9 pr-3 py-2.5 focus:outline-none focus:border-rm-blue"
          />
        </div>

        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveTag(null)}
              className={`text-micro font-medium px-2.5 py-1 rounded-full transition-colors ${
                !activeTag
                  ? "bg-rm-blue text-white"
                  : "bg-gray-100 text-muted-foreground hover:bg-gray-200"
              }`}
            >
              Alles
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className={`text-micro font-medium px-2.5 py-1 rounded-full transition-colors ${
                  activeTag === tag
                    ? "bg-rm-blue text-white"
                    : "bg-gray-100 text-muted-foreground hover:bg-gray-200"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Editor */}
      {editing !== null && (
        <ScriptEditor
          script={editing === "new" ? null : editing}
          onSaved={() => { setEditing(null); fetchScripts(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
          <p className="text-sm text-red-700">Weet je zeker dat je dit script wilt verwijderen?</p>
          <div className="flex gap-2">
            <button
              onClick={() => setDeleteConfirm(null)}
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-rm-gray"
            >
              Annuleren
            </button>
            <button
              onClick={() => handleDelete(deleteConfirm)}
              className="px-3 py-1.5 text-xs bg-red-500 text-white rounded-md hover:bg-red-600"
            >
              Verwijderen
            </button>
          </div>
        </div>
      )}

      {/* Script list */}
      {loading ? (
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">Scripts laden...</p>
        </div>
      ) : filtered.length === 0 ? (
        // ── EEN LEEG SCHERM MAG UITLEGGEN WAAR HET VOOR IS ──────────────────────
        //
        // Hier stond een grijs icoon en vier woorden, in het midden van achthonderd pixels niets.
        // Dat is de stand van deze pagina in een verse installatie én in de demo, dus het is het
        // enige wat de meeste mensen hier ooit zien. Wie niet weet wat een Google Ads-script is,
        // leert het hier niet, en wie het wel weet, weet niet waarom hij het hiér zou bewaren.
        //
        // Nu een kaart met dezelfde rand en achtergrond als de rest van de app, en drie voorbeelden
        // van wat er in hoort. Geen verzonnen scripts in de lijst: dan zou de teller liegen.
        <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
          {scripts.length === 0 ? (
            <div className="mx-auto max-w-xl text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rm-blue/10">
                <FileCode2 className="h-6 w-6 text-rm-blue-ink" />
              </div>
              <p className="text-title font-semibold text-rm-gray">Nog geen scripts opgeslagen</p>
              <p className="mt-1.5 text-body text-muted-foreground">
                Bewaar hier de Google Ads-scripts die je bij meerdere accounts gebruikt, met een
                beschrijving en tags erbij, zodat een collega ze terugvindt zonder te vragen.
              </p>
              <ul className="mx-auto mt-5 grid gap-2 text-left sm:grid-cols-3">
                {[
                  ["Budgetbewaking", "meldt een campagne die zijn maandbudget te snel opmaakt"],
                  ["N-gram-rapport", "haalt terugkerende woorden uit de zoektermen"],
                  ["Linkchecker", "loopt de bestemmings-URL's na op 404's"],
                ].map(([titel, wat]) => (
                  <li key={titel} className="rounded-lg border border-border bg-gray-50/70 px-3 py-2.5">
                    <span className="block text-body font-medium text-rm-gray">{titel}</span>
                    <span className="mt-0.5 block text-meta leading-snug text-muted-foreground">{wat}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => setEditing("new")}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-rm-blue px-4 py-2 text-body font-medium text-white transition-colors hover:bg-rm-blue/90"
              >
                <Plus className="h-3.5 w-3.5" /> Eerste script toevoegen
              </button>
            </div>
          ) : (
            <p className="py-4 text-center text-body text-muted-foreground">
              Geen scripts gevonden voor deze zoekopdracht.
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((script) => (
            <ScriptCard
              key={script.id}
              script={script}
              onEdit={(s) => setEditing(s)}
              onDelete={(id) => setDeleteConfirm(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
