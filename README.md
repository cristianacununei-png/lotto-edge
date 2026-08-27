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
