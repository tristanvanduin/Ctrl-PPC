// Blog-datumopmaak, één keer. Stond identiek gedupliceerd in blog/page.tsx en blog/[slug]/page.tsx,
// en allebei op toLocaleDateString("nl-NL") -- "11 augustus 2026" op een Engelstalige pagina
// (audit, 11 augustus 2026). Zelfde categorie fout als de andere Nederlandse restjes die deze audit
// blootlegde: de content zelf was al Engels, alleen de datumopmaak was blijven staan.

export function formatBlogDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
}
