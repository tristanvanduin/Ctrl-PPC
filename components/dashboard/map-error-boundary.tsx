"use client";

import { Component, type ReactNode } from "react";

// De kaarten zijn zware, los geladen chunks (geometrie + d3-geo). Als zo'n chunk niet laadt —
// een verouderde deploy, een netwerkhaper — mag dat nooit de hele klantpagina meeslepen; de rest
// van het dashboard blijft dan gewoon bruikbaar en de tabel onder de kaart vertelt het verhaal ook.
// NB: dit vangt runtime-fouten af. Een ontbrekende dependency is een compile-fout en wordt hier
// niet door gered — dan is `npm install` de fix.

interface Props { children: ReactNode }
interface State { failed: boolean }

export class MapErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <p className="text-[12px] text-muted-foreground py-8 text-center">
          De kaart kon niet geladen worden. De uitsplitsing per land staat hieronder in de tabel.
        </p>
      );
    }
    return this.props.children;
  }
}
