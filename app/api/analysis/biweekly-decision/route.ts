// Skeleton naast de legacy-route app/api/analysis/biweekly/route.ts
// (die blijft ongewijzigd; deze route komt ernaast, met een eigen padsegment). Zie
// lib/decision/decision-skeleton.ts voor de logica en wat deze route bewust niet doet.

import type { NextRequest } from "next/server";
import { handleDecisionSkeleton } from "@/lib/decision/decision-skeleton";

export async function POST(request: NextRequest) {
  return handleDecisionSkeleton(request, "biweekly");
}
