use crate::error::EngineError;
use crate::fixed_point::{Wad, WAD};
use crate::merkle::compute_evidence_root;
use crate::types::{CountryScore, IndicatorTrace, OutputBundle, RelativeScore, Snapshot};
use chrono::{Datelike, Timelike};
use std::collections::{BTreeMap, BTreeSet};

const MIN_INDICATORS_PER_COUNTRY: usize = 3;
const EVIDENCE_CUTOFF_MONTH_DAY: (u32, u32) = (7, 31);

// 1 means a higher value is better, -1 means lower is better.
//
// Limited to the indicators with a confirmed, currently-accessible primary
// source for every v0.1 country (see the source-coverage research). The
// other 17 audited indicators are deferred: most have no source at all for
// Ghana or Nigeria, or only a commercial or discontinued one.
const V0_1_INDICATORS: [(&str, i128); 8] = [
    ("nighttime_lights", 1),
    ("ndvi_crop_health", 1),
    ("overnight_lending_rates", -1),
    ("pmi", 1),
    ("gdp_real_growth_yoy", 1),
    ("cpi_headline_yoy", -1),
    ("unemployment_rate", -1),
    ("fiscal_deficit_gdp", -1),
];

#[derive(Debug, Clone)]
pub struct MethodologyConfig {
    pub universe: Vec<String>,
    pub indicator_weights: BTreeMap<String, Wad>,
    pub indicator_polarities: BTreeMap<String, Wad>,
    pub min_indicators_per_country: usize,
    pub evidence_cutoff_month_day: (u32, u32),
}

pub fn get_methodology_config(version: &str) -> Result<MethodologyConfig, EngineError> {
    match version {
        "v0.1" => Ok(MethodologyConfig {
            universe: ["CHN", "DEU", "GHA", "NGA", "USA"]
                .map(String::from)
                .to_vec(),
            indicator_weights: V0_1_INDICATORS
                .iter()
                .map(|(id, _)| (id.to_string(), Wad::ONE))
                .collect(),
            indicator_polarities: V0_1_INDICATORS
                .iter()
                .map(|(id, polarity)| (id.to_string(), Wad(polarity * WAD)))
                .collect(),
            min_indicators_per_country: MIN_INDICATORS_PER_COUNTRY,
            evidence_cutoff_month_day: EVIDENCE_CUTOFF_MONTH_DAY,
        }),
        _ => Err(EngineError::InvalidMethodologyVersion(version.to_string())),
    }
}

pub fn evaluate_methodology(
    snapshot: &Snapshot,
    epoch_id: &str,
    version: &str,
    methodology_image_id: [u8; 32],
) -> Result<OutputBundle, EngineError> {
    let config = get_methodology_config(version)?;

    let computed_root = compute_evidence_root(&snapshot.observations)?;
    if snapshot.evidence_root != [0u8; 32] && snapshot.evidence_root != computed_root {
        return Err(EngineError::EvidenceRootMismatch);
    }

    // The proposer supplies `as_of`, so it is pinned to the methodology's cutoff; otherwise a
    // later `as_of` would admit evidence that arrived after the deadline. An epoch is the
    // calendar year before the cutoff.
    let as_of = snapshot.as_of;
    if (as_of.month(), as_of.day()) != config.evidence_cutoff_month_day
        || as_of.num_seconds_from_midnight() != 0
        || as_of.nanosecond() != 0
    {
        return Err(EngineError::InvalidCutoff(as_of.to_rfc3339()));
    }
    let epoch_year = as_of.year() - 1;
    let epoch_start = format!("{epoch_year:04}-01-01");
    let epoch_end = format!("{epoch_year:04}-12-31");

    let mut observation_map: BTreeMap<(&str, &str), (Wad, &str)> = BTreeMap::new();
    for obs in &snapshot.observations {
        let country = obs.country_iso3.as_str();
        let indicator = obs.indicator_id.as_str();
        if !config.universe.iter().any(|c| c == country) {
            return Err(EngineError::UnknownCountry(country.to_string()));
        }
        if !config.indicator_weights.contains_key(indicator)
            || !config.indicator_polarities.contains_key(indicator)
        {
            return Err(EngineError::UnknownIndicator(indicator.to_string()));
        }
        if obs.known_at > as_of {
            return Err(EngineError::ObservationAfterCutoff {
                country: country.to_string(),
                indicator: indicator.to_string(),
            });
        }
        if obs.period_start != epoch_start || obs.period_end != epoch_end {
            return Err(EngineError::ObservationOutsideEpoch {
                country: country.to_string(),
                indicator: indicator.to_string(),
            });
        }
        let parsed = Wad::from_decimal_str(&obs.value)?;
        if observation_map
            .insert((country, indicator), (parsed, obs.value.as_str()))
            .is_some()
        {
            return Err(EngineError::DuplicateObservation {
                country: country.to_string(),
                indicator: indicator.to_string(),
            });
        }
    }

    // An indicator needs two reporting countries to be normalized, and a country needs
    // enough scoreable indicators to be ranked. Dropping a country can leave an indicator
    // with a single reporter, so repeat until the set stops shrinking.
    let mut included: BTreeSet<&str> = config.universe.iter().map(String::as_str).collect();
    let scoreable: BTreeSet<&str> = loop {
        let mut reporters: BTreeMap<&str, usize> = BTreeMap::new();
        for (country, indicator) in observation_map.keys() {
            if included.contains(country) {
                *reporters.entry(indicator).or_default() += 1;
            }
        }
        let scoreable: BTreeSet<&str> = reporters
            .into_iter()
            .filter(|(_, count)| *count >= 2)
            .map(|(indicator, _)| indicator)
            .collect();
        let next: BTreeSet<&str> = included
            .iter()
            .copied()
            .filter(|country| {
                scoreable
                    .iter()
                    .filter(|indicator| observation_map.contains_key(&(*country, **indicator)))
                    .count()
                    >= config.min_indicators_per_country
            })
            .collect();
        if next.len() == included.len() {
            break scoreable;
        }
        included = next;
    };
    if included.len() < 2 {
        return Err(EngineError::InsufficientCoverage);
    }

    let mut stats: BTreeMap<&str, (Wad, Wad)> = BTreeMap::new();
    for indicator in &scoreable {
        let values: Vec<Wad> = included
            .iter()
            .filter_map(|country| observation_map.get(&(*country, *indicator)))
            .map(|(value, _)| *value)
            .collect();
        let count_wad = Wad::from_i128(values.len() as i128)?;

        let mut sum = Wad::ZERO;
        for val in &values {
            sum = sum.checked_add(*val)?;
        }
        let mean = sum.checked_div(count_wad)?;

        let mut variance_sum = Wad::ZERO;
        for val in &values {
            let diff = val.checked_sub(mean)?;
            variance_sum = variance_sum.checked_add(diff.checked_mul(diff)?)?;
        }

        let std_dev = variance_sum.checked_div(count_wad)?.isqrt()?;
        stats.insert(indicator, (mean, std_dev));
    }

    let mut country_scores_map: BTreeMap<&str, (Wad, u32)> = BTreeMap::new();
    let mut attribution: Vec<IndicatorTrace> = Vec::new();

    for country in config.universe.iter().filter(|c| included.contains(c.as_str())) {
        let mut total_score = Wad::ZERO;
        let mut indicator_count = 0u32;

        for (indicator, (mean, std_dev)) in &stats {
            let Some((val, raw)) = observation_map.get(&(country.as_str(), *indicator)) else {
                continue;
            };

            let raw_norm = if std_dev.0 > 0 {
                val.checked_sub(*mean)?.checked_div(*std_dev)?
            } else {
                Wad::ZERO
            };

            let polarity = config.indicator_polarities[*indicator];
            let weight = config.indicator_weights[*indicator];
            let normalized = raw_norm.checked_mul(polarity)?;
            total_score = total_score.checked_add(normalized.checked_mul(weight)?)?;
            indicator_count += 1;

            attribution.push(IndicatorTrace {
                country_iso3: country.clone(),
                indicator_id: indicator.to_string(),
                raw_value: raw.to_string(),
                normalized_score: normalized.to_string(),
                weight: weight.to_string(),
            });
        }

        let country_score = total_score.checked_div(Wad::from_i128(indicator_count.into())?)?;
        country_scores_map.insert(country, (country_score, indicator_count));
    }

    let mut score_sum = Wad::ZERO;
    for (score, _) in country_scores_map.values() {
        score_sum = score_sum.checked_add(*score)?;
    }
    let others_count = Wad::from_i128(country_scores_map.len() as i128 - 1)?;

    let mut country_scores = Vec::new();
    let mut relative_scores = Vec::new();

    for (country, (score, indicators_scored)) in &country_scores_map {
        country_scores.push(CountryScore {
            country_iso3: country.to_string(),
            score: score.to_string(),
            indicators_scored: *indicators_scored,
        });
        let world_excluding_self = score_sum.checked_sub(*score)?.checked_div(others_count)?;
        relative_scores.push(RelativeScore {
            country_iso3: country.to_string(),
            world_excluding_self: world_excluding_self.to_string(),
            relative_performance: score.checked_sub(world_excluding_self)?.to_string(),
        });
    }

    Ok(OutputBundle {
        epoch_id: epoch_id.to_string(),
        as_of: snapshot.as_of.to_rfc3339(),
        methodology_version: version.to_string(),
        evidence_root: computed_root,
        methodology_image_id,
        excluded_countries: config
            .universe
            .iter()
            .filter(|c| !included.contains(c.as_str()))
            .cloned()
            .collect(),
        country_scores,
        relative_scores,
        attribution,
    })
}
