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

## Twee lijsten die niet hetzelfde zijn

Dit werd in een eerdere versie van dit document door elkaar gehaald, en het is precies het soort
verwarring dat een beveiligingsinstelling te ruim maakt.

**De doorverwijslijst** staat in `lib/domein.ts`: welke domeinen naar het canonieke domein gaan.
`localhost` staat daar **niet** in en hoort daar nooit in te staan — de test legt dat vast.

**De toegestane-bestemmingenlijst** staat bij Supabase: waarheen een e-maillink iemand mág sturen
na het klikken. Elke regel daarin is een bestemming waar een inloglink kan uitkomen. Hoe korter,
hoe beter.

---

## Wat er NU moet — zolang er geen hosting is

De app draait op dit moment nergens anders dan op een ontwikkelmachine. Zet Site URL dus nog
**niet** op `ctrlppc.com`: dan wijzen alle uitnodigings- en herstelmails naar een domein waar
niets staat.

In Supabase, **Authentication → URL Configuration**:

```
Site URL       http://localhost:3000

Redirect URLs  http://localhost:3000/**
               https://ctrlppc.com/**
               https://www.ctrlppc.com/**
               https://ctrlppc.nl/**
               https://www.ctrlppc.nl/**
```

De vier domeinregels doen vandaag niets — er resolvet nog niets — maar ze staan er alvast zodat
de omschakeling straks één veld is in plaats van vijf.

**Nodig ook niemand uit zolang dit zo staat.** De link in die mail wijst naar `localhost:3000`, en
dat is de machine van de ontvanger, niet de jouwe. Dat werkt dus voor niemand behalve jezelf.

---

## Wat er STRAKS moet — zodra de app ergens draait

Twee wijzigingen, in deze volgorde:

1. Site URL naar `https://ctrlppc.com`
2. `http://localhost:3000/**` uit de Redirect URLs halen

Die tweede is de belangrijke, en om precies de reden waarom hij nu wél mag: het is een toegestane
bestemming voor een inloglink. Zolang jij de enige gebruiker bent is dat een risico dat je zelf
draagt. Zodra er klanten op zitten niet meer.

---

## Wat met de hand moet — DNS en hosting

Er is nog geen hosting. Zodra die er is:

- `ctrlppc.com` en `www.ctrlppc.com` naar de applicatie.
- `ctrlppc.nl` en `www.ctrlppc.nl` naar **dezelfde applicatie**, niet naar een doorverwijzing bij
  de registrar. De doorverwijzing zit in de app en behoudt daarmee het pad; een registrar-redirect
  gooit dat meestal weg, en dan komt iemand met een gedeelde klantlink alsnog op de voorpagina.
- HTTPS op alle vier, anders volgt er een extra doorverwijzing vóór de onze.

---

## Nog niet gedaan

De uitnodigingsflow is nog nooit live gedraaid — de mail, de link, de wachtwoordkeuze en de
terugkeer naar de app. Dat staat ook als aantekening bovenaan `app/api/admin/users/route.ts`. Dat
kan pas getoetst worden als de bovenstaande instellingen staan én er een adres is waar de app
draait.
