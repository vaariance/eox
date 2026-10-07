export const COUNTRIES = [
  ["AUS", "AU"], ["BEL", "BE"], ["CAN", "CA"], ["CHL", "CL"], ["COL", "CO"],
  ["DEU", "DE"], ["DNK", "DK"], ["ESP", "ES"], ["EST", "EE"], ["FIN", "FI"],
  ["FRA", "FR"], ["GBR", "GB"], ["GRC", "GR"], ["IRL", "IE"], ["ISL", "IS"],
  ["ISR", "IL"], ["ITA", "IT"], ["JPN", "JP"], ["KOR", "KR"], ["LTU", "LT"],
  ["LVA", "LV"], ["MEX", "MX"], ["NLD", "NL"], ["NOR", "NO"], ["NZL", "NZ"],
  ["PRT", "PT"], ["SVN", "SI"], ["SWE", "SE"], ["TUR", "TR"], ["USA", "US"],
] as const;
export type Country = typeof COUNTRIES[number][0];
export type Frequency = "daily" | "monthly" | "quarterly";
export const INDICATORS = [
  "container_throughput", "residential_property_price_real", "gdp_real_volume",
  "cpi_core_yoy", "unemployment_rate", "policy_rate",
] as const;
export type Indicator = typeof INDICATORS[number];
export interface SeriesDescriptor { country: Country; indicator: Indicator; source: string; unit: string; frequency: Frequency }
const DEFINITIONS: Record<Indicator, { source: string; unit: string; frequency: Frequency }> = {
  container_throughput: { source: "imf-portwatch", unit: "metric_tonnes", frequency: "daily" },
  residential_property_price_real: { source: "bis", unit: "index_2010_100", frequency: "quarterly" },
  gdp_real_volume: { source: "oecd", unit: "national_currency_millions", frequency: "quarterly" },
  cpi_core_yoy: { source: "oecd", unit: "percent", frequency: "monthly" },
  unemployment_rate: { source: "oecd", unit: "percent", frequency: "monthly" },
  policy_rate: { source: "bis", unit: "percent", frequency: "monthly" },
};
export function seriesDescriptor(country: Country, indicator: Indicator): SeriesDescriptor {
  if (!COUNTRIES.some(([id]) => id === country)) throw new Error("UnknownCountry");
  if (!INDICATORS.includes(indicator)) throw new Error("UnknownIndicator");
  const definition = DEFINITIONS[indicator];
  const quarterly = country === "NZL" && (indicator === "cpi_core_yoy" || indicator === "unemployment_rate");
  return { country, indicator, ...definition, frequency: quarterly ? "quarterly" : definition.frequency };
}
export const CATALOGUE = COUNTRIES.flatMap(([country]) => INDICATORS.map(indicator => seriesDescriptor(country, indicator)));
