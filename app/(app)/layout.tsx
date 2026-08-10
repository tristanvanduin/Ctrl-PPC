import { Ubuntu } from "next/font/google";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";

const ubuntu = Ubuntu({
  variable: "--font-ubuntu",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
});

// De ingelogde dashboard-chrome: vaste zijbalk + bovenbalk, ongewijzigd overgenomen uit de
// vroegere root-layout (Fase 7 splitste hem hiernaartoe, zie app/layout.tsx). Alles onder
// app/(app)/ deelt deze chrome; de marketingpagina's en /login zitten in app/(marketing)/ en
// zien deze layout nooit.
export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className={`${ubuntu.variable} flex min-h-screen`}>
      <Sidebar />
      <div className="ml-72 flex min-h-screen flex-1 flex-col">
        <TopBar />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
