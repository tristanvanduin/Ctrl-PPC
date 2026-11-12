// Het script dat vóór de eerste verf zegt of de chrome rond een klantpagina de nieuwe weergave
// volgt (bouwplan fase 6). De reden staat in lib/weergave.ts, bij chromeIsNieuw; dit bestand is er
// alleen omdat dat bestand zuiver hoort te blijven (geen window, geen document), en een script voor
// de <head> bestaat uit niets anders.

import { CHROME_ATTRIBUUT, KLANTPAD, STANDAARD_WEERGAVE, WEERGAVE_PARAM, WEERGAVE_SLEUTEL } from "./weergave";

/**
 * Dezelfde regel als chromeIsNieuw, als script voor de <head>: het pad, dan ?weergave=, dan
 * localStorage, dan de cookie, en zonder keuze de standaard uit lib/weergave.ts (STANDAARD_WEERGAVE,
 * niet hier nog eens uitgeschreven). Als string omdat het vóór React moet draaien. De test voert dit
 * script uit tegen nagemaakte `location`, `localStorage` en `document` en legt de uitkomst naast
 * chromeIsNieuw: de twee mogen niet uiteenlopen.
 */
export const WEERGAVE_INIT_SCRIPT = `(function(){try{
  if(location.pathname.indexOf(${JSON.stringify(KLANTPAD)})!==0)return;
  var g=function(v){return v==="nieuw"||v==="oud"?v:null};
  var u=g(new URLSearchParams(location.search).get(${JSON.stringify(WEERGAVE_PARAM)}));
  var b=null;try{b=g(localStorage.getItem(${JSON.stringify(WEERGAVE_SLEUTEL)}));}catch(e){}
  if(!b){var c=document.cookie.split("; ");for(var i=0;i<c.length;i++){if(c[i].indexOf(${JSON.stringify(WEERGAVE_SLEUTEL + "=")})===0){b=g(c[i].slice(${WEERGAVE_SLEUTEL.length + 1}));}}}
  if((u||b||${JSON.stringify(STANDAARD_WEERGAVE)})==="nieuw"){document.documentElement.setAttribute(${JSON.stringify(CHROME_ATTRIBUUT)},"nieuw");}
}catch(e){}})();`;
