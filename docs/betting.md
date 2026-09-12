# Betting — fake-currency wagers on scheduled matches

Run [`betting.sql`](betting.sql) in the Supabase SQL editor first (on its
own tab — see the note at the top of that file), after
`admin-security.sql`. Until that's done, the Bets tab shows a setup notice
naming whichever table isn't there yet, the same way the Kit does.

## The idea

The admin is the house, same as the rest of this app's admin model. There's
no Elo or rating math involved anywhere in this feature — the admin sets
the price, like a real bookmaker sets a line, and everyone else bets FC
(fake currency) against it.

1. Everyone starts at **300 FC** the first time they pick a name — on the
   home page's name prompt, or by claiming a roster profile. It's a
   one-time grant per name; picking the same name again never resets it.
2. The admin schedules a match as usual (**Schedule a match**, already in
   the Ladder), then opens betting on it from the **Bets** tab: **decimal
   odds** for each player. A winning bet returns `stake × odds` (the stake
   is included in that, not added on top) — a heavy favourite should get
   something close to 1 (little upside), a heavy underdog something much
   higher. This is the "use odds to scale the payout" part: it's the
   admin's judgement call each time, not a formula, so a rivalry that's
   actually close gets a close line instead of two players always paying
   out identically.
3. Anyone — a player or an outsider with a name — can then place a bet on
   that market, in one of three shapes:
   - **Winner** — pick who wins. Pays the market price straight.
   - **Margin** — pick who wins *and* the set margin (2-0 or 2-1). Pays
     the market price × the market's margin multiplier (default ×2).
   - **Exact score** — pick who wins *and* every set's exact score. Pays
     the market price × the market's exact-score multiplier (default ×5).
   The riskier the pick, the bigger the multiplier — set per market by
   whoever opens it, and always ordered margin < exact-score.
4. The stake leaves the bettor's wallet the moment the bet is placed (it's
   **pending**, not live yet) — that's the escrow, so nobody can double-spend
   a balance across five different bets before any of them are reviewed.
5. The admin reviews every pending bet and **accepts** or **rejects** it.
   A reject refunds the stake immediately. This is the house deciding how
   much action it's willing to take, same as a real book limiting a bet.
6. Once the real match is played, the admin marks it completed and enters
   the actual result (winner + set scores, same `6-4, 3-6, 7-5` format
   used everywhere else in this app). Every **accepted** bet on that market
   settles itself automatically: a win pays the locked-in payout, a loss
   pays nothing. Any bet the house never got round to reviewing is voided
   and refunded rather than settled blind on a match that already happened.
7. The admin can also **lock** a market (stop new bets without settling
   anything yet — useful right before the match starts) or **void** it
   entirely (cancels everything on it and refunds every escrowed stake —
   useful if the scheduled match itself gets cancelled; cancelling it from
   the Ladder does this automatically if a market exists).

## Where the money actually lives

Nothing about a balance is ever written directly by the browser. `wallets`,
`bet_markets` and `bets` are all select-only from the client — every actual
balance change happens inside a `SECURITY DEFINER` Postgres function
(`ensure_wallet`, `place_bet`, `admin_decide_bet`, `resolve_bet_market`,
`set_bet_market_status`), each of which re-checks the rules server-side
(admin-only actions call `is_admin()` again; a bet can't exceed the wallet's
actual balance; odds are read from the market row, never trusted from the
client). The app's own balance checks before showing a confirm dialog are
just UX — the database is what actually stops a bet from overdrawing a
wallet or an admin action from a non-admin session.

## What this doesn't try to do

- No real money — "FC" never leaves this app.
- No per-user login for the free-text name path — betting trusts whoever
  typed a name the same way posts, comments and challenges already do in
  this app. Someone can, in principle, bet as a name they don't "own"; that
  limitation is inherited from the identity model the whole app already
  uses, not something this feature adds.
- Margin bets assume a best-of-3 match (2-0 or 2-1), matching how the rest
  of the app reports sets. A best-of-5 deployment would need a third
  margin option added to `MARGIN_OPTIONS` in `index.html`.
