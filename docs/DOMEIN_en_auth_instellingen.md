# Domein en auth-instellingen

`ctrlppc.com` is canoniek. `ctrlppc.nl` verwijst erheen.

Wat in de code staat, staat in `lib/domein.ts` — één plek, met een test ernaast
(`lib/__domein_test.ts`, 17 controles). Wat **niet** in de code kan, staat hieronder: dat zijn
instellingen bij de hostingpartij en bij Supabase, en die moet iemand met de hand zetten.

---

## Waarom dit meer is dan netjes

Sessiecookies horen bij één domein. Logt iemand in op `.nl` en komt hij daarna op `.com`, dan is
zijn sessie weg — zonder foutmelding, want er is niets misgegaan: de cookie hoort gewoon bij een
ander domein. De doorverwijzing vooraan in de middleware zorgt dat er maar één domein is waarop
iemand ingelogd kan raken.

Dezelfde reden geldt voor de uitnodigings- en herstelmail. Supabase zet in die mail een link naar
de URL die in zijn eigen configuratie staat. Staat daar het verkeerde domein, dan klikt iemand op
een link in zijn mailbox en belandt op een foutpagina — en dat is precies het moment waarop een
nieuwe gebruiker zijn eerste indruk krijgt.

---

## Wat er in de code is geregeld

| | |
|---|---|
| doorverwijzing `.nl` → `.com` | `middleware.ts`, bovenaan, met een 308 |
| pad, zoekparameters en fragment blijven staan | `canoniekeDoelUrl()` in `lib/domein.ts` |
| `http` wordt `https` | idem — anders volgt er een tweede doorverwijzing en komt de cookie niet mee |
| `metadataBase` en canonical-tag | `app/layout.tsx` |

De doorverwijzing staat **boven** de auth-afslag in de middleware. Dat is met opzet: het is een
domeinkwestie en geen authkwestie, en zolang `O1_AUTH_ENFORCED` uit staat zou hij anders helemaal
niet werken.

Wat er bewust **niet** doorverwezen wordt: localhost, `127.0.0.1`, en de deploy-URL's van het
hostingplatform. Een doorverwijzing die "alles wat niet canoniek is" pakt, maakt elke
voorvertoning onbruikbaar — je opent een preview-link en staat op productie zonder dat te zien.
De test legt dat expliciet vast.

---

## Wat met de hand moet — Supabase

Deze staan in het Supabase-dashboard onder **Authentication → URL Configuration**. Ik kan ze niet
lezen of zetten: het access token in deze omgeving mag wel SQL draaien maar geen projectconfiguratie
benaderen (403 op `/v1/projects/{ref}/config/auth`).

**Site URL**

```
https://ctrlppc.com
```

Dit is waar Supabase naartoe wijst in de uitnodigings- en herstelmail als er geen expliciete
`redirectTo` is meegegeven.

**Redirect URLs** (de toegestane lijst)

```
https://ctrlppc.com/**
https://www.ctrlppc.com/**
https://ctrlppc.nl/**
https://www.ctrlppc.nl/**
http://localhost:3000/**
```

De `.nl`-varianten horen erin ook al verwijzen ze door: iemand die op een oude link klikt komt
eerst daar binnen, en als dat adres niet is toegestaan weigert Supabase het vóórdat de
doorverwijzing kan werken.

`localhost` staat erin voor ontwikkeling. Haal hem eruit zodra er echt klanten op zitten — het is
een toegestane bestemming voor een inloglink, en dat is een bestemming te veel.

---

## Wat met de hand moet — DNS en hosting

- `ctrlppc.nl` en `www.ctrlppc.nl` moeten naar dezelfde applicatie wijzen. De doorverwijzing zit
  in de app, dus het domein moet er wél op uitkomen. Een doorverwijzing bij de registrar werkt
  ook, maar dan verliest hij meestal het pad — en dan komt iemand met een gedeelde klantlink op
  de voorpagina uit.
- `www.ctrlppc.com` idem.
- HTTPS op alle vier, anders volgt er een extra doorverwijzing vóór de onze.

---

## Nog niet gedaan

De uitnodigingsflow is nog nooit live gedraaid — de mail, de link, de wachtwoordkeuze en de
terugkeer naar de app. Dat staat ook als aantekening bovenaan `app/api/admin/users/route.ts`. Dat
kan pas getoetst worden als de bovenstaande instellingen staan én er een adres is waar de app
draait.
