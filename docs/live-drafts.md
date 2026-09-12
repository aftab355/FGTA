# The live-drafts safety net

The Point Tracker already saves every point to the phone tracking it, so a
crashed tab or a dead battery doesn't lose the match — reopening the same
browser on the same phone picks up right where it left off. What that
doesn't cover: the phone itself never making it back, or a match that
plainly finished with nobody pressing **Submit game**.

**Live drafts** closes that gap. Every point also gets pushed, in the
background, to an admin-only table — a second copy of the match that lives
independently of whichever phone is running the tracker.

---

## Setup

Run [`live-drafts.sql`](live-drafts.sql) once against the project's Postgres
(Supabase SQL editor or psql). Idempotent, like every other migration here.

Skipping it is a supported way to run the site: the backup write fails
silently (same as any optional column missing elsewhere), matches still
submit exactly as before, and there is simply no recovery net. Nothing about
scoring or submitting a match depends on this table existing.

---

## How it works

Every point the tracker records (`ptPoint` → `ptAfterMutate`) also fires a
background upsert of the whole match state — score, sets, games, every
rally with its timestamp, exactly the object the tracker already keeps in
memory — to `match_drafts`, keyed by a random id generated once per
tracking session. It's a background write, not a requirement: it's wrapped
so that no signal, a missing table, or Supabase being slow never blocks or
interrupts scoring.

The row is deleted the moment the match is actually submitted or
deliberately abandoned — from that point it isn't a safety net for
anything, just clutter in the recovery list. One gap worth knowing: if a
submit gets queued in the phone's own offline outbox (no signal at the
court) and sent later, the draft isn't cleared until that later send
succeeds — so for a stretch after a spotty-signal submit, the admin view may
still show a match that has, in fact, already gone through. Checking the
approval queue settles it either way.

A **scoreboard replay** (see `docs/scoreboard-replay.md`) is explicitly
excluded — it's regenerating a match that's already filed, not a new one
that needs recovering.

## Who sees it

Nobody but an admin. Read access on `match_drafts` is gated the same way as
the audit log and the player roster — `public.is_admin()`, checked in
Postgres, not just hidden in the UI. Everyone else's app writes to the table
freely (same trust level as submitting a match at all) but can't read a
single row back.

An admin sees it as a small section — **🛟 Live & unsubmitted tracked
matches** — right below the pending queue: who's playing, the live score,
when it last updated, and whether it's still going or finished without
being submitted (called out in red, since that's the one that actually
needs attention).

## Recovering one

Tap **Recover here** on any entry. It loads that backed-up state into the
Point Tracker on whatever device the admin is using — same screen the ref
would have seen — so the admin can check the score and press the ordinary
**Submit game** button themselves. Nothing about submission is
reimplemented; it's the same path a live match already goes through.

If something is already being tracked live on that admin's own device, it
asks before replacing it.
