# Fantasy Roster Advisor

A private, non-commercial, single-user decision-support tool for Yahoo Fantasy Basketball.

## Project status

Early read-only prototype. Yahoo Fantasy Sports API approval is pending. This application does not modify rosters, add or drop players, place waiver claims, or submit trades.

## Intended use

- Read authorized fantasy league settings, player roster, matchups, and available free agents.
- Analyze strengths and weaknesses under the league's scoring rules.
- Produce explainable player add/drop and streaming recommendations for manual review.
- Keep all personal account data and OAuth credentials local; never publish retrieved Yahoo data.

## Technology

Node.js 24+; official Yahoo Fantasy Sports API over OAuth 2.0 (pending approval).

## Getting started

1. Obtain Yahoo Fantasy Sports API read-only approval at https://sports.yahoo.com/developer/access/ .
2. Complete local OAuth setup (not yet implemented in this prototype).
3. Set the short-lived OAuth access token in your local environment as `YAHOO_ACCESS_TOKEN`.
4. Run `node bot.mjs` on your own computer. Without a token it safely reports `SETUP_REQUIRED`.

## Safety

Read-only by design. No write operations. Never commit secrets or player/account snapshots. Recommendations will require explicit manual review.

## Audience

One personal user, one Yahoo Fantasy NBA league (league ID 85892, team ID 5). Not public-facing and not monetized.

## Disclaimer

Independent personal project, not endorsed by or affiliated with Yahoo. Access and permitted uses are subject to Yahoo's approval and developer terms.
