# Commodity data maintenance

Public page: `commodities.html`. The main navigation and watchlist link here.

`commodities-config.json` is the instrument registry. Add a stable, unique lowercase `id`, display name, source, source symbol, units, frequency, coverage/staleness settings and optional hints/related stocks. The page and screener discover the registry through generated `data/commodities.json`; there is no hard-coded five-item list in the UI. Current adapters: `sina` (domestic continuous futures) and `nxin` (national hog spot weekly transaction average). A different provider needs a fetch adapter. Never reuse an existing id for another price basis or source.

Run `python scripts/commodity_data.py`. Requests are sequential, at least one second apart, with timeouts and retries. First run obtains available history. Later runs merge on date, accept source corrections, and preserve earlier observations even when the provider truncates its response. Data is stored in `data/commodity_<id>.json`, one observation per line to keep Git diffs small. Daily history is committed, unlike the separate stock quarter-only archive. No complete dated snapshot copies are created. Back up before deliberately changing a series definition.

GitHub Actions runs on weekdays at 18:00 Asia/Shanghai (and code pushes/manual dispatches). Commodity files are committed before publishing. GitHub bot commits do not trigger recursive Actions runs. Failed fetches retain history and mark that instrument as failed, suppressing attention. A first fetch without any history fails the build. Issue-triggered note deployments reuse the committed commodity data. Daily checks do not mean weekly hog data becomes daily observations.

Windows use calendar years ending at the latest observation, with leap-day handling. Percentile is the midrank empirical CDF: `(below + equal/2) / N * 100`. Full chronological coverage, minimum annual samples and maximum interior gap are required. Stale/failed series cannot trigger attention. All three **unrounded** 1/5/10-year percentiles must be <=10. Display rounding does not control selection. Weekends/holidays are never padded. Historical prices/percentiles are not investable futures returns; continuous contract rolls can change price levels. Price range position is shown separately from rank.

Hog selection: 2026-11-18 probes found Sina futures from 2021-01-08, Yangzhu daily spot with 367 observations, Soozhu daily spot with 200, and Nxin weekly spot from 2015-01-05. The last was selected for longer cycle coverage. Nxin has duplicate dates, deduplicated by date (last source observation wins). It uses transaction average (field 6), not price index (field 1) or presale average. Source definition: https://hqb.nxin.com/hqb/marketInformationContent.shtml?infoId=949024

Hints are conditional business exposures, not stock-price predictions. `related` links to existing company views and source disclosures; maintain `reviewed` dates and evidence when editing. Public readers cannot change the repository configuration.

Tests from the parent workspace: `python -B financial_gui/test_commodity_data.py` and `node financial_gui/test_commodities_ui.cjs`.
