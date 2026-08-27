# Lotto Edge — Offline Phone PWA

This version runs entirely in the phone browser.

## What changed

There is no Python server and no Flask backend.

The following all run locally on the phone:

- number generation
- historical frequency analysis
- overdue analysis
- pair analysis
- saved pick history
- imported draw database
- app settings

The interface is cached by a service worker and works offline after installation.

## Internet use

Internet is only needed when:

1. you first install/open the app from a static HTTPS host; or
2. you choose to update draw history from a public CSV URL.

The app can check the saved CSV source automatically when opened, no more than once every 6 hours.
It also has a manual **Check updates** button.

## Installation

This is a static website/PWA. Upload the contents of this folder to any static HTTPS host,
for example GitHub Pages, Cloudflare Pages, Netlify or similar.

Then open the HTTPS address on your phone and install/add it to your home screen.

## Historical data

The app includes a tiny demonstration dataset only.

For useful analysis, import a full UK Lotto historical CSV under Settings.

Supported headings include:

date,n1,n2,n3,n4,n5,n6

or

Draw Date,Ball 1,Ball 2,Ball 3,Ball 4,Ball 5,Ball 6

## Optional automatic updates

Under Settings, paste a public URL that returns a Lotto-history CSV.

The source must permit browser access (CORS). If the source blocks browser requests,
manual CSV import still works completely offline afterwards.

## Important

In a fair lottery, every valid line has the same mathematical chance of being drawn.
Historical weighting is descriptive, not predictive. Low Sharing Risk attempts to avoid
common human-selection patterns and concerns possible prize-sharing, not draw probability.


## EuroMillions update
Added EuroMillions 5/50 + 2 Lucky Stars (1–12) selection mode alongside UK Lotto.


## v3 — Full EuroMillions history

EuroMillions now ships with the complete historical draw dataset from 2004 through the
latest bundled draw. The app analyses both the five main numbers and the two Lucky Stars.

When the app is opened with internet access, it can refresh the EuroMillions history from
the public lottery-archive CSV. The downloaded data is then stored locally and remains
available offline.

EuroMillions strategies now genuinely use EuroMillions history rather than merely generating
valid 5+2 combinations.
