import type { OecdRoute } from "./sdmx-series.js";

const UNEMPLOYMENT_KEY = "PT_LF_SUB._Z.Y._T.Y_GE15._Z";

export function unemploymentMonthlyRoutes(startYear: string): OecdRoute[] {
  return [
    {
      dataflow: "OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0",
      keySuffix: `UNE_LF_M.${UNEMPLOYMENT_KEY}.M`,
      startPeriod: `${startYear}-01`,
    },
  ];
}

export function unemploymentQuarterlyRoutes(startYear: string): OecdRoute[] {
  return [
    {
      dataflow: "OECD.SDD.TPS,DSD_LFS@DF_IALFS_INDIC,1.0",
      keySuffix: `UNE_LF.${UNEMPLOYMENT_KEY}.Q`,
      startPeriod: `${startYear}-Q1`,
    },
  ];
}
