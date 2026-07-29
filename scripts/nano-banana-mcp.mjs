#!/usr/bin/env node
// Nano Banana Pro als MCP-server: beeldgeneratie met Google's Gemini-beeldmodellen, direct
// vanuit Claude.
//
// WAAROM GEEN KANT-EN-KLAAR PAKKET
//
// Er zijn community-MCP-servers voor dit model, maar die krijgen je API-sleutel en zijn een
// extra npm-afhankelijkheid die niemand hier leest. Dit bestand heeft nul afhankelijkheden —
// MCP over stdio is niets anders dan JSON-RPC 2.0 met één bericht per regel — en gebruikt de
// GEMINI_API_KEY die dit project toch al heeft voor de analyses.
//
// Nul afhankelijkheden betekent ook: dit bestand is overal te draaien. Kopieer het, of wijs er
// met een absoluut pad naar, en het werkt in elke repo.
//
// DE API
//
// Geverifieerd tegen de echte endpoint (de validatie accepteert precies deze vorm):
//   POST https://generativelanguage.googleapis.com/v1beta/interactions
//   header x-goog-api-key
//   { model, input: [{type:"text", text}], response_format: {type:"image", mime_type, aspect_ratio, image_size} }
// mime_type accepteert alleen "image/jpeg" — image/png geeft een expliciete 400 terug.
//
// WAT NIET GEVERIFIEERD IS
//
// De vorm van een GESLAAGD antwoord. De sleutel van dit project zit op zijn quota voor de
// beeldmodellen (429), dus er is nooit een echt beeld teruggekomen om tegenaan te lezen. De
// uitlezing hieronder volgt de documentatie (output_image.data, anders steps[].content[]), en
// als geen van beide past faalt hij hárd met de sleutels die wél in het antwoord zaten. Dat is
// bewust: een lege afbeelding die als succes leest, is erger dan een foutmelding.

import { writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

// Nano Banana Pro is gemini-3-pro-image; de flash-variant is sneller en goedkoper. Beide staan
// in de ListModels-uitvoer van dit project, dus dit zijn geen namen uit een blogpost.
const MODELLEN = {
  pro: "gemini-3-pro-image",
  flash: "gemini-3.1-flash-image",
};

const MAAT = ["1K", "2K", "4K"];
const VERHOUDING = ["1:1", "16:9", "9:16", "4:3", "3:4", "5:4", "4:5", "3:2", "2:3", "21:9"];

function apiKey() {
  const uitOmgeving = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (uitOmgeving) return uitOmgeving;
  // Terugval op .env.local in de werkmap, net als scripts/supabase-sql.mjs. Een MCP-client start
  // deze server met een opgeschoonde omgeving, dus zonder deze terugval zou hij in dit project
  // falen op een sleutel die er gewoon ligt. Buiten een repo met .env.local telt alleen de
  // omgevingsvariabele, en dat is precies goed.
  try {
    const inhoud = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const regel of inhoud.split("\n")) {
      const i = regel.indexOf("=");
      if (i <= 0 || regel.trimStart().startsWith("#")) continue;
      const naam = regel.slice(0, i).trim();
      if (naam === "GEMINI_API_KEY" || naam === "GOOGLE_API_KEY") return regel.slice(i + 1).trim();
    }
  } catch {
    /* geen .env.local is geen fout */
  }
  return null;
}

/** Waar de beelden landen. Los instelbaar, want een repo wil ze zelden in zijn wortel. */
function uitvoerMap() {
  return process.env.NANO_BANANA_OUT ?? join(process.cwd(), "generated-images");
}

async function genereer({ prompt, model = "pro", aspect_ratio = "1:1", image_size = "2K", bestandsnaam }) {
  const sleutel = apiKey();
  if (!sleutel) throw new Error("GEMINI_API_KEY ontbreekt. Zet hem in de omgeving van de MCP-server.");
  if (!prompt || !String(prompt).trim()) throw new Error("prompt is leeg");
  if (!MAAT.includes(image_size)) throw new Error(`image_size moet een van ${MAAT.join(", ")} zijn`);
  if (!VERHOUDING.includes(aspect_ratio)) throw new Error(`aspect_ratio moet een van ${VERHOUDING.join(", ")} zijn`);

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": sleutel },
    body: JSON.stringify({
      model: MODELLEN[model] ?? model,
      input: [{ type: "text", text: String(prompt) }],
      // Alleen jpeg; de API weigert png expliciet.
      response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio, image_size },
    }),
  });

  const tekst = await res.text();
  let data;
  try {
    data = JSON.parse(tekst);
  } catch {
    throw new Error(`Antwoord was geen JSON (http ${res.status}): ${tekst.slice(0, 300)}`);
  }
  if (!res.ok || data?.error) {
    const m = data?.error?.message ?? `http ${res.status}`;
    throw new Error(`Gemini gaf een fout: ${String(m).slice(0, 400)}`);
  }

  const base64 = vindBeeld(data);
  if (!base64) {
    // Geen stille lege afbeelding: laat zien wát er dan wel terugkwam.
    throw new Error(
      `Geen beelddata gevonden in het antwoord. Toplevel-sleutels: ${Object.keys(data).join(", ") || "(geen)"}. ` +
      `Eerste 300 tekens: ${tekst.slice(0, 300)}`
    );
  }

  const map = uitvoerMap();
  const naam = veiligeNaam(bestandsnaam ?? `beeld-${Date.now()}`) + ".jpg";
  const pad = resolve(map, naam);
  await mkdir(dirname(pad), { recursive: true });
  await writeFile(pad, Buffer.from(base64, "base64"));
  return { pad, bytes: Buffer.byteLength(base64, "base64") };
}

/** De gedocumenteerde plekken, in volgorde van specifiek naar algemeen. */
function vindBeeld(data) {
  if (typeof data?.output_image?.data === "string") return data.output_image.data;
  for (const stap of data?.steps ?? []) {
    for (const deel of stap?.content ?? []) {
      if (typeof deel?.data === "string" && deel.data.length > 100) return deel.data;
      if (typeof deel?.inline_data?.data === "string") return deel.inline_data.data;
    }
  }
  // De klassieke generateContent-vorm, voor het geval de API daarop terugvalt.
  for (const kandidaat of data?.candidates ?? []) {
    for (const deel of kandidaat?.content?.parts ?? []) {
      if (typeof deel?.inlineData?.data === "string") return deel.inlineData.data;
    }
  }
  return null;
}

function veiligeNaam(s) {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "beeld";
}

// ── De MCP-laag ────────────────────────────────────────────────────────────
// JSON-RPC 2.0 over stdin/stdout, één bericht per regel. Berichten zonder id zijn notificaties
// en krijgen géén antwoord — daar een antwoord op sturen laat strengere clients afhaken.

const TOOLS = [
  {
    name: "generate_image",
    description:
      "Genereer een afbeelding met Google's Nano Banana Pro (gemini-3-pro-image). Schrijft de afbeelding naar schijf " +
      "en geeft het pad terug. Gebruik dit voor elk verzoek om een afbeelding, illustratie, mockup of visual.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Wat er op de afbeelding moet staan. Wees specifiek over stijl, compositie en eventuele tekst in beeld." },
        model: { type: "string", enum: ["pro", "flash"], description: "pro = gemini-3-pro-image (beste kwaliteit, 4K, leesbare tekst in beeld). flash = sneller en goedkoper. Standaard pro." },
        aspect_ratio: { type: "string", enum: VERHOUDING, description: "Beeldverhouding. Standaard 1:1." },
        image_size: { type: "string", enum: MAAT, description: "1K, 2K of 4K. Standaard 2K." },
        bestandsnaam: { type: "string", description: "Optionele bestandsnaam zonder extensie." },
      },
      required: ["prompt"],
    },
  },
];

function stuur(bericht) {
  process.stdout.write(JSON.stringify(bericht) + "\n");
}

function resultaat(id, result) {
  stuur({ jsonrpc: "2.0", id, result });
}

function fout(id, code, message) {
  stuur({ jsonrpc: "2.0", id, error: { code, message } });
}

async function behandel(bericht) {
  const { id, method, params } = bericht;
  const isNotificatie = id === undefined || id === null;

  switch (method) {
    case "initialize":
      // De protocolversie van de client teruggeven in plaats van een eigen versie op te dringen:
      // deze server heeft geen versie-afhankelijk gedrag, en een hardgecodeerde datum die achter
      // gaat lopen zou nieuwere clients onnodig laten afhaken.
      resultaat(id, {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "nano-banana", version: "1.0.0" },
      });
      return;

    case "notifications/initialized":
    case "notifications/cancelled":
      return; // notificatie: geen antwoord

    case "tools/list":
      resultaat(id, { tools: TOOLS });
      return;

    case "tools/call": {
      const naam = params?.name;
      if (naam !== "generate_image") {
        fout(id, -32602, `Onbekende tool: ${naam}`);
        return;
      }
      try {
        const { pad, bytes } = await genereer(params?.arguments ?? {});
        // Het pad terug, niet de bytes: een 4K-jpeg als base64 in het antwoord vult het
        // contextvenster van de agent met iets wat hij toch niet leest.
        resultaat(id, {
          content: [{ type: "text", text: `Afbeelding opgeslagen: ${pad} (${Math.round(bytes / 1024)} kB)` }],
        });
      } catch (e) {
        // Als tool-fout terug, niet als protocolfout: de agent moet hem kunnen lezen en erop reageren.
        resultaat(id, { content: [{ type: "text", text: `Beeldgeneratie mislukt: ${e.message}` }], isError: true });
      }
      return;
    }

    case "ping":
      resultaat(id, {});
      return;

    default:
      if (!isNotificatie) fout(id, -32601, `Onbekende methode: ${method}`);
  }
}

let buffer = "";
// Lopende aanvragen meetellen. Een beeldgeneratie duurt seconden, en zonder deze telling sluit
// het proces bij het einde van stdin terwijl het antwoord nog onderweg is — dan komt er niets
// terug en lijkt dat op stilte in plaats van op een fout. Dat gebeurde bij de eerste test van
// dit bestand: een pipe sluit zijn kant meteen, een echte MCP-client houdt stdin open.
let lopend = 0;
let stdinKlaar = false;

function misschienAfsluiten() {
  if (stdinKlaar && lopend === 0) process.exit(0);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (stuk) => {
  buffer += stuk;
  let grens;
  while ((grens = buffer.indexOf("\n")) >= 0) {
    const regel = buffer.slice(0, grens).trim();
    buffer = buffer.slice(grens + 1);
    if (!regel) continue;
    let bericht;
    try {
      bericht = JSON.parse(regel);
    } catch {
      continue; // onleesbare regel overslaan; de stroom is verder prima
    }
    lopend += 1;
    behandel(bericht)
      .catch((e) => {
        if (bericht?.id != null) fout(bericht.id, -32603, String(e?.message ?? e));
      })
      .finally(() => {
        lopend -= 1;
        misschienAfsluiten();
      });
  }
});
process.stdin.on("end", () => {
  stdinKlaar = true;
  misschienAfsluiten();
});
