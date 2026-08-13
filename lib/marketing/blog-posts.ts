// Fase 7, Task 3 (uitgebreid in de SEO/GEO-fase): voorbeeldcontent voor /blog. Er is geen CMS
// in deze codebase en dat wordt met deze posts ook niet geintroduceerd: een vaste lijst is
// genoeg voor een grid-overzicht en een artikel-template, en een echte redactieworkflow is een
// aparte beslissing voor later. De laatste drie (kanaalsynergie, RSA-assets, KPI-relaties) zijn
// gericht geschreven op zoekopdrachten en LLM-vragen van een specialist die naar precies dit
// probleem zoekt, en zijn gegrond in echte, bestaande analysecapaciteit (lib/cross-channel/
// funnel-overlap.ts, rsa-insights-facts.ts, lib/analysis/kpi-relations) -- geen verzonnen
// klantcijfers of onderzoeksclaims, ook hier niet. Geverifieerd (12 augustus 2026): de
// classificatielogica en de acht KPI-relaties in die drie bestanden komen woord voor woord
// overeen met wat de posts erover beweren.
//
// LEESMINUTEN GECORRIGEERD (12 augustus 2026, blog-audit): elk artikel gaf 5-8 minuten op,
// terwijl de werkelijke woordentelling (174-343 woorden) op ~200 wpm neerkomt op 1-2 minuten --
// een factor 3-6x te hoog, op elk artikel. "min read" staat letterlijk op de pagina
// (app/(marketing)/blog/[slug]/page.tsx, blog/page.tsx), dus dit was geen interne schatting maar
// een zichtbare, verifieerbare claim die niet klopte. Herberekend als Math.ceil(woorden / 200).

export interface RelatedPage {
  label: string;
  href: string;
}

export interface BlogPost {
  slug: string;
  titel: string;
  samenvatting: string;
  datum: string;
  leesminuten: number;
  inhoud: string[];
  /** Slugs of other posts that genuinely share a theme -- not "the other five", picked per post. */
  gerelateerdeSlugs?: string[];
  /** Product pages the post's own content actually points to (audit, 11 August 2026: every post
   *  dead-ended before this -- the only link on the whole page was "back to all articles"). Left
   *  empty where nothing on the page is a real match, rather than forcing one. */
  gerelateerdePaginas?: RelatedPage[];
  /** false = written but not live: no static route, absent from /blog, 404 if visited directly.
   *  Omitted (undefined) means published, same as every post before this field existed -- no need
   *  to touch the 6 existing posts. Added 12 augustus 2026 op verzoek van de eigenaar ("ik zou dit
   *  gewoon schrijven en desnoods als concept opslaan en pas later publiceren") -- er was tot dan
   *  geen manier om een artikel te schrijven zonder het meteen live te zetten. */
  published?: boolean;
  /** Kleine, vaste taxonomie (zie ALLE_TAGS) i.p.v. vrije tekst per post -- voorkomt dat elke
   *  nieuwe post zijn eigen net-iets-andere label verzint en de filter na een paar posts
   *  onbruikbaar wordt. Toegevoegd 12 augustus 2026 op verzoek van de eigenaar (tag-filter /blog). */
  tags?: BlogTag[];
  /** Wat voor stuk dit is (zie CONTENT_TYPES), los van tags (waarover het gaat). Verplicht, niet
   *  optioneel -- dit vervangt de hardcoded "Analysis"-badge op elke kaart, dus elke post
   *  (inclusief drafts) heeft er een nodig. Toegevoegd 13 augustus 2026. */
  contentType: ContentType;
}

/** Vaste taxonomie, niet vrij per post uit te breiden -- zie het commentaar bij BlogPost.tags. */
export const ALLE_TAGS = [
  "Google Ads", "Meta", "LinkedIn", "Cross-Channel", "Attribution", "Dashboards", "Agency Ops",
] as const;
export type BlogTag = (typeof ALLE_TAGS)[number];

// CONTENT-TYPE (13 augustus 2026, "alle blogs hebben de banner Analysis... is alles ook echt een
// analysis blog of zitten er andere tags/labels die logischer zijn... puur voor het type content
// dat je kan verwachten"): de badge op elke kaart was een vaste, hardcoded string in
// blog-grid.tsx -- geen enkele post had er echt "Analysis" op staan, het stond er gewoon altijd.
// Dit is een tweede as, los van BlogTag (kanaal/onderwerp): niet WAAROVER een post gaat, maar WAT
// voor stuk het is. Ingedeeld op basis van wat elke post daadwerkelijk doet, niet verzonnen:
//  - Method: leert een herbruikbare manier om iets goed te lezen/diagnosticeren (bv. "vraag een
//    uitsplitsing i.p.v. het gemiddelde", "scheid budget- van rank-oorzaak").
//  - Signal: wijst op een specifiek, smal, controleerbaar patroon in een account (bv. een van de
//    PMax-signalen, de RSA-dubbeltelling) -- geen algemene methode, een concrete check.
//  - Capability: een eerlijke stand van zaken over wat het product zelf wel/niet doet.
export const CONTENT_TYPES = ["Method", "Signal", "Capability"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "gemiddelde-cpa-verkeerde-vraag",
    titel: "Why an average CPA is the wrong question",
    samenvatting:
      "A single monthly CPA number averages two very different accounts into the same outcome. What that hides, and what to look at instead.",
    datum: "2026-06-02",
    leesminuten: 1,
    inhoud: [
      "A campaign with a CPA of 40 euros can describe two very different accounts: one that sits stably " +
        "around 40 euros everywhere, and one that hits 15 euros on desktop during the day and 90 on mobile " +
        "in the evening. The average is the same number in both cases, and the wrong question to ask in " +
        "both cases.",
      "The question that does work is a breakdown: by time of day, by device, and where relevant by " +
        "audience. Not because more detail is always better, but because a bid strategy at account level " +
        "reacts to the average, while costs are generated by time of day and device. A tROAS target that " +
        "fits the average therefore does not really fit either segment.",
      "In practice this means: before adjusting a bid strategy, first split the period where the problem " +
        "occurred by time of day and device. A spike confined to a few evening hours on mobile calls for a " +
        "different fix than a structurally too-high CPA across the whole day. Ctrl PPC's 6-step Decision " +
        "Framework builds on this: the hypothesis that follows from a signal points to the segment where the " +
        "problem actually sits, not to the account as a whole.",
    ],
    // Noemt het 6-staps Decision Framework zelf; verwijst naar waar dat staat uitgelegd. De twee
    // andere posts delen hetzelfde onderwerp: een gemiddelde/totaal dat de echte oorzaak verbergt.
    gerelateerdeSlugs: ["impression-share-dashboard-vertelt-niet", "acht-kpi-relaties-die-rapportages-missen"],
    gerelateerdePaginas: [{ label: "The 6-step Decision Framework", href: "/" }],
    tags: ["Google Ads"],
    contentType: "Method",
  },
  {
    slug: "impression-share-dashboard-vertelt-niet",
    titel: "What a dashboard does not tell you about impression share",
    samenvatting:
      "Impression share drops, and the dashboard shows a red line. The reason why is usually missing, and that reason determines which action makes sense.",
    datum: "2026-06-24",
    leesminuten: 1,
    inhoud: [
      "Search impression share drops for one of two reasons: budget or rank. A dashboard that only shows " +
        "the percentage forces you to guess which one it is, and the wrong guess spends money in the wrong " +
        "direction. Fixing a budget problem with a higher bid raises CPC without removing the underlying " +
        "shortfall; fixing a rank problem with more budget raises spend without winning back impressions.",
      "The distinction lives in two separate metrics that Google Ads does provide: search impression share " +
        "lost to budget, and search impression share lost to rank. Both are rarely visible in a standard " +
        "overview, and that is exactly where the \"dashboard illusion\" comes from: the screen shows an " +
        "outcome, not the two metrics that pull the cause apart.",
      "Once the cause is known, the next step is unambiguous: for budget, the question is whether the extra " +
        "spend is worth the margin; for rank, the question is whether the bid, the ad quality, or both are " +
        "falling short. Two very different conversations, both landing on the same red number on an average " +
        "dashboard.",
    ],
    // De post noemt "de dashboard illusion" letterlijk als specifieke claim (het scherm toont een
    // uitkomst, niet de twee metrics die de oorzaak uit elkaar trekken) -- dat blijft correct.
    // De sectienaam op /vs zelf is intussen herzien (11 augustus 2026, zie de comment daar); het
    // linklabel hieronder volgt die herziening.
    gerelateerdeSlugs: ["gemiddelde-cpa-verkeerde-vraag", "acht-kpi-relaties-die-rapportages-missen"],
    gerelateerdePaginas: [{ label: "Beyond the dashboard layer, in full", href: "/vs" }],
    tags: ["Google Ads", "Dashboards"],
    contentType: "Method",
  },
  {
    slug: "attributie-zonder-trackingcode",
    titel: "Attribution without a tracking code: what change history tells you",
    samenvatting:
      "You do not need to manually log every change to know whether a hypothesis was executed. The change history the platform already keeps tells you.",
    datum: "2026-07-15",
    leesminuten: 1,
    inhoud: [
      "Every ad platform keeps a change history: what was changed, when, and by whom. That history is " +
        "rarely used for anything besides an after-the-fact audit, even though it is also the missing link " +
        "between a hypothesis and the result it predicted.",
      "The problem this solves: a metric can improve without the proposed change ever having been made, " +
        "and a metric can stay flat while the change was made but gets overshadowed by something else. " +
        "Without pulling in the change history, an improved metric after accepting a hypothesis is not " +
        "confirmation, at best a coincidence that looks suspiciously like one.",
      "The approach is not complicated, but it does require discipline: classify every change by the type " +
        "the hypothesis predicted (budget, bid, status, keyword), limit that to the window between accepting " +
        "the hypothesis and the measurement moment, and treat \"no matching change found\" as its own " +
        "outcome, not a hidden \"no\". That last step is where most attribution attempts run aground: an " +
        "unexecuted hypothesis still gets judged on numbers that had nothing to do with it.",
    ],
    // De FAQ beantwoordt vrijwel dezelfde vraag ("hoe weet ik of een hypothese echt werkte") in
    // net andere bewoordingen -- een lezer die dit artikel uitleest heeft die vraag al gesteld.
    gerelateerdeSlugs: ["kanaalsynergie-bewijzen", "rsa-asset-dubbeltelling"],
    gerelateerdePaginas: [{ label: "How do I know a hypothesis actually worked?", href: "/faq" }],
    tags: ["Attribution"],
    contentType: "Method",
  },
  {
    slug: "kanaalsynergie-bewijzen",
    titel: "Proving channel synergy between Google, Meta, and LinkedIn",
    samenvatting:
      "Every channel delivers its own report, and no report shows whether the channels reinforce each other or double-pay for the same warm audience. A concrete way to actually see it.",
    datum: "2026-07-28",
    leesminuten: 2,
    inhoud: [
      "Ask a specialist whether their channels reinforce each other, and the answer is almost always a " +
        "feeling, not a number. Google Ads reports on Google Ads, Meta reports on Meta, and neither knows " +
        "the other exists. Proving channel synergy does not mean \"one more report\"; it means a layer that " +
        "looks at the same question across channels.",
      "That question breaks down into three roles every campaign, on every channel, effectively plays: " +
        "prospecting (tapping new demand), retargeting (recapturing a warm audience), and branded capture " +
        "(catching demand that already existed, on your own brand name). You can classify a campaign into " +
        "one of the three from its own signals: running on your own brand terms makes it branded capture. " +
        "Targeting a custom audience, site visitors, or a customer list makes it retargeting. A broad or " +
        "lookalike audience, or a demand-generating campaign type (display, video, demand gen), makes it " +
        "prospecting.",
      "Once every campaign on every channel has a role, two things become visible that no single-channel " +
        "report shows. The first is the double-pay risk: two or three channels all retargeting the same warm " +
        "pool, driving up blended CPA without any single report flagging anything odd, because within each " +
        "channel on its own the retargeting campaign looks like it is performing fine. The second is the " +
        "growth ceiling: a portfolio made up mostly of retargeting and branded capture, with no campaign " +
        "tapping new demand, stops growing once the existing pool is sold through, and that pattern only " +
        "becomes visible once you lay every channel side by side.",
      "What this delivers in practice depends on how much audience data is available: on Google Ads the " +
        "role classification is complete today, since brand terms and campaign type are simply in the data " +
        "every account already has. On Meta and LinkedIn that same classification is only as good as the " +
        "audience data underneath it, and grows as that gets read more deeply. An unrecognized campaign " +
        "deliberately comes back as \"unknown\" instead of being guessed: in channel synergy, a wrong guess " +
        "is more expensive than an honest \"we don't know yet\".",
    ],
    // Sluit direct aan op de "no limit on accounts, cross-channel synergy"-claim op de homepage --
    // dit artikel is de onderbouwing van precies die zin.
    gerelateerdeSlugs: ["acht-kpi-relaties-die-rapportages-missen", "attributie-zonder-trackingcode"],
    gerelateerdePaginas: [{ label: "No limit on accounts, cross-channel by default", href: "/" }],
    tags: ["Cross-Channel", "Google Ads", "Meta", "LinkedIn"],
    contentType: "Method",
  },
  {
    slug: "rsa-asset-dubbeltelling",
    titel: "The asset trap in RSA reporting: when your top line is a double count",
    samenvatting:
      "Most RSA analysis stops at the ad group level. Go one layer deeper, to individual assets, and you can walk into a double count that makes your best headline look worse than it is.",
    datum: "2026-08-04",
    leesminuten: 2,
    inhoud: [
      "A Responsive Search Ad is not one piece of ad copy but a pool of headlines and descriptions that " +
        "Google combines itself. Most reporting stops at the ad group level: how does this RSA perform as a " +
        "whole. That misses exactly the level where the real question sits, namely which individual headline " +
        "or description is doing the work.",
      "Go one layer deeper, to performance per asset, and there is a reason few specialists do this " +
        "structurally: the same impression, click, or conversion counts toward every asset that was in that " +
        "specific combination. A headline that happened to be shown often alongside a strong second headline " +
        "looks better than it is on its own. Without a hierarchy that corrects for that, \"our best-performing " +
        "headline\" ends up as a conclusion that mostly says something about who happened to stand next to it.",
      "The fix is not complicated statistics, but discipline in reading order: first keep the combinations " +
        "that occurred most often separate from combinations rarely shown, and only then judge an asset on " +
        "its own merits, not on the average of every combination it ever appeared in. Skip that hierarchy and " +
        "you optimize on noise that looks like a pattern.",
      "It is the same reason copy analysis at the asset level (the Meta equivalent is called creative " +
        "fatigue, a different mechanism with the same symptom: a good number telling the wrong story) " +
        "deserves its own kind of attention, separate from ordinary ad group reporting. It is not more work " +
        "for its own sake, it is the place where the double count otherwise goes unnoticed.",
    ],
    // Geen productpagina hoort hier logisch bij -- dit is een technisch RSA-detail zonder directe
    // pitch-match, en een gedwongen link zou precies het soort ruis zijn die dit artikel afraadt.
    gerelateerdeSlugs: ["acht-kpi-relaties-die-rapportages-missen", "gemiddelde-cpa-verkeerde-vraag"],
    tags: ["Google Ads", "Meta"],
    contentType: "Signal",
  },
  {
    slug: "agency-memory-overleeft-een-personeelswissel",
    titel: "Why agency memory outlives the person who built it",
    samenvatting:
      "A pattern one specialist finds for one client usually leaves with that specialist. What Ctrl PPC actually remembers today, and what is still on the roadmap.",
    datum: "2026-08-13",
    leesminuten: 2,
    inhoud: [
      "Ask an agency where its best PPC knowledge lives, and the honest answer is usually: in a person, not " +
        "in the account. A specialist notices that raising tROAS during the evening peak window cut CPA by " +
        "15 percent, ships the change, and moves on -- and that pattern exists nowhere durable. A monthly " +
        "report gets filed and rarely reopened; a message in a chat thread from four months ago is " +
        "functionally gone. When that specialist changes teams or leaves, the client does not just lose a " +
        "person -- the account loses everything that person learned about it.",
      "Before every monthly analysis, Ctrl PPC reads back a client's own history: the report timeline, and " +
        "every hypothesis proposed for that account, with its status, its measured outcome, and the learning " +
        "that came out of it. That record feeds straight into the next analysis, so a hypothesis that already " +
        "failed six months ago does not get proposed again as if nothing happened, and one that worked " +
        "becomes the starting assumption for what comes next, not a fresh guess with no memory behind it. It " +
        "runs the same way across Google, Meta, and LinkedIn: the history is read per client, not per channel.",
      "What this does not do yet, worth saying plainly: it does not carry a pattern found on one client over " +
        "to a different client in the same portfolio. If evening-hour bid adjustments worked for three " +
        "ecommerce accounts, nothing today automatically flags that as worth testing on a fourth -- that kind " +
        "of cross-client propagation, an agency's whole book learning from itself, is on the roadmap, not " +
        "live. What is live is memory within a single account, continuity that survives regardless of who is " +
        "looking at it this month. \"Agency memory\" invites a bigger claim than what exists today; this is " +
        "the honest version.",
      "Even in that narrower form, the difference is real. Without it, a specialist re-litigates the same " +
        "experiment every few months because nobody recorded it already failed. With it, the account keeps " +
        "what it learned regardless of who is logged in -- the record of what was tried, what worked, and " +
        "what did not, does not leave when a person does.",
    ],
    // Attributie levert de uitkomst (result_met/learning in sprint_hypotheses) die dit artikel als
    // bewijs gebruikt; kanaalsynergie deelt de kanaal-neutrale behandeling (Google/Meta/LinkedIn
    // gelijk, geen Google-specifieke claim).
    gerelateerdeSlugs: ["attributie-zonder-trackingcode", "kanaalsynergie-bewijzen"],
    gerelateerdePaginas: [{ label: "Agency Memory on the comparison page", href: "/vs" }],
    published: true,
    tags: ["Agency Ops", "Google Ads", "Meta", "LinkedIn"],
    contentType: "Capability",
  },
  {
    slug: "acht-kpi-relaties-die-rapportages-missen",
    titel: "Eight KPI relationships most reports never set against each other",
    samenvatting:
      "A report usually lists CPA, CTR, and reach separately. The signal is often not in either one, but in the ratio between them.",
    datum: "2026-08-10",
    leesminuten: 2,
    inhoud: [
      "Most reports treat every KPI as its own line: CPA this month, CTR this month, reach this month. Read " +
        "on their own, none of the three says anything is wrong, and yet the combination can hide a problem " +
        "that only becomes visible once you set two KPIs explicitly against each other.",
      "A few concrete examples. CPA decomposition splits a risen CPA into its two possible causes, a dropped " +
        "CTR or a risen CPC, because the follow-up step differs for each. A promise gap sets the message in " +
        "the ad against what the landing page actually delivers: a high CTR with a low conversion rate is " +
        "often not a targeting problem but an expectations problem. Vanity engagement flags a campaign with " +
        "lots of interaction and little value, the kind of number that looks good in a report and does " +
        "nothing for revenue.",
      "The other five follow the same logic: saturation (repeated exposure to the same people with no extra " +
        "return), reach dilution (growing reach with declining relevance per person), value mix (conversions " +
        "rising in count but dropping in value), frequency-versus-reach (frequency climbing while reach stays " +
        "flat, a sign the audience is exhausted), and expensive visibility (a top placement that costs more " +
        "than it returns in extra conversions). Eight relationships, and none of them are visible in a report " +
        "that lists every KPI separately.",
      "What they have in common: every relationship revolves around two metrics that almost never appear on " +
        "the same row of a report, let alone get set against each other explicitly. That is not unwillingness " +
        "on the part of whoever builds the report, it is simply not what a standard overview is built for. It " +
        "is, however, exactly where the next decision comes from.",
    ],
    // Dit artikel is de meest directe onderbouwing van de eigen tagline ("a chart is not a
    // decision"): het is letterlijk het argument waarom losse KPI's geen antwoord zijn.
    gerelateerdeSlugs: ["gemiddelde-cpa-verkeerde-vraag", "impression-share-dashboard-vertelt-niet"],
    gerelateerdePaginas: [{ label: "A chart is not a decision", href: "/" }],
    tags: ["Dashboards"],
    contentType: "Method",
  },
  {
    slug: "pmax-network-mix-verschuiving",
    titel: "When Performance Max quietly moves your budget away from Search",
    samenvatting:
      "PMax reports one blended number for the whole campaign. Underneath, spend can drift heavily toward Display, Video, Discover, Gmail, and Maps without a proportional share of conversions -- and the headline CPA never says so.",
    datum: "2026-08-13",
    leesminuten: 2,
    inhoud: [
      "A Performance Max campaign reports as one line: one CPA, one ROAS, one blended number. What that " +
        "number hides is where the spend actually went. PMax can allocate budget across Search, Shopping, " +
        "Display, Video, Discover, Gmail, and Maps, and a campaign showing a stable, on-target CPA can still " +
        "be quietly reallocating toward inventory that converts far worse than the average suggests.",
      "The concrete check is a network-level split of spend against conversions. When the browse and " +
        "discovery inventory -- Display, Video, Discover, Gmail, Maps combined -- absorbs a disproportionate " +
        "share of cost relative to the conversions it generates, that is a real signal, even while the " +
        "campaign-level average still looks healthy: the strong-converting slice of the campaign is quietly " +
        "subsidizing the average.",
      "The opposite failure mode matters just as much and is easier to miss: too little of the budget " +
        "actually reaching Search within a PMax campaign means the campaign leans heavily on lower-intent " +
        "inventory instead of the channel most likely to convert. Neither direction shows up in the headline " +
        "number Google surfaces by default.",
      "Why this stays invisible for months: Google's own reporting does not put network-level cost and " +
        "conversion split next to the campaign's headline metric by default, so the drift compounds quietly " +
        "until someone deliberately goes looking for it.",
    ],
    gerelateerdeSlugs: ["rsa-asset-dubbeltelling", "pmax-taal-lekkage"],
    tags: ["Google Ads"],
    contentType: "Signal",
  },
  {
    slug: "pmax-taal-lekkage",
    titel: "Performance Max can quietly start bidding in languages you never targeted",
    samenvatting:
      "PMax expands reach automatically, and that expansion can drift into search categories in languages your account was never set up to serve -- with no cost figure attached, because Google does not report spend at that level.",
    datum: "2026-08-13",
    leesminuten: 1,
    inhoud: [
      "Performance Max is built to expand reach automatically, matching queries loosely against your assets " +
        "and audience signals. That is a strength when it finds genuinely adjacent demand, and a real cost " +
        "when it drifts into search categories the account was never set up to serve.",
      "One concrete, checkable version of this: search categories that show up in scripts the account never " +
        "targeted -- Arabic, Cyrillic, Chinese, Japanese characters appearing in a campaign built for Latin-" +
        "script markets. Google does not report cost per search category inside PMax, so this specific leak " +
        "never shows up as a spend line -- the only signals available are impressions and clicks per " +
        "category, which is exactly why it goes unnoticed: there is no euro figure to trigger an alert on, " +
        "only volume drifting somewhere it should not be.",
      "The fix is not to distrust PMax's expansion, since reaching adjacent demand is the point of the " +
        "campaign type. It is to check, on a cadence Google's own dashboard never prompts, what the " +
        "expansion actually reached -- and to treat a search category outside the account's targeted " +
        "languages as a language-and-market question, not a performance number to average away.",
    ],
    gerelateerdeSlugs: ["pmax-network-mix-verschuiving", "gemiddelde-cpa-verkeerde-vraag"],
    tags: ["Google Ads"],
    contentType: "Signal",
  },
  {
    slug: "pmax-asset-group-risico",
    titel: "One asset group can quietly become your whole Performance Max campaign",
    samenvatting:
      "A single asset group taking over most of a PMax campaign's spend is a concentration risk worth naming. A separate asset group can spend real money with zero conversions for months without either one showing up in the campaign total.",
    datum: "2026-08-13",
    leesminuten: 1,
    inhoud: [
      "A Performance Max campaign is built from asset groups, and the campaign-level report shows one " +
        "blended result even when the asset groups underneath it behave completely differently -- one " +
        "dominating spend, others barely touching the budget.",
      "Concentration is the first pattern worth naming: when a single asset group takes over most of a " +
        "campaign's spend, that is the exact opposite of what spreading budget across asset groups is meant " +
        "to protect against, even while the campaign's headline number looks unremarkable.",
      "Waste is the second, more direct pattern, and it is a separate question from concentration: an asset " +
        "group can carry sustained, real spend with zero conversions for the same window a concentration " +
        "check would look at, sitting inside a campaign total that still looks fine. Performance labels and " +
        "asset-group spend are both visible in Google's own interface, but rarely checked together against " +
        "the campaign's own history -- which is exactly why either pattern can run for a full reporting cycle " +
        "before anyone notices.",
    ],
    gerelateerdeSlugs: ["pmax-network-mix-verschuiving", "pmax-creative-dekking"],
    tags: ["Google Ads"],
    contentType: "Signal",
  },
  {
    slug: "pmax-creative-dekking",
    titel: "Why a Performance Max campaign with no video assets is leaving reach on the table",
    samenvatting:
      "Performance Max serves across placements that reward different asset types. A campaign built only on images quietly caps how well it can perform on the video-first inventory it is still paying to reach.",
    datum: "2026-08-13",
    leesminuten: 1,
    inhoud: [
      "Performance Max serves across a wide mix of placements -- Search, Shopping, Display, YouTube, " +
        "Discover, Gmail, Maps -- and each favors different asset types. A campaign built entirely from " +
        "images has nothing to serve well on the video-first inventory it is still bidding into.",
      "The signal worth checking is not just whether there are enough assets, but whether performance " +
        "labels skew heavily toward the low end without a comparable share performing well -- creative " +
        "fatigue at the asset-group level, the same underlying pattern as ad fatigue elsewhere, just less " +
        "visible because PMax abstracts the placement away from the specialist reading the report.",
      "The fix is not \"add more of everything\", it is closing the specific gap: video coverage for " +
        "video-first inventory, and enough asset variety that the mix is not leaning on a shrinking pool of " +
        "top performers to carry the whole campaign.",
    ],
    gerelateerdeSlugs: ["pmax-asset-group-risico", "rsa-asset-dubbeltelling"],
    tags: ["Google Ads"],
    contentType: "Signal",
  },
  {
    slug: "pmax-zoekcategorie-dilutie",
    titel: "How much of your Performance Max reach never has a chance to convert",
    samenvatting:
      "PMax can spread meaningful impression volume across search categories that never produce a single conversion -- reach that looks like growth on a report and behaves like waste in practice.",
    datum: "2026-08-13",
    leesminuten: 1,
    inhoud: [
      "Performance Max expands into search categories automatically, and expansion is the point of the " +
        "campaign type -- reaching adjacent demand a narrower campaign would miss. The failure mode is not " +
        "expansion itself, it is expansion that keeps costing impressions in categories that never convert.",
      "The pattern worth watching: several search categories, each individually unremarkable, that together " +
        "account for a meaningful share of a campaign's total impression volume while contributing zero " +
        "conversions between them. No single category looks alarming; the sum does.",
      "Google does not report cost at the search-category level inside PMax, the same limitation behind the " +
        "language-leakage pattern -- so this is a volume question, not a spend question: reach that never " +
        "gets a chance to convert, sized in impressions, not euros. The distinction that actually matters: " +
        "PMax testing new territory and finding nothing is different from PMax repeatedly returning to " +
        "territory it has already proven does not convert. The second is what deserves attention.",
    ],
    gerelateerdeSlugs: ["pmax-taal-lekkage", "pmax-network-mix-verschuiving"],
    tags: ["Google Ads"],
    contentType: "Signal",
  },
  {
    slug: "false-positive-prevention-seizoen-vs-structureel",
    titel: "The question every performance drop needs answered before you touch the budget",
    samenvatting:
      "A metric falling because the whole market slowed down calls for a different response than the same metric falling because something in the account broke. Confusing the two is the more expensive mistake.",
    datum: "2026-08-13",
    leesminuten: 2,
    inhoud: [
      "A metric can fall for two entirely different reasons that look identical on a chart: the account got " +
        "worse, or the market did. A recommendation built on the wrong one wastes budget fixing something " +
        "that was never broken, or cuts spend right as demand recovers on its own.",
      "The check that separates them is not complicated, but it is the first one skipped under time " +
        "pressure: compare the change month-over-month against the same change year-over-year. A metric down " +
        "both ways points to something structural in the account. A metric down month-over-month but stable " +
        "or up year-over-year points to a seasonal pattern the account did not cause and does not need " +
        "fixing.",
      "That distinction only matters if it actually blocks a bad recommendation before it reaches someone, " +
        "not just a note buried in an appendix. A finding that cannot show a plausible cause, or cannot point " +
        "to real evidence behind it, does not get to become a recommendation -- no matter how clean the " +
        "correlation looks on its own.",
      "The result of getting this right is boring, and that is the point: fewer recommendations, not more, " +
        "each one more likely to survive contact with what actually happened once someone acts on it.",
    ],
    gerelateerdeSlugs: ["acht-kpi-relaties-die-rapportages-missen", "gemiddelde-cpa-verkeerde-vraag"],
    gerelateerdePaginas: [{ label: "How do you avoid blaming the account when the real cause is the market?", href: "/faq" }],
    tags: ["Agency Ops"],
    contentType: "Method",
  },
  {
    slug: "linkedin-icp-waste",
    titel: "How much of your LinkedIn spend never reaches your actual buyer",
    samenvatting:
      "LinkedIn's own targeting reports spend and leads by job function, seniority, industry, and company size. Most accounts never set that breakdown against who they are actually trying to reach.",
    datum: "2026-08-13",
    leesminuten: 2,
    inhoud: [
      "LinkedIn Campaign Manager reports impressions, clicks, spend, and leads broken down by job function, " +
        "seniority, industry, and company size for every campaign. Most accounts read the campaign-level CPL " +
        "and stop there, never crossing that demographic breakdown against the profile they were actually " +
        "trying to reach.",
      "The check itself is not complicated: define the ideal customer profile as the set of job functions, " +
        "seniority levels, industries, and company sizes worth targeting, then set LinkedIn's own demographic " +
        "split against it. Spend and leads inside that profile are the number that matters; everything " +
        "outside it is functionally cost with no route to a real buyer, whatever the blended CPL says.",
      "The pattern worth watching for specifically: a segment absorbing a real share of spend while sitting " +
        "entirely outside the profile -- individual contributors on a campaign built for decision-makers, or " +
        "an industry the account has never once closed a deal in. No single line in a standard LinkedIn report " +
        "flags this; the campaign-level CPL can look perfectly healthy while a meaningful slice of the budget " +
        "buys reach that was never going to convert.",
      "The harder case, and the one worth naming honestly: LinkedIn does not disclose demographic data for " +
        "every impression -- a share sits below a reporting threshold and never gets attributed to any " +
        "segment. Treating that unattributed slice as fine is a guess dressed as a finding; the honest version " +
        "of this check reports coverage alongside the fit numbers, not instead of them.",
    ],
    gerelateerdeSlugs: ["linkedin-creative-verval-zonder-frequency", "kanaalsynergie-bewijzen"],
    tags: ["LinkedIn"],
    contentType: "Signal",
  },
  {
    slug: "linkedin-creative-verval-zonder-frequency",
    titel: "Why 'creative fatigue' means something different on LinkedIn than on Meta",
    samenvatting:
      "Meta shows you frequency per ad, so fatigue is a number you can watch directly. LinkedIn never reports it -- creative decay has to be read a different way entirely.",
    datum: "2026-08-13",
    leesminuten: 2,
    inhoud: [
      "Creative fatigue on Meta has a direct measurement: frequency climbs, and CTR usually falls alongside " +
        "it, so a specialist watches one number rise against another and knows roughly when to refresh. " +
        "LinkedIn does not report frequency per creative at all -- the exact input that measurement depends on " +
        "simply is not available in the platform's own reporting.",
      "What LinkedIn does report, per creative, is CTR and engagement over the days it has been running. That " +
        "is the workaround: instead of watching exposure per person climb, watch performance decay over " +
        "time-live. A creative holding a stable CTR at day 40 is behaving differently from one that opened " +
        "strong and has been sliding for two weeks straight, even though neither shows a frequency number to " +
        "explain why.",
      "The distinction that actually matters in practice: a slow, steady decline across every creative in a " +
        "campaign usually points to audience-level saturation, not any single creative wearing out, since " +
        "LinkedIn audiences are typically smaller and slower-refreshing than Meta's, so the whole pool sees " +
        "the same ad more often over a longer stretch. A sharp decline isolated to one creative, with others " +
        "in the same campaign holding steady, points at that specific asset, not the audience underneath it.",
      "Reading time-live as a fatigue proxy only works if it is compared like for like -- format against " +
        "format, since a document ad and a single-image ad decay on entirely different timelines. Treating " +
        "the two as one curve just because they ran in the same campaign produces a refresh signal that fires " +
        "at the wrong moment for one of them, every time.",
    ],
    gerelateerdeSlugs: ["linkedin-icp-waste", "rsa-asset-dubbeltelling"],
    tags: ["LinkedIn", "Meta"],
    contentType: "Signal",
  },
  {
    slug: "linkedin-audience-network-lekkage",
    titel: "The LinkedIn toggle that quietly changes where your ads actually run",
    samenvatting:
      "Audience Network extends a LinkedIn campaign's reach beyond LinkedIn itself, bundled into the same campaign-level number. Whether that extra reach is worth what it costs is a question most reports never separate out.",
    datum: "2026-08-13",
    leesminuten: 1,
    inhoud: [
      "LinkedIn campaigns carry a setting, on by default in some campaign types, that extends delivery beyond " +
        "LinkedIn itself to a network of partner apps and websites -- Audience Network. The campaign still " +
        "reports as one line: one CPL, one CTR, one spend total, with no visible split between LinkedIn's own " +
        "inventory and the extended network underneath it.",
      "The concrete question worth asking is not whether to turn it off, since more reach at a lower CPM is " +
        "genuinely useful when it converts -- it is whether the leads or engagement coming from that extended " +
        "reach hold up against what the same budget does on LinkedIn's own inventory. A campaign-level CPL " +
        "that looks stable can still be quietly propped up by cheap volume from placements the buyer never " +
        "associates with LinkedIn at all.",
      "The honest limitation, worth stating plainly: LinkedIn does not report cost and conversions split by " +
        "placement within a campaign, so this is a before/after comparison, not a live dashboard number -- " +
        "toggle it, hold everything else constant, and read the campaign's CPL and lead quality across a " +
        "clean window on each side. There is no other way to see it, because the platform never shows the " +
        "split directly.",
    ],
    gerelateerdeSlugs: ["linkedin-icp-waste", "pmax-network-mix-verschuiving"],
    tags: ["LinkedIn"],
    contentType: "Signal",
  },
  // DRAFT (12 augustus 2026, niet gepubliceerd op verzoek van de eigenaar -- "ik zou dit gewoon
  // schrijven en desnoods als concept opslaan en pas later publiceren"): een uitgebreide pro/con van
  // dashboarding-alleen. De homepage-positionering liet het "illusie"-frame vallen omdat het
  // tegenspreekt dat Foundation zelf een gratis dashboard is (zie comparison-block.tsx) -- maar een
  // blogartikel heeft ruimte voor de nuance die één paneel niet had, bevestigd door de eigenaar.
  {
    slug: "dashboard-illusie-pro-con",
    titel: "The Dashboard Illusion: what a dashboard gets right, and exactly where it stops",
    samenvatting:
      "Dashboarding is not fake, and pretending otherwise is a bad argument. Here is what it is actually good for, and the precise point where it runs out.",
    datum: "2026-08-13",
    leesminuten: 2,
    inhoud: [
      "Start with the honest case for dashboarding, because the counter-argument is worthless without it. " +
        "Real-time charts per channel, a forecast, KPI monitoring: this is genuinely useful, genuinely how " +
        "most agencies run today, and not a lesser or broken version of anything. It answers a real question " +
        "-- what happened -- fast, and answering that fast has value on its own.",
      "The illusion is not that a dashboard lies. It is that a stable-looking line implies a stable account, " +
        "and that is not always true. Two campaigns can show the exact same CPA chart -- flat, unremarkable -- " +
        "with completely different stories underneath: one drifting with the season, one breaking " +
        "structurally. The dashboard renders both identically, because a chart shows a metric moved, not why " +
        "it moved. The interpretation still has to happen somewhere. A dashboard just does not do it, and " +
        "rarely admits that it does not.",
      "The same pattern shows up in specific, checkable metrics. Search impression share drops for one of " +
        "two reasons -- budget or rank -- and a dashboard that only shows the percentage forces a guess. The " +
        "two metrics that actually separate the causes exist in the platform, they are just rarely on the " +
        "same screen as the headline number, which is exactly where \"the dashboard illusion\" earns its name: " +
        "not a false chart, a true chart that answers a smaller question than the one being asked of it.",
      "None of this is a criticism of dashboards doing their job badly. It is a description of a different " +
        "job entirely: a dashboard has no memory of what was already tried on this account, proposes no " +
        "hypothesis, and clears no quality gate before a number becomes a recommendation someone acts on. " +
        "That is not a missing feature. It is the layer a dashboard was never built to be.",
    ],
    gerelateerdeSlugs: ["impression-share-dashboard-vertelt-niet", "gemiddelde-cpa-verkeerde-vraag"],
    gerelateerdePaginas: [{ label: "Beyond the dashboard layer, in full", href: "/vs" }],
    published: false,
    tags: ["Dashboards"],
    contentType: "Method",
  },
  // DRAFT (12 augustus 2026, niet gepubliceerd): visiestuk over God View. gebouwd: false in
  // lib/marketing/modules.ts -- dit artikel maakt nergens de claim dat het vandaag te gebruiken is,
  // alleen waarom het concept (geanonimiseerde data over alle bureaus heen) waarde zou hebben. Geen
  // "roadmap"-framing (op verzoek van de eigenaar: "ik zou dit niet als roadmap item plaatsen") --
  // de grens is niet het label, het is dat de tekst nooit "je kunt dit nu gebruiken" zegt.
  {
    slug: "god-view-collectieve-marktdata",
    titel: "Why the next generation of PPC benchmarks will not come from your own accounts",
    samenvatting:
      "A benchmark built from your own client portfolio is a benchmark built from a few dozen accounts. The interesting comparison sits outside your own book, and no single agency can build it alone.",
    datum: "2026-08-13",
    leesminuten: 2,
    inhoud: [
      "Every agency benchmarks against itself, because it is the only data it has: this client's CPA against " +
        "that one, this quarter against last quarter. It is a real comparison and a narrow one -- a handful of " +
        "accounts in one or two verticals, run by one team, with one set of blind spots. A number that looks " +
        "unusual inside that portfolio might be completely ordinary for the sector, and there is no way to " +
        "know from inside a single agency's own client list.",
      "The comparison that actually answers \"is this normal\" sits outside any one agency's book: thousands " +
        "of accounts, anonymized, aggregated by sector and niche, so a single connected account sharpens the " +
        "picture for every other account on the same category, not just its own. No individual agency can " +
        "build that on its own client list, no matter how good the team is -- it requires scale across " +
        "agencies, not within one.",
      "This is not a claim about what exists in any single account view today. It is a claim about the shape " +
        "of the comparison that matters: not \"how does this client compare to your other clients\", but \"how " +
        "does this client compare to every account like it, anywhere\". That is a fundamentally different " +
        "question, and it needs fundamentally different data to answer -- data that only accumulates by being " +
        "the platform many agencies run on, not by any one agency working harder on its own numbers.",
      "The reason this matters for how agencies should think about tooling: a benchmark built inside your own " +
        "portfolio gets marginally better as you add clients. A benchmark built across agencies gets better " +
        "for everyone every time anyone connects an account -- a different kind of asset entirely, and one no " +
        "single agency, however good, can replicate by itself.",
    ],
    gerelateerdeSlugs: ["agency-memory-overleeft-een-personeelswissel"],
    gerelateerdePaginas: [],
    published: false,
    tags: ["Agency Ops"],
    contentType: "Capability",
  },
];

export function getBlogPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}

/** Draft posts (published: false) never resolve here -- used by both the listing and the
 *  static-params generation, so a draft has no built route at all, not just a hidden link. */
export function getPublishedBlogPost(slug: string): BlogPost | undefined {
  const post = getBlogPost(slug);
  return post && post.published !== false ? post : undefined;
}

export function getPublishedBlogPosts(): BlogPost[] {
  return BLOG_POSTS.filter((p) => p.published !== false);
}
