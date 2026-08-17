"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  FolderPlus, Upload, Trash2, Download, FileText, FileSpreadsheet,
  Image as ImageIcon, File, FolderOpen, Plus, X, Loader2, AlertCircle, CheckCircle2, Eye,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { dbDelete, dbInsert } from "@/lib/data-access/client-write";
import { dbSelect } from "@/lib/data-access/client-read";
import { importSprintCsv, type SprintCsvImportSummary } from "@/lib/learning/sprint-csv-import";
import { MarkdownFileViewer } from "./markdown-file-viewer";
import type { SopError } from "../insights/sop-trigger-buttons";

function isMarkdownFile(file: { content_type: string | null; file_name: string }): boolean {
  return file.content_type === "text/markdown" || file.file_name.toLowerCase().endsWith(".md");
}

interface ClientFolder {
  id: string;
  client_id: string;
  name: string;
  created_at: string;
}

interface ClientFile {
  id: string;
  client_id: string;
  folder: string;
  file_name: string;
  file_size: number;
  content_type: string | null;
  storage_path: string;
  uploaded_at: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "vandaag";
  if (days === 1) return "gisteren";
  if (days < 30) return `${days}d geleden`;
  return new Date(dateStr).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

function FileIcon({ contentType, fileName }: { contentType: string | null; fileName: string }) {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (contentType?.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext ?? ""))
    return <ImageIcon className="w-4 h-4 text-purple-500" />;
  if (["pdf"].includes(ext ?? ""))
    return <FileText className="w-4 h-4 text-red-500" />;
  if (["xls", "xlsx", "csv"].includes(ext ?? ""))
    return <FileSpreadsheet className="w-4 h-4 text-green-600" />;
  if (["doc", "docx"].includes(ext ?? ""))
    return <FileText className="w-4 h-4 text-brand-blue-ink" />;
  return <File className="w-4 h-4 text-muted-foreground" />;
}

// Default folders for new clients
const DEFAULT_FOLDERS = ["SOP's", "Briefings", "Sprintplanning", "Rapportages", "Overig"];

export function ClientFiles({ clientId, sopErrors, onDismissError, onDismissAllErrors }: {
  clientId: string;
  sopErrors?: SopError[];
  onDismissError?: (id: string) => void;
  onDismissAllErrors?: () => void;
}) {
  const [folders, setFolders] = useState<ClientFolder[]>([]);
  const [files, setFiles] = useState<ClientFile[]>([]);
  const [activeFolder, setActiveFolder] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sprintImportSummary, setSprintImportSummary] = useState<SprintCsvImportSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Onthoudt voor welke klant we de standaardmappen al hebben aangemaakt, zodat een snelle
  // dubbele mount (React strict mode) niet twee keer dezelfde set inschiet → dubbele mappen.
  const seededClientRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }

    const [{ data: foldersData }, { data: filesData }] = await Promise.all([
      dbSelect<ClientFolder>("client_folders", { select: "*", clientId, order: { column: "name" } }),
      dbSelect<ClientFile>("client_files", { select: "*", clientId, order: { column: "uploaded_at", ascending: false } }),
    ]);

    let loadedFolders = foldersData;

    // Ensure all default folders exist (adds missing ones for existing clients too).
    // Guard tegen dubbele seeding: maximaal één keer per klant binnen deze mount.
    const existingNames = new Set(loadedFolders.map((f: { name: string }) => f.name));
    const missing = DEFAULT_FOLDERS.filter((name) => !existingNames.has(name));
    if (missing.length > 0 && seededClientRef.current !== clientId) {
      seededClientRef.current = clientId;
      const inserts = missing.map((name) => ({ name }));
      await dbInsert("client_folders", clientId, inserts);
      const { data: newFolders } = await dbSelect<ClientFolder>("client_folders", { select: "*", clientId, order: { column: "name" } });
      loadedFolders = newFolders;
    }

    // Ontdubbel op naam (verdedig tegen historisch dubbel geseede mappen); bestanden
    // verwijzen op mapnaam, dus één zichtbare map per naam is altijd correct.
    const seenNames = new Set<string>();
    loadedFolders = loadedFolders.filter((f: { name: string }) => {
      if (seenNames.has(f.name)) return false;
      seenNames.add(f.name);
      return true;
    });

    setFolders(loadedFolders);
    setFiles(filesData);
    if (!activeFolder && loadedFolders.length > 0) {
      setActiveFolder(loadedFolders[0].name);
    }
    setLoading(false);
  }, [clientId, activeFolder]);

  useEffect(() => { refresh(); }, [refresh]);

  const activeFolderFiles = files.filter((f) => f.folder === activeFolder);
  const fileCounts = new Map<string, number>();
  for (const f of files) {
    fileCounts.set(f.folder, (fileCounts.get(f.folder) ?? 0) + 1);
  }

  async function handleCreateFolder() {
    if (!supabase || !newFolderName.trim()) return;
    await dbInsert("client_folders", clientId, { name: newFolderName.trim() });
    setNewFolderName("");
    setShowNewFolder(false);
    await refresh();
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!supabase || !e.target.files?.length) return;
    setUploading(true);
    setUploadError(null);
    setSprintImportSummary(null);

    const errors: string[] = [];

    for (const file of Array.from(e.target.files)) {
      // Sanitize filename: remove special chars, replace spaces with underscores
      const safeName = file.name
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // strip accents
        .replace(/[^a-zA-Z0-9._-]/g, "_")                  // replace special chars
        .replace(/_+/g, "_");                                // collapse multiple underscores
      const storagePath = `${clientId}/${activeFolder}/${Date.now()}-${safeName}`;

      const { error: storageErr } = await supabase.storage
        .from("client-files")
        .upload(storagePath, file);

      if (storageErr) {
        errors.push(`${file.name}: ${storageErr.message}`);
        continue;
      }

      const { error: dbErr } = await dbInsert("client_files", clientId, {
        folder: activeFolder,
        file_name: file.name,
        file_size: file.size,
        content_type: file.type,
        storage_path: storagePath,
      });

      if (dbErr) {
        errors.push(`${file.name}: ${dbErr.message}`);
      }

      // Auto-parse sprint planning CSVs into sprint_items. Gedeeld met de importknop op de
      // sprintplanning-kaart (lib/learning/sprint-csv-import.ts) -- zie die module voor het
      // waarom van "een implementatie, twee aanroepers".
      if (activeFolder === "Sprintplanning" && file.name.toLowerCase().endsWith(".csv")) {
        try {
          const text = await file.text();
          const summary = await importSprintCsv(text, clientId);
          setSprintImportSummary(summary);
        } catch (parseErr) {
          console.error(`[client-files] Sprint parse failed for ${file.name}:`, parseErr);
          errors.push(`${file.name}: sprint import mislukt: ${parseErr instanceof Error ? parseErr.message : "onbekende fout"}`);
        }
      }
    }

    if (errors.length > 0) {
      setUploadError(errors.join("; "));
    }

    e.target.value = "";
    setUploading(false);
    await refresh();
  }

  async function handleDownload(file: ClientFile) {
    if (!supabase) return;
    const { data } = await supabase.storage
      .from("client-files")
      .createSignedUrl(file.storage_path, 60);

    if (data?.signedUrl) {
      window.open(data.signedUrl, "_blank");
    }
  }

  const [viewingFile, setViewingFile] = useState<ClientFile | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);

  async function handleView(file: ClientFile) {
    if (!supabase) return;
    setViewingFile(file);
    setViewUrl(null);
    const { data } = await supabase.storage
      .from("client-files")
      .createSignedUrl(file.storage_path, 60);
    setViewUrl(data?.signedUrl ?? null);
  }

  async function handleDeleteFile(fileId: string) {
    if (!supabase) return;
    const file = files.find((f) => f.id === fileId);
    if (file) {
      await supabase.storage.from("client-files").remove([file.storage_path]);
      await dbDelete("client_files", clientId, { id: fileId });
    }
    setDeleteConfirm(null);
    await refresh();
  }

  async function handleDeleteFolder(folderName: string) {
    if (!supabase) return;
    // Delete all files in the folder
    const folderFiles = files.filter((f) => f.folder === folderName);
    if (folderFiles.length > 0) {
      await supabase.storage.from("client-files").remove(folderFiles.map((f) => f.storage_path));
      await dbDelete("client_files", clientId, { folder: folderName });
    }
    await dbDelete("client_folders", clientId, { name: folderName });

    if (activeFolder === folderName) setActiveFolder("");
    await refresh();
  }

  if (!supabase) return null;

  if (loading) {
    return (
      <div className="bg-card rounded-xl border border-border p-8 shadow-sm flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-brand-blue-ink" />
      </div>
    );
  }

  const errors = sopErrors ?? [];

  return (
    <div className="space-y-4">
      {/* SOP Error Banner */}
      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-title font-semibold text-red-700">
                  {errors.length} SOP analyse{errors.length !== 1 ? "s" : ""} mislukt
                </h3>
                <div className="mt-2 space-y-2">
                  {errors.map((err) => (
                    <div key={err.id} className="flex items-center gap-2 text-xs">
                      <span className="font-medium text-red-600">{err.label}</span>
                      <span className="text-red-500 truncate max-w-[400px]">{err.error}</span>
                      <span className="text-red-400 text-micro">
                        {new Date(err.timestamp).toLocaleString("nl-NL", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}
                      </span>
                      {onDismissError && (
                        <button
                          onClick={() => onDismissError(err.id)}
                          className="ml-auto shrink-0 p-1 rounded hover:bg-red-100 transition-colors"
                          title="Markeer als afgehandeld"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-red-400 hover:text-red-600" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {errors.length > 1 && onDismissAllErrors && (
              <button
                onClick={onDismissAllErrors}
                className="text-micro font-medium text-red-500 hover:text-red-700 hover:underline shrink-0"
              >
                Alles afhandelen
              </button>
            )}
          </div>
        </div>
      )}

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 pt-5 pb-4">
        <h3 className="text-sm font-semibold text-brand-blue-ink uppercase tracking-wide">Bestanden</h3>
        <p className="text-micro text-muted-foreground mt-0.5">
          SOP's, rapportages en andere documenten per klant
        </p>
      </div>

      <div className="flex min-h-[300px]">
        {/* Folder sidebar */}
        <div className="w-48 border-r border-border bg-gray-50/50 p-2 space-y-0.5">
          {folders.map((folder) => {
            const count = fileCounts.get(folder.name) ?? 0;
            const isActive = activeFolder === folder.name;
            return (
              <button
                key={folder.id}
                onClick={() => setActiveFolder(folder.name)}
                className={`flex items-center gap-2 w-full px-2.5 py-2 rounded-lg text-xs transition-colors ${
                  isActive
                    ? "bg-brand-blue text-white font-medium"
                    : "text-brand-gray hover:bg-gray-100"
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate flex-1 text-left">{folder.name}</span>
                {count > 0 && (
                  <span className={`text-micro ${isActive ? "text-white/70" : "text-muted-foreground"}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}

          {/* New folder */}
          {showNewFolder ? (
            <div className="p-1.5">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
                placeholder="Mapnaam..."
                className="w-full text-meta border border-border rounded px-2 py-1.5 focus:outline-none focus:border-brand-blue"
                autoFocus
              />
              <div className="flex gap-1 mt-1">
                <button onClick={handleCreateFolder} className="text-micro text-brand-blue-ink font-medium">Toevoegen</button>
                <button onClick={() => setShowNewFolder(false)} className="text-micro text-muted-foreground">Annuleer</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowNewFolder(true)}
              className="flex items-center gap-1.5 w-full px-2.5 py-2 rounded-lg text-meta text-muted-foreground hover:text-brand-blue-ink hover:bg-gray-100 transition-colors"
            >
              <FolderPlus className="w-3 h-3" /> Nieuwe map
            </button>
          )}
        </div>

        {/* File list */}
        <div className="flex-1 p-4">
          {/* Upload bar */}
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-xs font-semibold text-brand-gray">
              {activeFolder || "Selecteer een map"}
            </h4>
            {activeFolder && (
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-meta font-medium rounded-lg bg-brand-blue text-white hover:bg-brand-blue/90 disabled:opacity-50"
                >
                  {uploading ? (
                    <><Loader2 className="w-3 h-3 animate-spin" /> Uploaden...</>
                  ) : (
                    <><Upload className="w-3 h-3" /> Upload bestand</>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Sprintplanning-import: niet-blokkerend. De import is al klaar; dit meldt alleen
              hoeveel hypotheses de H1-evaluator nooit kan toetsen zonder Verwacht Resultaat. */}
          {sprintImportSummary && (
            <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between">
              <p className="text-meta text-amber-800">
                {sprintImportSummary.hypothesesImported} hypothese{sprintImportSummary.hypothesesImported === 1 ? "" : "n"} uit sprintplanning geimporteerd
                {sprintImportSummary.tasksImported > 0 ? `, ${sprintImportSummary.tasksImported} taken` : ""}.
                {(sprintImportSummary.missingExpectedResult + sprintImportSummary.unparseableExpectedResult) > 0 &&
                  ` ${sprintImportSummary.missingExpectedResult + sprintImportSummary.unparseableExpectedResult} zonder toetsbaar Verwacht Resultaat.`}
              </p>
              <button onClick={() => setSprintImportSummary(null)} className="text-meta text-muted-foreground ml-2">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Upload error */}
          {uploadError && (
            <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between">
              <p className="text-meta text-red-700">Upload mislukt: {uploadError}</p>
              <button onClick={() => setUploadError(null)} className="text-meta text-muted-foreground ml-2">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Delete confirmation */}
          {deleteConfirm && (
            <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between">
              <p className="text-meta text-red-700">Bestand verwijderen?</p>
              <div className="flex gap-2">
                <button onClick={() => setDeleteConfirm(null)} className="text-meta text-muted-foreground">Annuleren</button>
                <button onClick={() => handleDeleteFile(deleteConfirm)} className="text-meta text-red-600 font-medium">Verwijder</button>
              </div>
            </div>
          )}

          {/* Files */}
          {activeFolderFiles.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                <File className="w-5 h-5 text-muted-foreground/30" />
              </div>
              <p className="text-xs text-muted-foreground">Geen bestanden in deze map</p>
              {activeFolder && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-meta text-brand-blue-ink hover:underline mt-2"
                >
                  Upload je eerste bestand
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {activeFolderFiles.map((file) => (
                <div
                  key={file.id}
                  className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <FileIcon contentType={file.content_type} fileName={file.file_name} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-brand-gray truncate">{file.file_name}</p>
                    <p className="text-micro text-muted-foreground">
                      {formatFileSize(file.file_size)} · {timeAgo(file.uploaded_at)}
                    </p>
                  </div>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {isMarkdownFile(file) && (
                      <button
                        onClick={() => handleView(file)}
                        className="p-1.5 rounded-md hover:bg-card hover:shadow-sm"
                        title="Bekijken"
                      >
                        <Eye className="w-3 h-3 text-brand-blue-ink" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDownload(file)}
                      className="p-1.5 rounded-md hover:bg-card hover:shadow-sm"
                      title="Download"
                    >
                      <Download className="w-3 h-3 text-brand-blue-ink" />
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(file.id)}
                      className="p-1.5 rounded-md hover:bg-red-50"
                      title="Verwijderen"
                    >
                      <Trash2 className="w-3 h-3 text-red-400" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>
      {viewingFile && (
        <MarkdownFileViewer
          title={viewingFile.file_name}
          url={viewUrl}
          onClose={() => { setViewingFile(null); setViewUrl(null); }}
        />
      )}
    </div>
  );
}
