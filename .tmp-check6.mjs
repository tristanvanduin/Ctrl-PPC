import { chromium } from "playwright-core";
const S = "/tmp/claude-0/-home-user-Dashboard/c63fa507-ca25-548a-960a-a8bfa6a9f47a/scratchpad";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 1500, height: 1200 } });
for (const k of ["Google Ads", "Meta", "LinkedIn"]) {
  await p.goto("http://localhost:3100/client/demo-greentech?demo=1", { waitUntil: "domcontentloaded", timeout: 180000 });
  await p.waitForTimeout(5000);
  await p.getByRole("button", { name: k, exact: true }).first().click();
  await p.waitForTimeout(3000);
  const r = await p.evaluate(() => {
    const g = [...document.querySelectorAll("div.grid")].find(x => x.className.includes("xl:grid-cols-2") && x.children.length === 2);
    if (!g) return null;
    return [...g.children].map((kol, i) => {
      const kr = kol.getBoundingClientRect();
      const l = kol.children[kol.children.length-1]?.getBoundingClientRect();
      return { kol: i ? "R" : "L", ongebruikt: l ? Math.round(kr.bottom - l.bottom) : 0,
               kaarten: [...kol.children].map(c => (c.textContent||"").trim().slice(0,26).replace(/\s+/g," ")) };
    });
  });
  console.log(`\n=== ${k} ===`);
  for (const kol of (r||[])) console.log(`  [${kol.kol}] ongebruikt ${kol.ongebruikt}px | ${JSON.stringify(kol.kaarten)}`);
  if (k !== "Google Ads") {
    const h = await p.$('div.grid[class*="xl:grid-cols-2"]');
    if (h) await h.screenshot({ path: `${S}/def-${k}.png` });
  }
}
await b.close();
