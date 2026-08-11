// The glowing "Request a demo" button. Was copied byte-for-byte between app/(marketing)/page.tsx
// and app/(marketing)/vs/page.tsx -- same markup, same inline style object, same class string
// (audit, 11 August 2026). One component instead of two copies that will drift the next time
// either page's CTA needs a tweak.

export function PrimaryCta({
  children = "Request a demo",
  href = "/demo",
}: {
  children?: React.ReactNode;
  href?: string;
}) {
  return (
    <a
      href={href}
      className="rounded-[6px] px-7 py-3.5 text-sm font-semibold text-midnight-slate transition-transform hover:scale-[1.02]"
      style={{ backgroundColor: "#818cf8", boxShadow: "var(--glow-neon-indigo-cta)" }}
    >
      {children}
    </a>
  );
}
