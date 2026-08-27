# Lotto Edge v5 — Edge AI

Mobile-first offline PWA for UK Lotto and EuroMillions.

## v5 highlights

- Edge AI default model
- Explainable component scores:
  - long-term history
  - recent form
  - overdue fit
  - pair strength
  - structural fit
  - low-sharing score
- smart multi-line ticket diversification
- separate EuroMillions Lucky Star model
- heatmap
- walk-forward backtesting against random selections
- saved picks
- offline-first PWA behaviour

## Backtesting

The backtester uses only draws that occurred before each target draw. This avoids future-data leakage.
For mobile performance, the backtest uses a reduced candidate search compared with live Edge AI generation.

Historical backtest results are descriptive and do not establish that future lottery draws are predictable.

## Deployment

Upload all files in this folder over the existing GitHub Pages repository and commit to `main`.
GitHub Pages will redeploy automatically.

## v6 — Full UK Lotto data engine

UK Lotto no longer relies on the five-row demonstration set when internet access is available.
On first launch it downloads the full historical UK National Lottery archive (1994 onward)
from the configured public history API and stores it locally on the device. Thereafter the
app works offline and refreshes stale data when internet is available.

The same historical dataset is used by Edge AI, heatmaps, frequency analysis and walk-forward backtesting.

## v7 — Automatic app updates / cache fix

The PWA now uses a network-first service worker. When online, GitHub Pages always gets the
first chance to provide the newest HTML, JavaScript and CSS. Cached files are used only as
the offline fallback.

A version.json check plus service-worker controller-change handling automatically reloads
the app when a new deployed version becomes active. Manual 'clear site data' should no
longer be part of the normal update workflow.

UK Lotto history also uses a direct source plus browser-CORS fallback sources, replacing
the five-row demo dataset whenever a full archive can be reached.

## v8 — Fast switching and background data loading

Game switching no longer waits for remote APIs or CORS proxies. Lotto/EuroMillions buttons
switch immediately using locally stored data, while stale or incomplete history is refreshed
in the background with strict timeouts.

The main screen now displays data-load status. Analysis for the current dataset is memoized,
so switching tabs and rendering stats does not repeatedly recalculate thousands of historical
draws.

This version is designed so a failing external Lotto source cannot freeze or slow the UI.

## v9 — Correct UK Lotto archive source

Replaced the previous Lotto endpoint with a validated UK Lotto historical archive containing
more than 3,000 draws from 1994 through early 2025. The file contains the six main numbers
plus the bonus ball and is cached in localStorage after the first successful background load.

Important: older UK Lotto draws used 1–49; the game expanded to 1–59 in October 2015.
The analysis engine retains the historical draws as actually played rather than pretending
numbers 50–59 existed before the rule change.

Game switching remains non-blocking: if the archive needs downloading, the screen switches
immediately and the draw count updates automatically when the background load completes.

## v10 — Current-data top-up

The deep UK Lotto archive remains stored locally. When internet is available the app now
checks the public 2025 and 2026 Lotto result archives in the background and merges newer
draws into the local database. It never blocks game switching.

The main screen reports the latest locally stored draw date so data freshness is visible.

The current-results update is deliberately a top-up layer rather than the core data source:
if the internet or proxy is unavailable, Edge AI still has the full deep historical archive.

## v11 — Data integrity and freshness

The main screen now shows:
- total locally stored draws
- latest stored draw date
- whether the recent archive has obvious date gaps

The updater now uses stricter duplicate detection based on normalized dates + number sets,
sorts merged history newest-first, and exposes data-integrity status in Settings.

The gap detector intentionally flags only unusually long recent gaps; it does not assume
that historical draw schedules were identical across the entire archive.


## v12 — Instant startup / silent updates

The PWA shell is now cache-first. Installed users get the cached interface immediately instead
of waiting for GitHub Pages on every launch.

Only version.json is checked live. If a new deployment exists, the new service worker and
assets are downloaded silently in the background and become available on a subsequent launch.
There is no forced reload loop and no need to manually clear site data during normal updates.

Lottery-history refreshes are deferred until after the interface has rendered, so remote APIs
cannot delay initial app startup.


## v13 — Explainable Edge AI

Each generated line now exposes the model components behind its Edge score:

- long-term historical frequency
- recent form
- historical pair strength
- overdue fit
- draw-structure fit
- low-sharing profile

Each line has a tap-to-expand "Why this line?" panel, including the strongest and weakest
signals. The confidence card now measures both average line score and agreement between the
different model components.

The score is explicitly presented as a weighted model ranking, not as the mathematical
probability that the line will win.


## v14 — Whole-ticket portfolio optimisation

Edge AI no longer selects the five highest-scoring lines independently.

After building a large pool of strong candidate lines, the portfolio optimiser selects each
subsequent line according to both its individual Edge score and its marginal value to the
whole ticket.

The optimiser rewards:
- new-number coverage
- new-pair coverage
- diversified Lucky Star pairs

It penalises:
- repeated number slots
- repeated pairs
- near-clone lines

Strong numbers are still allowed to repeat if their model value justifies it.

The confidence card now includes Ticket Coverage, unique-number count, unique-pair count,
repeated-number slots, repeated pairs and repeated Lucky Star pairs.


## v15 — Global ticket optimisation + calibration

v15 replaces the greedy ticket builder with a global portfolio search.

The engine:
1. generates a broad high-quality candidate pool;
2. seeds many complete tickets;
3. scores each complete ticket for average Edge quality, minimum line quality, number coverage,
   pair coverage, repeated-pair concentration and near-clone risk;
4. uses evolutionary hill-climbing to improve the full ticket rather than selecting lines one-by-one.

v15 also adds model calibration. The Backtest screen can evaluate several interpretable weight
sets using walk-forward validation and save the best-performing weight set separately for Lotto
and EuroMillions.

Backtesting and calibration remain descriptive historical tools; they do not establish that
future random lottery draws can be predicted.


## v16 — Adaptive conviction

v16 addresses the diversification-versus-concentration trade-off.

Instead of treating all repeated numbers as bad, Edge AI now scores each individual number
using long-term frequency, recent form, overdue status and pair support. Numbers are classified
into Core, Strong, Supporting and Diversifier tiers.

The portfolio optimiser may deliberately repeat Core/Strong numbers across multiple lines when
their signal separation from the field is high. Repetition beyond the conviction allowance is
still penalised, and near-clone lines remain heavily penalised.

Portfolio behaviour modes:
- Adaptive conviction (recommended)
- Diversified
- Balanced concentration
- Strong conviction

The Backtest screen can calibrate portfolio concentration historically. Adaptive mode uses the
historically preferred concentration style as a baseline, then adjusts concentration draw-by-draw
according to the current signal strength.

This still does not change the mathematical probability of individual valid lottery combinations.
It changes only how the model allocates a multi-line portfolio under its own historical assumptions.


## v17 — Robust Monte Carlo backtesting

Backtesting now compares each Edge AI historical portfolio against a distribution of random
control portfolios rather than one random ticket.

New outputs include:
- best-line average main matches
- total-ticket average matches
- Edge percentile against random controls
- 2+/3+/4+/5 main-match counts
- Lucky Star totals
- correlation between Edge score and subsequent hit quality
- head-to-head portfolio mode comparison

Random controls can be set to 100, 250 or 500 portfolios per historical draw.

This makes the backtest less sensitive to one lucky/unlucky random comparison and gives a
much more informative baseline. A percentile near 50th means performance is roughly in line
with the random-control distribution.

The result remains historical and descriptive; it is not evidence that future draws are predictable.


## v18 — Statistical validation + visible version

- App version is now visible in the header.
- Walk-forward backtests support 500 and 1,000 historical draws where history permits.
- Random-control distributions support up to 1,000 portfolios per historical draw.
- Backtests report 95% confidence intervals for Edge-vs-random lift.
- Per-draw percentile spread is shown to make instability visible.
- Factor ablation can remove each Edge AI component in turn and measure the historical change.
- Existing portfolio-mode comparison, calibration, adaptive concentration and robust Monte Carlo controls remain available.

These diagnostics are historical validation tools. They do not imply that fair lottery draws are predictable.


## v19 — Validation Lab

v19 tightens the statistical interpretation of the existing backtester rather than adding
new prediction factors.

Changes:
- percentile calculations now use mid-rank ties: values below Edge count fully and ties count half;
- best-line and total-ticket lift remain paired draw-by-draw against random controls and are
  interpreted through 95% confidence intervals;
- robust-backtest results label paired lift as helpful, harmful or inconclusive;
- factor ablation is now paired against the full model draw-by-draw;
- each ablated factor receives a 95% confidence interval and a helpful / harmful / inconclusive verdict;
- ablation averages two independent searches per historical draw to reduce random-search noise.

A single ablation result should not automatically change the production model. A factor should
be reconsidered only if the same result persists across different historical windows.


## v20 — Validated Edge major model reset

v20 is a multi-step architecture change rather than another small scoring tweak.

1. Validated Edge is the production mode. Historical factors are blocked from production until
   they pass rolling development tests and a newer untouched holdout.
2. Prediction and payout-sharing logic are separated. Low-sharing is no longer part of the
   predictive score; it is used only for portfolio/prize-sharing optimisation.
3. A one-click Full Validation Suite runs six non-overlapping development windows, stable-factor
   selection, an untouched holdout, Lucky Star validation and portfolio-style calibration.
4. Validation is reproducible and rule-era aware. UK Lotto's 1–49 / 1–59 change and EuroMillions'
   historical 9 / 11 / 12 Lucky Star pools are respected.
5. If the predictive model fails holdout, production automatically falls back to Portfolio Edge:
   neutral draw selection, diversified coverage, duplicate control and low-sharing optimisation.
6. Lucky Star prediction has its own holdout gate. If it fails, Stars are selected neutrally and
   diversified instead of using unsupported historical weighting.

The production system therefore always has a useful operating mode without claiming historical
prediction when the data does not support it.


## v21 — Deterministic Model Search + Champion/Challenger

v21 fixes the main weakness exposed by v20: individual factors are no longer required to pass
a crude 5-of-6 gate before a candidate model can be tested.

The release makes several major changes at once:

1. **Signal direction search**
   Long-term history, pair strength and structure are tested both normally and inversely.

2. **Horizon search**
   Recent and overdue signals are tested over 20, 50, 100 and 200 previous draws, in both
   normal and inverse directions.

3. **All 31 predictive factor combinations**
   After the best development variant of each base factor is selected, every non-empty subset
   of the five predictive factors is tested across six development windows.

4. **Deterministic development controls**
   Historical validation uses date/game-derived seeded random controls, so repeated validation
   on the same data does not change simply because Math.random produced a different sample.

5. **Two reserved production gates**
   The selected challenger is frozen before reserved data is touched. It is tested first on a
   reserved validation gate and then on a newer final confirmation arena. Production promotion
   requires positive pooled reserved evidence with a 95% confidence interval above zero.

6. **Champion vs challenger**
   If a v21 predictive champion already exists, a new challenger is compared against it in the
   final arena. A failed challenger does not replace a validated champion.

Low-sharing remains outside draw prediction and remains only a portfolio/prize-sharing heuristic.
Lucky Stars remain independently validated.

A failed search should not be repeatedly re-tuned against the same reserved data. The correct
next trigger for a fresh challenger is materially newer draw history.


## v21.1 — Holdout-safe production semantics

v21.1 incorporates a methodological correction before further model work:

- Reserved production evidence is never displayed as a numeric percentile when it was not actually evaluated.
  An unevaluated gate/arena is shown as **NOT RUN**, not as 50th percentile.
- The app records a dataset fingerprint when a production validation run consumes its reserved gate and
  final arena. Re-running production validation on the exact same dataset is blocked so the same holdout
  cannot silently become development data after repeated tweaks.
- The UI explicitly separates three engines:
  1. **Draw Model** — historical prediction; must pass out-of-sample validation.
  2. **Player Model** — low-sharing heuristic; may affect prize-sharing risk, not draw probability, and is
     explicitly labelled as not yet empirically validated.
  3. **Portfolio Optimiser** — line overlap, coverage and concentration.
- Portfolio Edge therefore remains useful even when the Draw Model is neutral, while the Player Model's
  current heuristic status is visible rather than being mistaken for validated predictive evidence.

A future fresh production challenge should be triggered by materially newer historical draw data, not by
repeatedly tuning against the same reserved block.


## v21.2 — Holdout integrity correction

v21.2 corrects three methodological problems in v21/v21.1.

1. **Development search is explicitly non-evidential.**
   Testing normal and inverse directions, several horizons and 31 subsets guarantees that the best
   development output will often look positive even under noise. The UI now labels these tables as
   selection-biased search output and does not present them as findings.

2. **The weak intermediate "gate pass" is removed from production evidence.**
   Production no longer combines overlapping gate/arena hurdles or calls an upper-CI-bound screen a pass.
   There is one adjudicating production test: a private final arena. Promotion requires its paired lift
   confidence interval lower bound to clear zero.

3. **One new draw can no longer unlock the private holdout.**
   The ledger stores the cutoff date of the last consumed production arena. A subsequent production run is
   blocked until at least 150 draws with dates strictly after that cutoff have accumulated. The new arena
   consists entirely of those genuinely new observations. Previously spent data may be used for future
   development/search, but never masquerades as fresh production evidence.

If a validated champion already exists, a challenger must also beat that champion with a paired 95% CI
above zero on the same genuinely fresh arena before replacement.

The Player Model remains explicitly heuristic/unvalidated. Low-sharing stays outside the Draw Model.


## v22 — Player Edge

v22 freezes the Draw Model work and moves the project to the mechanism with a defensible economic basis:
other players do not select lottery combinations uniformly, so an unpopular winning combination can be
less likely to share a prize.

### Production architecture

1. **Draw Model**
   Unchanged from v21.2. It remains neutral unless its private production arena validates a predictive
   challenger. Player Edge does not alter draw probability.

2. **Player Model**
   A separate popularity model. Its default state is a literature-backed prior based on published UK
   lottery evidence that lower/birthday-range numbers are selected disproportionately, 7 is unusually
   popular, 13 unusually unpopular, and consciously selected combinations cluster.

3. **Portfolio Optimiser**
   Uses Player Edge as a payout-sharing objective while controlling line overlap and coverage.

### Empirical Player evidence

The app can refresh recent public prize-breakdown data from UK Lottery Stats for Lotto and EuroMillions.
It stores rows locally and accumulates unique evidence over time.

The empirical target is a winner-pressure proxy built primarily from prize-tier ratios such as
Match 3 winners / Match 2 winners. Ratios are used to reduce sensitivity to changing ticket sales.
This remains an indirect proxy for player choice; it is not direct ticket-level selection data.

### Player Model validation

- The first validation requires a chronological training period and a later holdout.
- A full production validation requires at least 80 cached evidence rows and at least 24 usable holdout rows.
- The test statistic is holdout correlation between predicted popularity pressure and later observed
  winner-count pressure.
- Significance is assessed with a deterministic one-sided permutation test.
- Production empirical Player Edge requires holdout correlation >= 0.18 and permutation p <= 0.05.
- After any Player validation attempt, a new attempt is locked until at least 30 genuinely newer
  evidence rows have accumulated after the previous cutoff.
- A failed challenger never deletes an already validated Player Model.

### Literature basis

- Cox, Daniell & Nicole (1998), *Using Maximum Entropy to Double One's Expected Winnings in the UK National Lottery*.
  https://eprints.soton.ac.uk/250895/
- Haigh, *The Statistics of the National Lottery*.
  https://academic.oup.com/jrsssa/article-abstract/160/2/187/7102439
- Baker & McHale / Significance overview of number preferences.
  https://academic.oup.com/jrssig/article/20/1/31/7034183

The literature supports the existence of non-uniform human choice. Lotto Edge's own current-player
calibration remains explicitly separate and must pass its own later-data validation before empirical
coefficients replace the literature prior.
