# Domein en auth-instellingen

`ctrlppc.com` is canoniek, en sinds 21 augustus 2026 ook echt live (`https://www.ctrlppc.com/`
bevestigd door de eigenaar). `ctrlppc.nl` verwijst erheen.

Wat in de code staat, staat in `lib/domein.ts` — één plek, met een test ernaast
(`lib/__domein_test.ts`, 25 controles). Wat **niet** in de code kan, staat hieronder: dat zijn
instellingen bij de hostingpartij en bij Supabase, en die moet iemand met de hand zetten.

**Update 21 augustus 2026 — twee dingen aan dit document waren achterhaald, hersteld:**

1. De .nl→.com- en www/non-www-doorverwijzing gebeurt niet meer in `middleware.ts`. Die is
   verwijderd na een productie-uitval (`ERR_TOO_MANY_REDIRECTS`): de Vercel-eigen domeinredirect en
   de middleware-redirect stonden allebei tegelijk aan en liepen in een lus. De redirect gebeurt nu
   uitsluitend op Vercel-niveau (project-instellingen → Domains). `lib/domein.ts` bewaart alleen nog
   `CANONIEK_DOMEIN` voor de `canonical`-tag en de `og`-URL's in de metadata — geen redirect-logica
   meer.
2. Sectie "Wat er NU moet" hieronder ging uit van "de app draait nergens anders dan op een
   ontwikkelmachine". Dat is niet meer waar: er is hosting, het domein is live. Die sectie is
   vervangen door de instellingen die nu daadwerkelijk moeten staan — en de aanleiding was geen
   theoretische toets: een collega kreeg een uitnodigingsmail met een link naar `localhost`, exact
   het scenario dat dit document al voorspelde toen die instelling nog bewust op `localhost` stond.

---

## Waarom dit meer is dan netjes

Sessiecookies horen bij één domein. Logt iemand in op `.nl` en komt hij daarna op `.com`, dan is
zijn sessie weg — zonder foutmelding, want er is niets misgegaan: de cookie hoort gewoon bij een
ander domein. De doorverwijzing vooraan in `middleware.ts` zorgt dat er maar één domein is waarop
iemand ingelogd kan raken.

Dezelfde reden geldt voor de uitnodigings- en herstelmail. Supabase zet in die mail een link naar
de URL die in zijn eigen configuratie staat. Staat daar het verkeerde domein, dan klikt iemand op
een link in zijn mailbox en belandt op een foutpagina — en dat is precies het moment waarop een
nieuwe gebruiker zijn eerste indruk krijgt.

---

## Wat er in de code is geregeld

| | |
|---|---|
| doorverwijzing `.nl` → `.com`, `www` → non-`www` | Vercel-project-instellingen (Domains), niet in de code |
| `metadataBase` en canonical-tag | `app/layout.tsx`, met `CANONIEK_DOMEIN` uit `lib/domein.ts` |

`lib/domein.ts` bevat sinds de opruiming hieronder alleen nog de constante `CANONIEK_DOMEIN =
"ctrlppc.com"`, gebruikt voor de canonical-tag en de `og`-URL's. Geen redirect-functie meer — die
zat er eerst wel (`canoniekeDoelUrl()`, hieronder gedocumenteerd zoals hij was), maar is verwijderd.

### Waarom de middleware-redirect is weggehaald (historisch, ter waarschuwing)

De eerste versie deed de `.nl`→`.com`- en `www`-redirect in `middleware.ts`, boven de auth-afslag,
met precies de reden die hieronder nog stond: het is een domeinkwestie en geen authkwestie, en
zolang `O1_AUTH_ENFORCED` uit staat zou hij anders niet werken. Onderweg gefixt: de eerste versie
las `request.url` in plaats van de `host`-header, en Next normaliseert die naar het adres waarop de
server zelf luistert (`http://localhost:3190/…`, ook bij een binnenkomend verzoek met
`Host: ctrlppc.nl`) — geen foutmelding, geen falende test, de regel keek gewoon naar de verkeerde
plek. Dezelfde valkuil als de uitnodigingslink die naar `localhost` bleek te wijzen (zie de
update bovenaan): `request.url` is op een zelf gehoste server niet de host die de bezoeker zag.

**Waarom hij daarna toch weg is, en niet gefixt naar de host-header:** met de Vercel-eigen
domeinredirect (project-instellingen → Domains) én de middleware-redirect allebei actief ontstond
een lus (`ERR_TOO_MANY_REDIRECTS`) — de een stuurde naar het domein dat de ander net had
verworpen. Twee mechanismen voor hetzelfde doel is geen dubbele zekerheid maar een race; opgelost
door er één van te verwijderen, niet door de tweede slimmer te maken. Vercel's eigen redirect is
degene die bleef staan, want die zit al vóór de applicatie en kent geen `O1_AUTH_ENFORCED`-afhankelijkheid.

Wat er bewust **niet** doorverwezen wordt, gold voor de oude middleware-implementatie en geldt
voor de Vercel-configuratie evengoed: localhost, `127.0.0.1`, en de deploy-URL's van het
hostingplatform. Een doorverwijzing die "alles wat niet canoniek is" pakt, maakt elke
voorvertoning onbruikbaar — je opent een preview-link en staat op productie zonder dat te zien.

### En waarom het bestand nog `middleware.ts` heet

Next 16 schaft die naam af ten gunste van `proxy.ts` en waarschuwt daarover bij elke build. De
hernoeming is geprobeerd en teruggedraaid: in 16.2.2 met Turbopack blijft
`.next/server/middleware-manifest.json` leeg bij `proxy.ts` en gevuld bij `middleware.ts` —
terwijl de buildtabel in beide gevallen `ƒ Proxy (Middleware)` meldt. Hernoemen zet de hele
toegangscontrole dus stilzwijgend uit. Bij een volgende Next-versie opnieuw proberen, en dan het
manifest nakijken in plaats van de buildmelding geloven.

---

## Twee lijsten die niet hetzelfde zijn

Dit werd in een eerdere versie van dit document door elkaar gehaald, en het is precies het soort
verwarring dat een beveiligingsinstelling te ruim maakt.

**De doorverwijslijst** staat in `lib/domein.ts`: welke domeinen naar het canonieke domein gaan.
`localhost` staat daar **niet** in en hoort daar nooit in te staan — de test legt dat vast.

**De toegestane-bestemmingenlijst** staat bij Supabase: waarheen een e-maillink iemand mág sturen
na het klikken. Elke regel daarin is een bestemming waar een inloglink kan uitkomen. Hoe korter,
hoe beter.

---

## Wat er nu moet staan — hosting is live (sinds 21 augustus 2026)

De situatie die de twee vorige secties ("NU zolang er geen hosting is" / "STRAKS") voorzagen is
ingetreden: `https://www.ctrlppc.com/` is live, bevestigd door de eigenaar. De "STRAKS"-stap is nu
de eis, niet meer een toekomstige.

In Supabase, **Authentication → URL Configuration**:

```
Site URL       https://ctrlppc.com

Redirect URLs  https://ctrlppc.com/**
               https://www.ctrlppc.com/**
```

`http://localhost:3000/**` mag er niet meer in staan: dat was alleen toegestaan zolang de
eigenaar de enige gebruiker was, en is met een collega die al een uitnodiging kreeg met een
`localhost`-link (21 augustus 2026) een bevestigd, geen theoretisch risico meer. `ctrlppc.nl` en
`www.ctrlppc.nl` hoeven niet in de Redirect URLs: die verwijzen op Vercel-niveau door naar
`ctrlppc.com` vóórdat een auth-link er ooit op uitkomt (zie "Wat met de hand moet" hieronder), dus
Supabase ziet ze nooit als bestemming.

Dit is niet in code te zetten — het is de Supabase-projectconfiguratie zelf — en is bij het
schrijven van deze update nog niet bevestigd doorgevoerd; wie dit leest en het nog niet heeft
gedaan, doet het als eerste voordat er nog een uitnodiging de deur uit gaat.

---

## Wat met de hand moet — DNS en hosting

**Gedaan.** `ctrlppc.com` draait op Vercel. De doorverwijzingen (`www` → non-`www`, `.nl` → `.com`)
staan in de Vercel-projectinstellingen (Domains), niet in de code — zie "Waarom de
middleware-redirect is weggehaald" hierboven voor de reden dat dit niet meer in `middleware.ts`
zit. Nagekeken bij het schrijven van deze update: `https://www.ctrlppc.com/` resolvet. Nog niet
apart geverifieerd vanuit deze sessie (geen browser-toegang tot het live domein): dat de
`.nl`-varianten ook daadwerkelijk naar dezelfde applicatie wijzen en niet naar een
registrar-redirect die het pad weggooit, en dat HTTPS op alle vier de varianten staat. Beide
stonden als vereiste in de vorige versie van deze sectie; ze zijn hier niet stilzwijgend als
"waarschijnlijk goed" aangenomen, maar ook niet bevestigd — navragen bij wie de DNS heeft
ingesteld, of met een eigen curl-check zodra dat vanuit een sessie met netwerktoegang tot het
publieke domein kan.

---

## Nog niet gedaan / net gevonden (21 augustus 2026)

De uitnodigingsflow is voor het eerst echt live gedraaid, en leverde meteen twee bevindingen op —
precies waarom deze paragraaf "nog niet gedaan" heette in plaats van "werkt":

1. **De link in de uitnodigingsmail wees naar `localhost`.** Root cause: de Site
   URL-instelling hierboven stond nog op `localhost`, uit de periode waarin de app nog nergens
   anders draaide. Niet een codefout — `app/api/admin/users/route.ts` berekent zijn `redirectTo`
   correct uit het verzoek zelf. Fix: de Supabase-instelling hierboven, nog niet bevestigd
   doorgevoerd.
2. **`Failed to send magic link ... email rate limit exceeded`** — Supabase's ingebouwde
   e-mailverzending (het gedeelde SMTP-domein dat elk nieuw project standaard krijgt) heeft een
   laag, hard limiet, bedoeld voor testen tijdens ontwikkeling, niet voor echt gebruik. Zodra er
   meerdere collega's uitgenodigd worden of gebruikers regelmatig een magic link/wachtwoordherstel
   aanvragen, loopt dit opnieuw vast. Er is geen eigen SMTP-provider geconfigureerd in dit project
   (niets in `.env.example`, geen vermelding elders in de codebase). Nodig, met de hand in
   Supabase: **Project Settings → Authentication → SMTP Settings**, een eigen provider erin (bv.
   Resend, Postmark, SendGrid — elk met een gratis of goedkope laag die ruim boven Supabase's
   ingebouwde limiet zit) plus een verzendadres op het canonieke domein
   (`noreply@ctrlppc.com` oid.), zodat de afzender ook klopt met wat een ontvanger verwacht. Niet
   hier opgelost — vereist een account bij een e-mailprovider, iets wat de eigenaar moet aanmaken
   en niet iets dat vanuit deze sessie te doen is.
