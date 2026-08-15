// Welke tabellen de browser mag schrijven, met welk recht, en waar de beurs-grens loopt.
//
// WAAROM DIT BESTAAT
//
// Er stonden 35 schrijfacties rechtstreeks in componenten, met de anon key uit de JS-bundle.
// Dat werkt alleen zolang de RLS-policies `using (true)` zijn — en zolang dat zo is, kan elke
// ingelogde gebruiker via de console elke tabel van elke beurs muteren, ongeacht wat de UI
// toont. Migratie 017 sluit dat af door helemaal geen write-policies te geven: alle writes
// horen dan via de service role te lopen. Deze tabel is die route.
//
// EEN ROUTE, GEEN DERTIEN
//
// Dertien losse endpoints betekent dertien plekken waar de beurs-check kan ontbreken. Dit is
// er een, met het beleid als data ernaast — te lezen en te testen zonder de route te draaien.
//
// WAT DIT WEL EN NIET AFDEKT
//
// Wel: onbekende tabellen, verboden bewerkingen, ontbrekende rechten, schrijven buiten de
// eigen beurs, en een update of delete zonder filter (die anders de hele tabel raakt).
//
// Niet: welke KOLOMMEN gezet mogen worden. Deze tabellen zijn app-configuratie en planning,
// geen gebruikersrecords met rechten-kolommen erin, dus kolom-niveau levert hier weinig op
// tegen veel onderhoud. Wie settings:write op zijn eigen beurs heeft, kan de kolommen van die
// beurs zetten — net als nu, maar voortaan begrensd tot die beurs.

import type { Capability } from "../auth/roles";

export type WriteOperation = "insert" | "update" | "upsert" | "delete";

export interface TableWritePolicy {
  /** Het recht dat een gebruiker moet hebben om deze tabel te schrijven. */
  capability: Capability;
  /**
   * De kolom die bepaalt bij welke beurs een rij hoort, of null als de tabel niet
   * beurs-gebonden is. Bij een gezette waarde wordt die kolom ALTIJD server-side ingevuld
   * vanuit de gecontroleerde scope; wat de client meestuurt telt niet mee.
   */
  clientColumn: string | null;
  operations: readonly WriteOperation[];
  /** Kolommen waarop een upsert samenvalt (onConflict). */
  conflictTarget?: string;
}

// Bewust zonder upsert: een upsert zonder conflictdoel valt terug op de primaire sleutel, en
// dat is bij deze tabellen een gegenereerde id die de client niet kent. Het resultaat is dan
// een insert die zich als update voordoet. Alleen tabellen met een echte natuurlijke sleutel
// (client_settings, geo_clone_settings) krijgen upsert, met dat doel er expliciet bij.
const CRUD: readonly WriteOperation[] = ["insert", "update", "delete"];

export const WRITABLE_TABLES: Record<string, TableWritePolicy> = {
  // ── Instellingen per beurs ────────────────────────────────────────────────
  client_settings: {
    capability: "settings:write",
    clientColumn: "client_id",
    operations: ["upsert"],
    conflictTarget: "client_id",
  },
  geo_clone_settings: {
    capability: "settings:write",
    clientColumn: "client_id",
    operations: ["upsert"],
    // Samengesteld: een beurs heeft per geo-kloon een eigen rij. Alleen op client_id
    // botsen zou de klonen van elkaar overschrijven.
    conflictTarget: "client_id,geo_clone",
  },
  // Fase 2 (docs/MASTERPLAN.md): cpa/roas komen sinds migratie 082 uit client_targets, niet meer
  // uit kpi_targets, voor de maandanalyse. client-settings.tsx schrijft de cpa/roas-velden van
  // zijn bestaande formulier daarom voortaan ook hierheen (naast kpi_targets, dat de overige
  // doelvelden blijft dragen -- zie de kop van lib/analysis/o2-targets-cost.ts). Conflictdoel
  // gelijk aan de unique-constraint uit migratie 002: één rij per klant/kanaal/metric/ingang.
  client_targets: {
    capability: "settings:write",
    clientColumn: "client_id",
    operations: ["upsert", "delete"],
    conflictTarget: "client_id,channel,metric,valid_from",
  },

  // ── Sprint en planning ────────────────────────────────────────────────────
  sprint_items: { capability: "sprint:write", clientColumn: "client_id", operations: CRUD },
  sprint_hypotheses: { capability: "sprint:write", clientColumn: "client_id", operations: CRUD },
  sop_tasks: { capability: "sprint:write", clientColumn: "client_id", operations: ["update"] },
  sop_recommendations: { capability: "sprint:write", clientColumn: "client_id", operations: ["update"] },
  task_completions: { capability: "sprint:write", clientColumn: "client_id", operations: CRUD },
  // Snooze/toewijzing/afronden vanuit de Vandaag-feed. Natuurlijke sleutel op item_key (de
  // bron-id van het feed-item), dus upsert met dat conflictdoel -- zelfde reden als
  // client_settings hierboven.
  feed_item_state: {
    capability: "sprint:write",
    clientColumn: "client_id",
    operations: ["upsert"],
    conflictTarget: "item_key",
  },

  // ── Documenten en notities ────────────────────────────────────────────────
  client_files: { capability: "sprint:write", clientColumn: "client_id", operations: ["insert", "delete"] },
  client_folders: { capability: "sprint:write", clientColumn: "client_id", operations: ["insert", "delete"] },
  client_notes: { capability: "sprint:write", clientColumn: "client_id", operations: ["insert", "update", "delete"] },

  // ── Applicatie-instellingen: een gedeelde sleutel-waardetabel ─────────────
  // Hier staan de beurslijst en de zichtbaarheidsselectie in. Niet beurs-gebonden, en
  // settings:write omdat het de inrichting van de hele app raakt — een beurs_manager hoort
  // niet te kunnen bepalen welke beurzen er bestaan.
  app_settings: {
    capability: "settings:write",
    clientColumn: null,
    operations: ["upsert", "delete"],
    conflictTarget: "key",
  },

  // ── Scriptbibliotheek: niet beurs-gebonden ────────────────────────────────
  // De bibliotheek is gedeeld over alle beurzen. Daarom settings:write en geen beurs-check;
  // een beurs_manager kan hier niet bij, en dat is de bedoeling.
  scripts: { capability: "settings:write", clientColumn: null, operations: ["insert", "update", "delete"] },
};

// De gesynchroniseerde ads_*-tabellen staan hier bewust NIET in. Die worden uitsluitend door
// de sync-orchestrator geschreven, server-side met de service role. Een van hen hier opnemen
// zou een weg openen om meetdata vanuit de browser te muteren, en daar is geen scherm voor.

export function isWritableTable(table: string): boolean {
  return Object.hasOwn(WRITABLE_TABLES, table);
}

export function policyFor(table: string): TableWritePolicy | null {
  return isWritableTable(table) ? WRITABLE_TABLES[table] : null;
}

export function isWriteOperation(value: unknown): value is WriteOperation {
  return value === "insert" || value === "update" || value === "upsert" || value === "delete";
}

export interface WriteRequest {
  table: string;
  op: WriteOperation;
  clientId?: string | null;
  /** Rijen voor insert en upsert. */
  rows?: Record<string, unknown>[];
  /** Kolomwaarden voor update. */
  values?: Record<string, unknown>;
  /** Gelijkheidsfilter voor update en delete. */
  match?: Record<string, unknown>;
  /**
   * Aanvullend "kolom zit in deze verzameling"-filter, voor batch-bewerkingen op een lijst
   * ids. Wordt met match gecombineerd (en dus ook met de beurs-grens), nooit in plaats van.
   */
  matchIn?: { column: string; values: unknown[] };
}

export type WriteRejection =
  | { ok: false; status: 400 | 403; error: string };

export type WriteApproval = {
  ok: true;
  policy: TableWritePolicy;
  /** Rijen met de beurs-kolom server-side ingevuld. */
  rows: Record<string, unknown>[];
  values: Record<string, unknown>;
  /** Het filter inclusief de beurs-grens. */
  match: Record<string, unknown>;
  matchIn: { column: string; values: unknown[] } | null;
};

/**
 * Controleert een schrijfverzoek tegen het beleid en levert het genormaliseerde verzoek op.
 *
 * De rechten- en scope-check zit hier bewust NIET in: die vergt de sessie en hoort in de
 * route. Dit is het pure deel — vorm, bewerking en de beurs-grens — zodat het testbaar is
 * zonder omgeving.
 *
 * @param inScope Geeft aan of de aanroeper bij deze beurs mag. De route bepaalt dat; hier
 *   wordt het alleen toegepast, zodat er geen tweede plek ontstaat die dat zelf uitrekent.
 */
export function validateWrite(req: WriteRequest, inScope: boolean): WriteApproval | WriteRejection {
  const policy = policyFor(req.table);
  if (!policy) return { ok: false, status: 400, error: `tabel ${req.table} is niet schrijfbaar` };
  if (!policy.operations.includes(req.op)) {
    return { ok: false, status: 400, error: `${req.op} is niet toegestaan op ${req.table}` };
  }

  const rows = req.rows ?? [];
  const values = { ...(req.values ?? {}) };
  const match = { ...(req.match ?? {}) };

  if ((req.op === "insert" || req.op === "upsert") && rows.length === 0) {
    return { ok: false, status: 400, error: `${req.op} zonder rijen` };
  }
  if (req.op === "update" && Object.keys(values).length === 0) {
    return { ok: false, status: 400, error: "update zonder waarden" };
  }

  if (policy.clientColumn) {
    if (!req.clientId) {
      return { ok: false, status: 400, error: `${req.table} vereist een beurs` };
    }
    if (!inScope) {
      return { ok: false, status: 403, error: "Onvoldoende rechten" };
    }
    // Server-side invullen, niet overnemen. Een client die een andere beurs meestuurt in de
    // rij of in het filter schrijft daarmee niet buiten zijn scope — de waarde wordt
    // overschreven, niet gecontroleerd.
    const col = policy.clientColumn;
    for (const row of rows) row[col] = req.clientId;
    delete values[col];
    match[col] = req.clientId;
  }

  // De beurs-kolom via matchIn laten lopen zou de grens omzeilen: dan staat er twee keer een
  // voorwaarde op dezelfde kolom en wint de ruimste.
  let matchIn: { column: string; values: unknown[] } | null = null;
  if (req.matchIn) {
    if (policy.clientColumn && req.matchIn.column === policy.clientColumn) {
      return { ok: false, status: 400, error: `${req.matchIn.column} kan niet als verzameling worden gefilterd` };
    }
    if (req.matchIn.values.length === 0) {
      return { ok: false, status: 400, error: "een lege verzameling filtert niets" };
    }
    matchIn = { column: req.matchIn.column, values: req.matchIn.values };
  }

  // Een update of delete zonder filter raakt de hele tabel. Bij een beurs-gebonden tabel is
  // de beurs zelf een geldig filter (bijvoorbeeld "wis alles van deze beurs"); bij een
  // gedeelde tabel moet er iets anders staan.
  if ((req.op === "update" || req.op === "delete") && Object.keys(match).length === 0 && !matchIn) {
    return { ok: false, status: 400, error: `${req.op} zonder filter raakt de hele tabel` };
  }

  return { ok: true, policy, rows, values, match, matchIn };
}
