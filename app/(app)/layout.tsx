import { Ubuntu } from "next/font/google";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { SopDekkingBanner } from "@/components/layout/sop-dekking-banner";
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
        <div className="flex min-h-screen flex-1 flex-col lg:ml-72">
          <TopBar />
          <SopDekkingBanner />
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </SidebarMobileProvider>
  );
}
