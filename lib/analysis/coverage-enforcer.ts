import {
  checkSopCoverage,
  type CoverageDimension,
  type IssueCluster,
  type SopCoverage,
} from "@/lib/analysis/canonicalize";

export interface CoverageEnforcementResult {
  coverage: SopCoverage[];
  surfacedDimensions: CoverageDimension[];
  missingAvailableDimensions: CoverageDimension[];
  unavailableDimensions: CoverageDimension[];
  traceabilityOk: boolean;
}

/**
 * Stopgap voor kanalen zonder een eigen, kloppende dimensielijst (vandaag: Meta, LinkedIn --
 * COVERAGE_DIMENSION_DEFINITIONS in canonicalize.ts is één gedeelde, Google-vormige lijst, geen
 * van beide heeft daar een eigen equivalent voor). Zonder een echte per-kanaal dataherkenning
 * (zoals buildCoverageDimensionAvailability() dat voor Google doet) bleef elke dimensie op
 * "data_unavailable" staan -- ook als er wél clusters op die dimensie waren gevonden, wat een
 * concrete tegenstrijdigheid opleverde ("account": data_unavailable met findings_surfaced: 7).
 *
 * Leidt beschikbaarheid af uit wat de clusters zelf al aantoonbaar raakten. Geen vervanging voor
 * een echte per-kanaal dimensielijst -- een dimensie zonder enig cluster blijft "data_unavailable"
 * staan, ook als er in werkelijkheid wel data was maar er niets noemenswaardigs uit kwam. Voorkomt
 * wel de concrete leugen: nooit meer "geen data" naast een reeks bevindingen op diezelfde dimensie.
 */
export function deriveDimensionAvailabilityFromClusters(
  clusters: IssueCluster[]
): Partial<Record<CoverageDimension, boolean>> {
  const availability: Partial<Record<CoverageDimension, boolean>> = {};
  for (const cluster of clusters) {
    for (const dimension of cluster.coverage_dimensions) availability[dimension] = true;
  }
  return availability;
}

export function enforceSopCoverage(
  clusters: IssueCluster[],
  dimensionAvailability: Partial<Record<CoverageDimension, boolean>>
): CoverageEnforcementResult {
  const coverage = checkSopCoverage(clusters, dimensionAvailability);
  const surfacedDimensions = coverage
    .filter((row) => row.status === "covered")
    .map((row) => row.dimension);
  const missingAvailableDimensions = coverage
    .filter((row) => row.status === "no_signal" && row.data_available)
    .map((row) => row.dimension);
  const unavailableDimensions = coverage
    .filter((row) => row.status === "data_unavailable")
    .map((row) => row.dimension);

  const traceabilityOk = coverage.every((row) => {
    if (row.status !== "covered") return true;
    return row.surfaced_cluster_ids.every((clusterId) => clusters.some((cluster) => cluster.cluster_id === clusterId));
  });

  return {
    coverage,
    surfacedDimensions,
    missingAvailableDimensions,
    unavailableDimensions,
    traceabilityOk,
  };
}
