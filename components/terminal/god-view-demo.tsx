import { GodMode } from "./god-mode";
import { PortfolioSynthesisCard } from "./agency-god-view";

// Demo-landing voor wie geen sessie heeft maar wel ?demo=1 meegeeft (app/(app)/vandaag/page.tsx).
// Combineert de twee stukken die veilig demo-baar zijn gemaakt (lib/demo/god-view-demo.ts, beide
// componenten checken zelf isDemoMode() en slaan de echte fetch dan over): God Mode (platform-
// breed, "God View") en de portfolio-synthese (cross-account binnen één bureau). Bewust NIET de
// volledige AgencyGodView hier: die rendert ook de macro-trends-tabel en CodeRoodPaneel, die allebei
// hun eigen, nog niet demo-bewuste fetch hebben -- dat zou alsnog een 401/403 opleveren.
export function GodViewDemo() {
  return (
    <div className="space-y-6">
      <GodMode />
      <PortfolioSynthesisCard />
    </div>
  );
}
