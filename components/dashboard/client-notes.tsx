"use client";

import { useState, useEffect, useCallback } from "react";
import { StickyNote, ListChecks, Plus, Pencil, Trash2, Save } from "lucide-react";
import { supabase, type ClientNote } from "@/lib/supabase";
import { dbDelete, dbInsert, dbUpdate } from "@/lib/data-access/client-write";
import { dbSelect } from "@/lib/data-access/client-read";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "zojuist";
  if (mins < 60) return `${mins}min geleden`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}u geleden`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "gisteren";
  if (days < 30) return `${days}d geleden`;
  return new Date(dateStr).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

const MAX_LINES = 4;

function NoteCard({
  note,
  isEditing,
  onEdit,
  onDelete,
  onToggleDone,
}: {
  note: ClientNote;
  isEditing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  /** Alleen aanwezig voor to-do's (note.is_todo). */
  onToggleDone?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = note.content.split("\n");
  const isLong = lines.length > MAX_LINES || note.content.length > 200;
  const displayContent = !expanded && isLong
    ? lines.slice(0, MAX_LINES).join("\n") + (lines.length > MAX_LINES ? "..." : "")
    : note.content;

  return (
    <div
      className={`group relative rounded-lg transition-all ${
        isEditing
          ? "border border-brand-blue/20 bg-brand-blue/5"
          : "border border-border/50 hover:border-gray-300 bg-card"
      }`}
    >
      <div className="flex items-start gap-3 p-3.5">
        {/* Voor een to-do: het afvinkvakje zelf. Voor een vrije notitie: dezelfde accent-stip
            als voorheen, puur decoratief. */}
        {note.is_todo ? (
          <button
            onClick={onToggleDone}
            aria-label={note.done ? "Markeer als niet afgerond" : "Markeer als afgerond"}
            className={`mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors ${
              note.done ? "bg-brand-blue border-brand-blue" : "border-border hover:border-brand-blue"
            }`}
          >
            {note.done && <ListChecks className="w-3 h-3 text-white" strokeWidth={3} />}
          </button>
        ) : (
          <div className="w-1.5 h-1.5 rounded-full bg-brand-blue/40 mt-1.5 shrink-0" />
        )}

        <div className="min-w-0 flex-1">
          {/* Titel + tijd op een eigen regel -- maar alleen als er een titel is. Zonder titel stond
              hier altijd toch een regel (alleen de tijd, rechts uitgelijnd), en de checkbox lijnt uit
              op de EERSTE regel van dit blok (zie mt-0.5 hierboven). Bij een to-do zonder titel ("test
              1") betekende dat: checkbox tegen die lege titelregel, de eigenlijke tekst een hele regel
              lager -- de checkbox stond dus zichtbaar los van waar hij bij hoorde. Nu is de eerste
              regel altijd de regel waar ook echt iets op staat. */}
          {note.title && (
            <div className="flex items-baseline gap-2 mb-1">
              <span className={`text-xs font-semibold ${note.done ? "text-muted-foreground line-through" : "text-brand-gray"}`}>{note.title}</span>
              <span className="text-micro text-muted-foreground ml-auto shrink-0">{timeAgo(note.created_at)}</span>
            </div>
          )}

          {/* Content */}
          <div className="flex items-baseline gap-2">
            <p className={`text-meta whitespace-pre-wrap leading-relaxed flex-1 ${note.done ? "text-muted-foreground line-through" : "text-brand-gray/80"}`}>{displayContent}</p>
            {!note.title && <span className="text-micro text-muted-foreground shrink-0">{timeAgo(note.created_at)}</span>}
          </div>

          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-micro text-brand-blue-ink hover:underline mt-1"
            >
              {expanded ? "Minder tonen" : "Meer tonen"}
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={onEdit} className="p-1 rounded hover:bg-gray-100" title="Bewerken">
            <Pencil className="w-3 h-3 text-muted-foreground" />
          </button>
          <button onClick={onDelete} className="p-1 rounded hover:bg-red-50" title="Verwijderen">
            <Trash2 className="w-3 h-3 text-red-400" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Waarom twee losse kaarten en niet één kaart met een interne 50/50-grid ─────────────────────
//
// Stond eerder als één kaart met gedeelde "Notitie"/"To-do"-knoppen bovenaan die allebei hetzelfde
// formulier openden (alleen het type-toggle verschilde). Feedback: "ik wil 2 losse secties die
// allebei 50/50 zijn en elk blok zijn eigen toevoegoptie" — dus geen gedeeld formulier met een
// keuzeknop, maar twee zelfstandige kaarten die er ook zo uitzien. De onderliggende data (fetch,
// opslaan, verwijderen) blijft gedeeld: één tabel, één client_id-scope, dus de twee kaarten zijn
// altijd gesynchroniseerd met elkaar en met elke andere plek die dezelfde klant leest (o.a.
// lib/feed/use-today-feed.ts's open-to-do-teller).
export function ClientNotes({ clientId }: { clientId: string }) {
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Welke kaart een open toevoeg-formulier toont -- null als geen van beide.
  const [newOpen, setNewOpen] = useState<null | "note" | "todo">(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchNotes = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    // try/finally om de laadtoestand: zonder dit blijft de spinner bij een afwijzing voor altijd
    // staan, en dan is niet te zien of het traag is, leeg, of stuk. Ditzelfde patroon liet de
    // sprintpagina oneindig laden.
    try {
      const { data } = await dbSelect<ClientNote>("client_notes", {
        select: "*", clientId, order: { column: "created_at", ascending: false },
      });
      setNotes(data);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  const editingNote = editingId ? notes.find((n) => n.id === editingId) ?? null : null;
  const noteToDelete = deleteConfirm ? notes.find((n) => n.id === deleteConfirm) ?? null : null;

  function startEdit(note: ClientNote) {
    setEditingId(note.id);
    setTitle(note.title ?? "");
    setContent(note.content);
    setNewOpen(null);
  }

  function startNew(section: "note" | "todo") {
    setNewOpen(section);
    setEditingId(null);
    setTitle("");
    setContent("");
  }

  function cancelEdit() {
    setNewOpen(null);
    setEditingId(null);
    setTitle("");
    setContent("");
  }

  async function handleSave(isTodo: boolean) {
    if (!supabase || !content.trim()) return;
    setSaving(true);

    if (editingId) {
      await dbUpdate("client_notes", clientId, {
        title: title.trim() || null,
        content: content.trim(),
        updated_at: new Date().toISOString(),
      }, { id: editingId });
    } else {
      // client_id gaat niet meer mee in de rij: de server vult hem in vanuit de scope.
      await dbInsert("client_notes", clientId, {
        title: title.trim() || null,
        content: content.trim(),
        is_todo: isTodo,
        done: false,
      });
    }

    setSaving(false);
    cancelEdit();
    fetchNotes();
  }

  async function handleToggleDone(note: ClientNote) {
    if (!supabase) return;
    // Optimistisch: de lijst voelt anders traag aan voor iets dat zo vaak wordt aangeklikt.
    setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, done: !n.done } : n)));
    await dbUpdate("client_notes", clientId, { done: !note.done }, { id: note.id });
  }

  async function handleDelete(id: string) {
    if (!supabase) return;
    await dbDelete("client_notes", clientId, { id });
    setDeleteConfirm(null);
    fetchNotes();
  }

  if (!supabase) return null;

  const vrijeNotities = notes.filter((n) => !n.is_todo);
  const todos = notes.filter((n) => n.is_todo);
  const openTodos = todos.filter((n) => !n.done);
  const gedaneTodos = todos.filter((n) => n.done);

  const todoFormOpen = newOpen === "todo" || (editingNote?.is_todo === true);
  const noteFormOpen = newOpen === "note" || (editingNote?.is_todo === false);

  function renderForm(isTodo: boolean, onSave: () => void) {
    return (
      <div className="mb-3 bg-brand-blue/5 rounded-lg p-3.5 border border-brand-blue/10">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Titel (optioneel)"
          className="w-full text-sm font-medium border-0 bg-transparent focus:outline-none placeholder:text-muted-foreground mb-2"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={isTodo ? "Wat moet er gebeuren..." : "Notitie schrijven... (afspraken, strategie, gedachtes)"}
          rows={3}
          className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-blue resize-y"
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-2">
          <button onClick={cancelEdit} className="px-3 py-1.5 text-meta text-muted-foreground hover:text-brand-gray">
            Annuleren
          </button>
          <button
            onClick={onSave}
            disabled={saving || !content.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-meta font-medium rounded-md bg-brand-blue text-white hover:bg-brand-blue/90 disabled:opacity-50"
          >
            <Save className="w-3 h-3" /> {saving ? "Opslaan..." : "Opslaan"}
          </button>
        </div>
      </div>
    );
  }

  function renderDeleteConfirm() {
    if (!deleteConfirm) return null;
    return (
      <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between">
        <p className="text-meta text-red-700">Verwijderen?</p>
        <div className="flex gap-2">
          <button onClick={() => setDeleteConfirm(null)} className="text-meta text-muted-foreground">Annuleren</button>
          <button onClick={() => handleDelete(deleteConfirm)} className="text-meta text-red-600 font-medium">Verwijder</button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {/* Sectie 1: to-do's -- eigen kaart, eigen toevoegknop. */}
      <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-brand-blue-ink" />
            <h3 className="text-sm font-semibold text-brand-blue-ink uppercase tracking-wide">To-do&apos;s</h3>
            {openTodos.length > 0 && (
              <span className="text-micro font-semibold text-brand-blue-ink bg-brand-blue/10 rounded-full px-2 py-0.5">
                {openTodos.length} open
              </span>
            )}
          </div>
          {!todoFormOpen && (
            <button
              onClick={() => startNew("todo")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-meta font-medium rounded-lg bg-brand-blue/10 text-brand-blue-ink hover:bg-brand-blue/20 transition-colors"
            >
              <Plus className="w-3 h-3" /> To-do
            </button>
          )}
        </div>

        {todoFormOpen && renderForm(true, () => handleSave(true))}
        {noteToDelete?.is_todo === true && renderDeleteConfirm()}

        {loading ? (
          <p className="text-meta text-muted-foreground py-4 text-center">Laden...</p>
        ) : (
          <div className="space-y-2 max-h-[480px] overflow-y-auto">
            {todos.length === 0 ? (
              <p className="text-micro text-muted-foreground/60 py-2">Nog geen to-do&apos;s.</p>
            ) : (
              // Open boven gedaan, zodat afvinken een taak niet meteen laat verdwijnen uit het zicht.
              [...openTodos, ...gedaneTodos].map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  isEditing={editingId === note.id}
                  onEdit={() => startEdit(note)}
                  onDelete={() => setDeleteConfirm(note.id)}
                  onToggleDone={() => handleToggleDone(note)}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* Sectie 2: vrije notities -- eigen kaart, eigen toevoegknop. */}
      <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <StickyNote className="w-4 h-4 text-brand-blue-ink" />
            <h3 className="text-sm font-semibold text-brand-blue-ink uppercase tracking-wide">Notities</h3>
            <span className="text-micro text-muted-foreground">({vrijeNotities.length})</span>
          </div>
          {!noteFormOpen && (
            <button
              onClick={() => startNew("note")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-meta font-medium rounded-lg bg-brand-blue/10 text-brand-blue-ink hover:bg-brand-blue/20 transition-colors"
            >
              <Plus className="w-3 h-3" /> Notitie
            </button>
          )}
        </div>

        {noteFormOpen && renderForm(false, () => handleSave(false))}
        {noteToDelete?.is_todo === false && renderDeleteConfirm()}

        {loading ? (
          <p className="text-meta text-muted-foreground py-4 text-center">Laden...</p>
        ) : (
          <div className="space-y-2 max-h-[480px] overflow-y-auto">
            {vrijeNotities.length === 0 ? (
              <p className="text-micro text-muted-foreground/60 py-2">Nog geen notities.</p>
            ) : (
              vrijeNotities.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  isEditing={editingId === note.id}
                  onEdit={() => startEdit(note)}
                  onDelete={() => setDeleteConfirm(note.id)}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
