export interface PilotCountry {
  iso3: string;
  iso2: string;
  name: string;
}

export const PILOT_COUNTRIES: readonly PilotCountry[] = [
  { iso3: "AUS", iso2: "AU", name: "Australia" },
  { iso3: "BEL", iso2: "BE", name: "Belgium" },
  { iso3: "CAN", iso2: "CA", name: "Canada" },
  { iso3: "CHL", iso2: "CL", name: "Chile" },
  { iso3: "COL", iso2: "CO", name: "Colombia" },
  { iso3: "DEU", iso2: "DE", name: "Germany" },
  { iso3: "DNK", iso2: "DK", name: "Denmark" },
  { iso3: "ESP", iso2: "ES", name: "Spain" },
  { iso3: "EST", iso2: "EE", name: "Estonia" },
  { iso3: "FIN", iso2: "FI", name: "Finland" },
  { iso3: "FRA", iso2: "FR", name: "France" },
  { iso3: "GBR", iso2: "GB", name: "United Kingdom" },
  { iso3: "GRC", iso2: "GR", name: "Greece" },
  { iso3: "IRL", iso2: "IE", name: "Ireland" },
  { iso3: "ISL", iso2: "IS", name: "Iceland" },
  { iso3: "ISR", iso2: "IL", name: "Israel" },
  { iso3: "ITA", iso2: "IT", name: "Italy" },
  { iso3: "JPN", iso2: "JP", name: "Japan" },
  { iso3: "KOR", iso2: "KR", name: "South Korea" },
  { iso3: "LTU", iso2: "LT", name: "Lithuania" },
  { iso3: "LVA", iso2: "LV", name: "Latvia" },
  { iso3: "MEX", iso2: "MX", name: "Mexico" },
  { iso3: "NLD", iso2: "NL", name: "Netherlands" },
  { iso3: "NOR", iso2: "NO", name: "Norway" },
  { iso3: "NZL", iso2: "NZ", name: "New Zealand" },
  { iso3: "PRT", iso2: "PT", name: "Portugal" },
  { iso3: "SVN", iso2: "SI", name: "Slovenia" },
  { iso3: "SWE", iso2: "SE", name: "Sweden" },
  { iso3: "TUR", iso2: "TR", name: "Türkiye" },
  { iso3: "USA", iso2: "US", name: "United States" },
];
