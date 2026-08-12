"use client";

import { useEffect, useState } from "react";
import { X, Loader2, AlertCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// De executive summary die bij een SOP-run wordt opgeslagen ging tot nu toe alleen open als
// kale signed URL -- de browser toont "## Executive Summary" en "**Prioriteit 1**" letterlijk
// als tekst, niet als opmaak. Deze modal rendert diezelfde content client-side i.p.v. dat er een
// nieuwe view-route of server-side renderer bij moet komen.
interface Props {
  title: string;
  url: string | null;
  onClose: () => void;
}

export function MarkdownFileViewer({ title, url, onClose }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setContent(null);
    setError(null);
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Bestand ophalen mislukt (${res.status})`);
        return res.text();
      })
      .then((text) => { if (!cancelled) setContent(text); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Onbekende fout"); });
    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 pt-[8vh] pb-[8vh]" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-full flex flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <h3 className="text-title font-semibold text-rm-gray truncate">{title}</h3>
          <button onClick={onClose} aria-label="Sluiten" className="p-1 rounded-md text-muted-foreground hover:bg-gray-100 hover:text-rm-gray">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">
          {error && (
            <div className="flex items-center gap-2 text-meta text-red-600">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}
          {!error && content === null && (
            <div className="flex items-center gap-2 text-meta text-muted-foreground py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Bestand wordt geladen...
            </div>
          )}
          {!error && content !== null && (
            <div className="prose prose-sm max-w-none prose-headings:text-rm-gray prose-p:text-rm-gray prose-li:text-rm-gray prose-strong:text-rm-gray">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
