import type { Indicator } from "./catalogue.js";

type Rating = 1 | 2 | 3 | 4 | 5;
export interface AuditBinding {
  item: number;
  scores: {
    coverage: Rating;
    comparability: Rating;
    reliability: Rating;
    frequency: Rating;
    history: Rating;
    accessibility: Rating;
  };
  reportedOverall: string;
  qualification: string;
}
export const PILOT_AUDIT_BINDINGS = {
  container_throughput: {
    item: 6,
    scores: {
      coverage: 4,
      comparability: 3,
      reliability: 3,
      frequency: 4,
      history: 3,
      accessibility: 4,
    },
    reportedOverall: "3.50",
    qualification:
      "Audit combines UNCTAD throughput and estimated PortWatch activity. Pilot uses daily PortWatch tonnage; it is not UNCTAD TEU. Audit coverage is provisional; publication cadence and reference frequency differ.",
  },
  residential_property_price_real: {
    item: 17,
    scores: {
      coverage: 3,
      comparability: 3,
      reliability: 4,
      frequency: 2,
      history: 4,
      accessibility: 4,
    },
    reportedOverall: "3.25",
    qualification:
      "Pilot uses BIS real index levels. Audit notes national-method differences and provisional historical depth; neither rating establishes a preferred economic direction.",
  },
  gdp_real_volume: {
    item: 21,
    scores: {
      coverage: 2,
      comparability: 3,
      reliability: 4,
      frequency: 2,
      history: 5,
      accessibility: 4,
    },
    reportedOverall: "3.10",
    qualification:
      "Audit reviews OECD vintages and ALFRED, not a global interchangeable series. Pilot uses OECD quarterly real volumes and monthly edition identities. A monthly edition is not a monthly GDP observation.",
  },
  cpi_core_yoy: {
    item: 22,
    scores: {
      coverage: 3,
      comparability: 2,
      reliability: 4,
      frequency: 3,
      history: 5,
      accessibility: 4,
    },
    reportedOverall: "3.30",
    qualification:
      "Audit country checks use World Bank headline CPI, not proof of core CPI availability. Pilot uses OECD core YoY series, monthly except NZ quarterly. Definitions and historical depth require series-specific evidence.",
  },
  unemployment_rate: {
    item: 23,
    scores: {
      coverage: 5,
      comparability: 4,
      reliability: 4,
      frequency: 2,
      history: 5,
      accessibility: 5,
    },
    reportedOverall: "4.15",
    qualification:
      "Audit describes global World Bank/ILO modelled data with annual limitations; pilot uses OECD monthly data, NZ quarterly. Preserve the reported provisional score; do not apply it as the pilot's cadence or record confidence.",
  },
  policy_rate: {
    item: 24,
    scores: {
      coverage: 3,
      comparability: 4,
      reliability: 5,
      frequency: 5,
      history: 5,
      accessibility: 4,
    },
    reportedOverall: "4.20",
    qualification:
      "Audit covers daily/monthly BIS policy rates; pilot selects monthly observations and maps euro members to a shared rate. Policy instruments are not equivalent to overnight interbank rates.",
  },
} as const satisfies Record<Indicator, AuditBinding>;
