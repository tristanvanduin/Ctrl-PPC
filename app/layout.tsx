import type { Metadata } from "next";
import { Ubuntu, Open_Sans } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { THEMA_INIT_SCRIPT } from "@/components/ui/thema-schakelaar";
import "./globals.css";

const ubuntu = Ubuntu({
  variable: "--font-ubuntu",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
});

const openSans = Open_Sans({
  variable: "--font-open-sans",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "RAI Amsterdam — SEA Dashboard",
  description: "Revenue & Conversie Forecasting Dashboard voor het SEA-team",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="nl"
      className={`${ubuntu.variable} ${openSans.variable} h-full antialiased`}
    >
      <head>
        {/* Vóór React en vóór de eerste verf: anders laadt de pagina in het licht en klapt hij een
            fractie later om. Die witte flits op een donker scherm is precies het moment waarop een
            product er goedkoop uitziet. */}
        <script dangerouslySetInnerHTML={{ __html: THEMA_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex">
        <TooltipProvider>
          <Sidebar />
          <div className="flex-1 flex flex-col min-h-screen ml-72">
            <TopBar />
            <main className="flex-1 p-6">
              {children}
            </main>
          </div>
        </TooltipProvider>
      </body>
    </html>
  );
}
