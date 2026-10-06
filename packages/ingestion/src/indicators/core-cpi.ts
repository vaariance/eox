import type { OecdRoute } from "./sdmx-series.js";

const CORE_CPI_KEY = "CPI.PA._TXCP01_NRG.N.GY";

export function coreCpiMonthlyRoutes(startYear: string): OecdRoute[] {
  return [
    {
      dataflow: "OECD.SDD.TPS,DSD_PRICES_COICOP2018@DF_PRICES_C2018_N_TXCP01_NRG,1.0",
      keySuffix: `M.N.${CORE_CPI_KEY}`,
      startPeriod: `${startYear}-01`,
    },
    {
      dataflow: "OECD.SDD.TPS,DSD_PRICES@DF_PRICES_N_TXCP01_NRG,1.0",
      keySuffix: `M.N.${CORE_CPI_KEY}`,
      startPeriod: `${startYear}-01`,
    },
  ];
}

export function coreCpiQuarterlyRoutes(startYear: string): OecdRoute[] {
  return [
    {
      dataflow: "OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0",
      keySuffix: `Q.N.${CORE_CPI_KEY}`,
      startPeriod: `${startYear}-Q1`,
    },
  ];
}
