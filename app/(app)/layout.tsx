import { Ubuntu } from "next/font/google";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { SopDekkingBanner } from "@/components/layout/sop-dekking-banner";
import { DatastandBanner } from "@/components/layout/datastand-banner";
import { SidebarMobileProvider } from "@/components/layout/sidebar-mobile-context";
import { SidebarBackdrop } from "@/components/layout/sidebar-backdrop";

const ubuntu = Ubuntu({
  variable: "--font-ubuntu",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
});

// De ingelogde dashboard-chrome: vaste zijbalk + bovenbalk, ongewijzigd overgenomen uit de
// vroegere root-layout (Fase 7 splitste hem hiernaartoe, zie app/layout.tsx). Alles onder
// app/(app)/ deelt deze chrome; de marketingpagina's en /login zitten in app/(marketing)/ en
// zien deze layout nooit.
//
// Sectie 13.2, fase 3 (16 augustus): de zijbalk was tot hier `w-72` + `ml-72`, ONVOORWAARDELIJK
// -- op een smal scherm bleef 288px van de 390px beschikbare breedte aan de zijbalk hangen en de
// content was letterlijk afgekapt (zie de mobiele screenshot uit de pilot). `ml-72` wordt nu
// `lg:ml-72`: op een smal scherm schuift er niets meer opzij, de zijbalk ligt daar los OVER de
// content (fixed, hoge z-index, standaard buiten beeld via sidebar.tsx's transform) en komt pas
// tevoorschijn via de hamburger-knop in de TopBar. SidebarMobileProvider is de gedeelde
// open/dicht-status tussen die knop en het paneel; SidebarBackdrop is het donkere vlak
// eronder zodra het paneel openstaat.
export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <SidebarMobileProvider>
      <div className={`${ubuntu.variable} flex min-h-screen`}>
        <Sidebar />
        <SidebarBackdrop />
        {/* min-w-0 is niet decoratief: zonder deze regel mag een flex-item met flex-1 niet
            krimpen onder het min-content van zijn INHOUD (browserstandaard), en duwde de
            TopBar's eigen inhoud (titel + iconen die zelf niet meer inkrimpen) deze hele kolom
            -- en daarmee header EN main -- breder dan de viewport. Op 390px verklaarde dat 57px
            horizontale overflow die met losse aanpassingen aan TopBar niet wegging: de oorzaak
            zat hier, niet daar. */}
        <div className="flex min-h-screen min-w-0 flex-1 flex-col lg:ml-72">
          <TopBar />
          <SopDekkingBanner />
          <DatastandBanner />
          {/* max-w + mx-auto: zonder maximumbreedte rekt de inhoud oneindig mee met het venster.
              Gemeten op een uitgezoomd/breed scherm: bij een effectieve viewport van 3840px werd de
              content 3552px breed, en dan verliezen de verhoudingen het -- KPI-kaarten worden
              meters breed, tekstregels onleesbaar lang, en een 2-koloms raster zet twee kaarten van
              1700px naast elkaar. Uitzoomen vergroot precies die effectieve viewport, dus het brak
              exact daar waar de eigenaar het zag.

              2560px en niet 1920px: met 1920 hield een 1440p-monitor (2560px breed, 2272px na de
              sidebar) al 352px marge over, en dat leest als een smalle strook op een breed scherm --
              precies de klacht na de eerste poging. Met 2560 vult zo'n monitor volledig en verschijnt
              de marge pas daarboven: bij 4K, of bij uitzoomen.

              Dit blijft een afweging, geen exacte grens. Ver uitzoomen (25%) maakt de effectieve
              viewport zo groot dat de inhoud hoe dan ook een eiland in het midden wordt; de enige
              andere optie is oneindig uitrekken, en dat gaf kaarten van 2864px. Er is geen instelling
              die beide uitersten tegelijk goed doet -- 2560px houdt elk realistisch scherm heel en
              accepteert marge bij extreme zoom. */}
          <main className="mx-auto w-full max-w-[2560px] flex-1 p-6">{children}</main>
        </div>
      </div>
    </SidebarMobileProvider>
  );
}
