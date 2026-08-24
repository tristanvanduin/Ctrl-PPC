import Link from "next/link";
import {
  parseInline, type Blok, type InlineNode, type JuridischDocument,
} from "@/lib/legal/documenten";
import {
  BEDRIJFSGEGEVENS, VELDLABELS, isDefinitief, ontbrekendeVelden,
} from "@/lib/legal/bedrijfsgegevens";

/**
 * Rendert een juridisch document (Privacy Statement, Algemene Voorwaarden) in de chrome van de
 * marketingsite. Server component: er zit geen enkele interactie in, dus er hoeft ook geen regel
 * client-JS voor te hydrateren -- zelfde afweging als bij de layout eromheen.
 *
 * MAX-W-3XL, NIET MAX-W-2XL. De blogpagina's staan op max-w-2xl, en dat is voor lopende tekst de
 * betere maat. Hier staan tabellen met drie kolommen in (subverwerkers, grondslagen); die worden
 * op 2xl zo smal dat elke cel over vier regels breekt. De tabellen scrollen bovendien zelf
 * horizontaal, zodat de pagina zelf nooit horizontaal scrollt.
 */

function Inline({ tekst }: { tekst: string }) {
  return (
    <>
      {parseInline(tekst, BEDRIJFSGEGEVENS).map((node: InlineNode, i) => {
        if (node.soort === "nadruk") {
          return <strong key={i} className="font-semibold text-off-white">{node.tekst}</strong>;
        }
        if (node.soort === "link") {
          return (
            <Link key={i} href={node.href} className="text-neon-indigo underline-offset-2 hover:underline">
              {node.tekst}
            </Link>
          );
        }
        if (node.soort === "ontbreekt") {
          // Zichtbaar, niet weggemoffeld: een leeg gat in een juridisch document leest als een
          // afgeronde zin die toevallig raar loopt. Deze markering laat zien dat er een beslissing
          // openstaat, en welke.
          return (
            <mark
              key={i}
              className="rounded-[3px] bg-amber-400/15 px-1.5 py-0.5 text-[0.9em] font-medium text-amber-200/90"
              style={{ fontFamily: "var(--font-marketing-mono)" }}
            >
              nog in te vullen: {node.label}
            </mark>
          );
        }
        if (node.soort === "waarde") {
          return <span key={i} className="text-off-white">{node.tekst}</span>;
        }
        return <span key={i}>{node.tekst}</span>;
      })}
    </>
  );
}

function BlokWeergave({ blok }: { blok: Blok }) {
  if (blok.soort === "subkop") {
    return (
      <h3 className="pt-2 font-marketing-heading text-base font-bold text-off-white">{blok.tekst}</h3>
    );
  }
  if (blok.soort === "alinea") {
    return (
      <p className="text-[15px] leading-relaxed text-off-white/70">
        <Inline tekst={blok.tekst} />
      </p>
    );
  }
  if (blok.soort === "lijst") {
    return (
      <ul className="space-y-2.5 pl-5">
        {blok.items.map((item, i) => (
          <li key={i} className="list-disc text-[15px] leading-relaxed text-off-white/70 marker:text-off-white/30">
            <Inline tekst={item} />
          </li>
        ))}
      </ul>
    );
  }
  if (blok.soort === "genummerd") {
    return (
      <ol start={blok.start} className="space-y-2.5 pl-5">
        {blok.items.map((item, i) => (
          <li key={i} className="list-decimal text-[15px] leading-relaxed text-off-white/70 marker:text-off-white/40">
            <Inline tekst={item} />
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-off-white/15">
            {blok.koppen.map((kop) => (
              <th key={kop} className="px-3 py-2.5 font-semibold text-off-white/80">{kop}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {blok.rijen.map((rij, i) => (
            <tr key={i} className="border-b border-off-white/10 align-top last:border-0">
              {rij.map((cel, j) => (
                <td key={j} className="px-3 py-3 leading-relaxed text-off-white/65">
                  <Inline tekst={cel} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function JuridischDocumentWeergave({ doc }: { doc: JuridischDocument }) {
  const definitief = isDefinitief();
  const ontbreekt = ontbrekendeVelden();

  return (
    <div className="mx-auto max-w-3xl px-6 pt-14 pb-20 sm:pt-20">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-neon-indigo">Legal</p>
      <h1 className="mt-4 font-marketing-heading text-3xl font-extrabold text-off-white sm:text-4xl">
        {doc.titel}
      </h1>

      <div
        className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-off-white/50"
        style={{ fontFamily: "var(--font-marketing-mono)" }}
      >
        <span>
          Versie <Inline tekst="{{versie}}" />
        </span>
        <span aria-hidden>·</span>
        <span>
          laatst gewijzigd op <Inline tekst="{{laatstGewijzigd}}" />
        </span>
      </div>

      {/* De conceptmelding staat er alleen zolang er echt iets ontbreekt, en verdwijnt vanzelf
          zodra lib/legal/bedrijfsgegevens.ts gevuld is -- niemand hoeft eraan te denken hem weg te
          halen. Zolang hij er staat is de pagina ook noindex en staat hij niet in de sitemap (zie
          de pagina's en app/sitemap.ts). */}
      {!definitief && (
        <div className="mt-8 rounded-[8px] border border-amber-400/30 bg-amber-400/[0.07] px-5 py-4">
          <p className="text-sm font-semibold text-amber-200">
            Concept — nog niet van kracht
          </p>
          <p className="mt-2 text-sm leading-relaxed text-off-white/65">
            De tekst hieronder is volledig, maar {ontbreekt.length}{" "}
            {ontbreekt.length === 1 ? "gegeven" : "gegevens"} over de onderneming en het contract
            {ontbreekt.length === 1 ? " is" : " zijn"} nog niet vastgesteld. Zolang dat zo is, is dit
            document een concept en niet de versie waarop een overeenkomst berust. De openstaande
            plekken zijn in de tekst gemarkeerd.
          </p>
          <p className="mt-3 text-xs leading-relaxed text-off-white/45">
            Openstaand: {ontbreekt.map((v) => VELDLABELS[v]).join(", ")}.
          </p>
        </div>
      )}

      {/* De site is Engels, dit document niet. Zonder deze regel leest een bezoeker het als een
          pagina die vergeten is te vertalen, in plaats van als een bewuste keuze. */}
      <p className="mt-8 rounded-[8px] border border-off-white/10 bg-midnight-slate-raised/40 px-5 py-4 text-sm leading-relaxed text-off-white/55">
        {doc.taalnoot}
      </p>

      <p className="mt-8 text-[15px] leading-relaxed text-off-white/70">
        <Inline tekst={doc.inleiding} />
      </p>

      <nav className="mt-10 rounded-[8px] border border-off-white/10 bg-midnight-slate-raised/40 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-off-white/40">Inhoud</p>
        <ol className="mt-3 space-y-1.5">
          {doc.paragrafen.map((p) => (
            <li key={p.id}>
              <a href={`#${p.id}`} className="flex gap-3 text-sm text-off-white/60 hover:text-off-white">
                <span
                  className="shrink-0 text-off-white/35"
                  style={{ fontFamily: "var(--font-marketing-mono)" }}
                >
                  {p.nummer}
                </span>
                {p.korteTitel}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-12 space-y-12">
        {doc.paragrafen.map((paragraaf) => (
          // scroll-mt: de header is sticky, dus zonder deze marge verdwijnt de kop waar je net op
          // klikte eronder.
          <section key={paragraaf.id} id={paragraaf.id} className="scroll-mt-24">
            <h2 className="font-marketing-heading text-xl font-bold text-off-white">
              <span
                className="mr-2.5 text-neon-indigo/70"
                style={{ fontFamily: "var(--font-marketing-mono)" }}
              >
                {paragraaf.nummer}
              </span>
              {paragraaf.titel}
            </h2>
            <div className="mt-4 space-y-4">
              {paragraaf.blokken.map((blok, i) => (
                <BlokWeergave key={i} blok={blok} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-14 border-t border-off-white/10 pt-6 text-sm leading-relaxed text-off-white/45">
        <Inline tekst={doc.slotnoot} />
      </p>
    </div>
  );
}
