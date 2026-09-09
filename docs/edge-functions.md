# Supabase Edge Functions

There is one: **`recap`**, which writes the week's round-up and posts it to the
feed on a schedule.

## Why this is not `/api/ai`

The project already proxies Claude through a Netlify function
(`netlify/functions/ai.mts`, behind `/api/ai`), and the match-card commentary
and roast buttons call it. That function is a **proxy**: the browser asks, it
forwards the request with the key attached, the answer comes back to the
browser.

It cannot do this job, because this job happens when nobody has the app open —
Monday morning, from a cron, reading the database directly. That is the one
thing an Edge Function is genuinely for here, and it is why `recap` is not a
duplicate of `ai.mts`:

| | `/api/ai` (Netlify) | `recap` (Edge Function) |
|---|---|---|
| triggered by | a person clicking a button | `pg_cron`, or a manual `curl` |
| needs the app open | yes | no |
| reads the database | no — the browser sends what it has | yes, directly, with `service_role` |
| writes anything | no | inserts one post |

The app also already has a weekly recap — `postWeeklyRecap()` in `index.html`.
That one is a **template**: a string of stats joined with bullets, posted when
an admin presses a button. This writes the same facts as prose, and needs
nobody to be awake.

## What the model is and is not trusted with

**It never sees a match row.** `facts.js` computes a small object — counts,
names, a percentage — and that object is the entire input. The model is asked
to write three sentences about it.

This is the whole safety property. A model handed a table of results will
eventually write a scoreline that did not happen, and a league bot that invents
results is worse than no league bot. Handed a fact sheet, the worst it can do
is write it badly. `test/recap.test.js` asserts the separation directly: no raw
match field may reach the fact sheet.

`facts.js` is plain JavaScript rather than TypeScript on purpose — Deno imports
it happily, and it stays loadable by `node test/recap.test.js` with no build
step, which is the convention every other test in this repo follows.

## Deploy

Needs the Supabase CLI and a linked project.

```bash
supabase link --project-ref fzmuixlxnhervxzrinbh
supabase functions deploy recap
```

## Secrets

Three, set on the project (not in the repo):

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set RECAP_SECRET="$(openssl rand -hex 32)"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase — do
not set them yourself.

**`RECAP_SECRET` is not optional.** An Edge Function is a public URL, and this
one both posts to the feed and spends the Anthropic key. `config.toml` sets
`verify_jwt = false` (a cron job has no user JWT), so the shared-secret check
inside `index.ts` is the only gate there is. A missing `RECAP_SECRET` returns
500 rather than running — failing open here is the expensive mistake.

**Do not paste any of these values into an AI assistant**, including this
project's own. A secret that reaches a chat log is a rotated secret.

## Try it without posting

`?dry=1` returns the facts and the drafted text and writes nothing:

```bash
curl -s "https://fzmuixlxnhervxzrinbh.supabase.co/functions/v1/recap?dry=1" \
  -H "x-recap-secret: $RECAP_SECRET" | jq
```

Every response is JSON with a reason: `{"posted":true,...}`,
`{"skipped":"no games this week"}`, `{"skipped":"already posted"}`, or an
`error` with the upstream status.

## Schedule it

In the SQL editor — **paste it on its own**, for the reason in `kit.sql`:
Supabase runs an editor tab as one transaction, so an unrelated error rolls
back everything after it.

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Mondays, 09:00 UTC. Vault keeps the secret out of the job definition, which
-- is readable by anyone who can read cron.job.
select cron.schedule('fgta-weekly-recap', '0 9 * * 1', $$
  select net.http_post(
    url     := 'https://fzmuixlxnhervxzrinbh.supabase.co/functions/v1/recap',
    headers := jsonb_build_object(
      'content-type',    'application/json',
      'x-recap-secret',  (select decrypted_secret from vault.decrypted_secrets
                          where name = 'recap_secret')
    )
  );
$$);
```

Store the secret in Vault first (`select vault.create_secret('<value>',
'recap_secret');`), then the job never contains it.

To stop it: `select cron.unschedule('fgta-weekly-recap');`

## It will not post twice

The week's Monday (`weekKey()`) is appended to the post body as
`#weekinreview-2026-09-07`, and the function checks for that marker before
doing any work. A cron that fires twice, a retry, or a manual run after an
automatic one all no-op.

The marker lives in the post body rather than in a table of its own, so there
is no second thing to migrate and no way for the two to disagree.

## A quiet week gets silence

`recapFacts()` returns null when no games were played, and the function posts
nothing. A bot that posts "not much happened this week" every week is one
people learn to scroll past.

## Model

`claude-opus-5`, at `effort: "low"` — writing three sentences from a supplied
fact sheet is not a reasoning task, and low effort is both the honest setting
and the cheap one. `max_tokens` is 1000 because a feed post is deliberately
short. Server-side refusal fallback to `claude-opus-4-8` is enabled, so a
policy decline retries on the fallback inside the same call instead of the
week's recap simply not appearing.

One thing that was wrong in the first draft and is worth writing down: the
SDK's error classes are **named exports**, not properties of the default
export, and there is no `APIStatusError` in the TypeScript SDK — that one is
Python's. `import Anthropic, { APIError, APIConnectionError, RateLimitError }`.
