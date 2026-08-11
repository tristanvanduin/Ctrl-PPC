"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

// The only piece of the marketing shell that needs client-side state: whether the mobile menu is
// open. Split out of app/(marketing)/layout.tsx (audit, 11 August 2026) -- the whole layout
// (header, desktop nav, footer) was "use client" for this one useState, which meant every
// marketing page shipped and hydrated the full shell's JS just to support a hamburger toggle that
// most sessions never touch. The layout itself is a Server Component now; this is the one client
// island inside it.
//
// The toggle button was a 32px square (p-2 around a 16px icon) -- below the 44px minimum tap
// target. Same audit pass, fixed here alongside the extraction.
//
// The dropdown panel is `absolute`, not a document-flow sibling of the header's inner flex row
// like the original markup had it. That is a consequence of the split: this component renders the
// button and the panel together (they share the `open` state), but the button lives deep inside
// the header's flex row while the panel needs to span the header's full width below it. Absolute
// positioning off the sticky header (which establishes a containing block on its own, same as
// `relative` would) reproduces the original layout without needing the two pieces to sit at
// matching DOM depths.

export function MobileNav({ links }: { links: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? "Menu sluiten" : "Menu openen"}
        className="flex h-11 w-11 items-center justify-center rounded-[6px] border border-off-white/15 text-off-white sm:hidden"
      >
        {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>

      {open && (
        <nav className="absolute inset-x-0 top-full border-t border-off-white/10 bg-midnight-slate px-6 py-3 sm:hidden">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block py-2.5 text-sm font-medium text-off-white/80 hover:text-off-white"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}
