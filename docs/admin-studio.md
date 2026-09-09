# Admin Studio

Change how the site looks and what is on it — colours, type, copy, layout,
which features exist, and new content — from inside the site itself, and
publish it to everyone. No deploy, no editing `index.html`.

Open the ☰ menu and choose **✎ Edit site**. It only appears once
`is_admin()` has confirmed the signed-in session.

---

## Setup (once)

Paste [`site-config.min.sql`](site-config.min.sql) into the Supabase SQL
editor and Run. It creates two tables, their RLS policies, the realtime
publication and the `publish_site_config()` function.

[`site-config.sql`](site-config.sql) is the same migration with the
reasoning written out; read that one to understand it, paste the other.
They cannot drift — `test/site-config-sql.test.js` fails if they do.

> **Paste it on its own, in an empty editor tab.** Supabase runs a tab as
> one transaction. One error anywhere — including a harmless
> `42710: policy "…" already exists` from an unrelated script pasted above
> it — rolls back *everything after it*. You get no tables and no obvious
> sign why, because the only message shown is the one about the unrelated
> script.

Every statement is guarded (`if not exists`, `drop policy if exists`,
`create or replace`), so running it twice is safe.

### Did it work?

```sql
select
  to_regclass('public.site_config')          as site_config,
  to_regclass('public.site_config_history')  as history,
  to_regproc('public.is_admin')              as is_admin_fn,
  to_regproc('public.publish_site_config')   as publish_fn;
```

Four values, and `null` means missing:

| Column | `null` means |
|---|---|
| `is_admin_fn` | **Run `admin-security.sql` first.** This migration doesn't create it and six of its policies depend on it. |
| `site_config` | The migration didn't run — see the transaction note above. |
| `history` | Same; it is created after `site_config`. |
| `publish_fn` | Same; it is the last statement in the file. |

All four non-null and the studio can publish. If `is_admin_fn` is the only
one filled in, the migration aborted before its first `create table`.

Not running it at all is a supported way to run this site: the app asks
once, notes the missing table in the console, and renders the built-in
defaults — exactly what the site looked like before any of this existed.
The studio still opens and still previews, and says plainly that it cannot
publish.

---

## Draft and published are different things

Everything you change is a **draft**. It lives in your browser (and survives
a reload), it is visible only to you, and the rest of the league keeps
seeing the published site until you press **Publish**.

- **Publish** — writes the draft to Postgres, bumps the version, records a
  history entry, and pushes the change to every open tab over realtime.
  You are asked for an optional note; it is worth writing one.
- **Discard** — throws the draft away.

If somebody else publishes while you have a draft open, your draft is left
alone. The new published config is taken quietly underneath it.

---

## How you actually edit

Opening the studio arms it. Click something and you are editing it.

- **Click** anything — a heading, a button, a whole section. A toolbar
  appears **on it** with the handful of things you'll want most: type,
  smaller, bigger, bold, colour, drag, hide.
- **Double-click text** and type straight into the page, with a real
  caret in the real page. Enter keeps it, Esc throws it away.
- **Grab ⠿** on the toolbar and drag a section where you want it. A line
  shows where it will land.
- **⌘Z / Ctrl+Z** undoes anything, as many steps back as you like.
  **⇧⌘Z** redoes. A whole colour drag counts as one step, not forty.
- **↑ Around it** on the toolbar selects the thing containing what you
  picked; clicking again inside a selection drills one level in. So the
  whole tree is reachable — it just isn't where you start.

Clicking selects **the nearest thing a person would name** — a button, a
heading, a section — not the deepest node under the cursor. That single
choice is most of the difference between this and a devtools inspector.

**Pick** in the panel's top bar turns click-to-select off, so the site
behaves normally with the panel still open. That's for navigating to
another tab to carry on editing there.

`Esc` unwinds one layer at a time: typing, then picking, then the studio.

---

## Change one, change all like it

Clicking a match card and restyling it changes **every match card**. That is
the default, because doing the other thirty-nine by hand is data entry, not
editing.

The toolbar shows a pill with the count (`◆ 12`) and the panel says
*"Changes apply to — all 12 like this"*, with every other member outlined on
the page so you can see the blast radius before you touch anything. The
dropdown offers each candidate group and **just this one**; the toolbar pill
flips between group and single in one click.

It works because a config key is already a CSS selector: a key of `.pend`
styles every pending row through exactly the same generated rule a
positional key uses. Nothing new runs — the studio just picks a broader
selector.

Groups are found most-specific-first: the compound class set (`.a.b.c`),
then each class alone, then a container-scoped tag (`#topTabs>button`) for
elements with no classes. **State classes are stripped** — `.on`, `.open`,
`.g1` say what an element is *doing*, not what it *is*, and a rule keyed on
one would come and go as the page updates.

Two things stay per-element on purpose:

- **Moving.** "Put all forty cards third" is not a thing anyone means.
- **Undo my edits** clears exactly the scope shown, and the button says
  which — *Undo edits on all 12* or *Undo edits on this one*. Clearing both
  at once would mean narrowing to fix one card and silently resetting the
  rest.

Retyping at group scope gives every member the same words, which is what you
want for a repeated label and not what you want for a match name — so the
panel warns when you are about to do it.

---

## What each tab does

### Element
Everything for whatever you picked, named in plain words at the top —
“Standings table”, “‘Report a game’ button” — rather than by its selector.
The selector is still there, under **Advanced**, for anyone who wants it.

- **Words** — retype it. Icons, counters and badges beside the text are
  left where they are; only the words change. Buttons that wrap their
  label in a span (the mobile bottom bar) are handled.
- **Style** — sliders for size, padding, spacing, corners and opacity;
  swatches for colour; chips for weight, alignment and case. Each starts
  from what the page is actually rendering, so the first nudge continues
  from what you can see. **↺** puts the design's own value back, and a **•**
  marks anything you've changed.
- **Show & place** — hide it for everyone, or move it among its
  neighbours (or just drag it with ⠿).
- **Advanced** — free-text CSS for this one element, and its address.

### Theme
Every design token in the stylesheet, grouped and explained. One change
lands everywhere, because every panel, button and chart reads these.

A dot beside a token means you have overridden it. **Skin** switches the FF
Cup dressing on or off, or leaves it to the markup and the cup's own date
window.

Studio colours deliberately outrank both the FF Cup skin and the live
weather themes — those redeclare the palette on `<body>`, and without this
your colours would silently do nothing whenever either was on.

### Type
Three typefaces — body, mono, display — and every `font-family` in the
stylesheet reads one of them, so these three menus retype the whole site.
Google families are only fetched once you pick one. Also scale, line
height, tracking, weight, and the site name.

### Layout
- **Navigation** — rename, reorder, or remove the top-level tabs.
  Renaming and hiding follow the *view*, so the mobile bottom bar and the
  More sheet change with the desktop bar. Reordering is the desktop bar
  only.
- **Sections on this page** — the top-level sections of whichever view is
  open, discovered live rather than listed in code, so a panel added to a
  view next month shows up here with no work. Reorder, hide, or jump
  straight into the inspector for one.

### Blocks
Put something new on the page: an announcement above the ladder, a sponsor
strip under the feed, a note that the nets are down.

Pick an element first — that is the anchor — then add a block above it,
below it, or inside it at the top or bottom. Blocks carry the class
`fgta-block`, so the CSS tab can style them all at once.

Scripts, iframes, inline `on*` handlers and `javascript:` URLs are stripped
when a block is applied. That is not a trust boundary — an admin can
already publish arbitrary CSS to every visitor — it is there so that a
pasted "embed code" cannot quietly run a third party's script on every
visitor's browser. That is a different class of accident from a bad colour,
and it should not be one paste away.

### Features
Switches for behaviour rather than appearance: particle effects, sound,
transitions, the cinematic intro, the HUD grid, weather theming, cursor
tilt, the podium, stadium mode, the install prompt.

Everything is on unless you turn it off, so a feature added to this list
later is on for every existing site.

### CSS
Applied after everything else, so it wins. The escape hatch for anything
the controls above do not reach — and the one place where a typo can make
the site unusable, so look at the preview before you publish.

The studio panel is insulated from it, on purpose: a stray
`label{display:none}` should not take down the thing you need to undo it.

### Presets
Six complete palettes (Neon grape, Court clay, Grass season, Night hard
court, Paper, Mono press) applied as a starting point you then edit — they
move surfaces and text together, because changing an accent without moving
the surfaces under it is how a site ends up with an unreadable button.

Also **Copy JSON** / **Paste JSON** for moving a config between projects,
and **Reset everything**.

### History
Every publish, newest first. Restoring loads that version as a draft;
nothing changes for anyone until you publish it.

---

## How it works, and what that costs

Nearly every surface in this app is a template string re-run by `render()`,
so anything written into the DOM is one refresh away from being wiped. So
almost nothing is written into the DOM. The config compiles to a
stylesheet:

| What you change        | How it is applied                                |
|------------------------|--------------------------------------------------|
| Colours, shape         | Custom properties inline on `<html>` + an `!important` rule that outranks the skin and weather themes |
| Typography             | Generated rules on the three font tokens         |
| Hiding                 | `display:none` rules                             |
| Reordering             | Flex `order` on `:nth-child`, never a DOM move   |
| Per-element restyling  | One generated rule per selector                  |
| Features               | A rule, or a documented hook into a global       |
| **Copy**               | **Written into the DOM, re-laid by a MutationObserver** |
| **Blocks**             | **Written into the DOM, re-laid by a MutationObserver** |

A stylesheet cannot be clobbered by `innerHTML`, so all of the first six
survive every re-render for free and cost nothing per frame. Copy and
blocks are the two that cannot be expressed in CSS, and they are what the
observer exists for — coalesced into one `requestAnimationFrame`, so a busy
feed refresh is hundreds of mutations and one re-apply.

There is also a pre-paint bootstrap near the top of `index.html`: the last
config this browser saw is cached in `localStorage` and re-applied
synchronously before `<body>` is parsed, so a visitor does not watch the
built-in palette flash and get repainted.

### The honest limits

**A key is a position in the markup.** The studio addresses an element by a
CSS selector — its `id` if it has one, otherwise a chain of
`tag:nth-of-type(n)` steps down from the nearest ided ancestor. So an
override follows the *position*, not the *content*. Editing the site's
furniture is durable; editing the third row of the match list is not, and
the inspector says so when you select one.

**Reordering makes a container a flexbox.** `order` only means anything
inside a flex or grid container, so a column of block-level panels is made
one. Adjacent margins no longer collapse in flex, so a reordered column can
sit slightly looser than it did. Containers that are already flex or grid —
the nav bar, most toolbars — are left exactly as they are.

**Blocks are `<fgta-block>` custom elements, not divs.** Inserting an
element into a container renumbers that container, which would break every
positional key inside it. A custom element can never be caught by a
`div:nth-of-type()` key, the order rules count with
`:nth-child(N of :not([data-fgta-block]))`, and anchor resolution skips
block nodes so a block cannot become its own anchor.

**New features still need code.** This changes how the site looks and what
of it is switched on. A genuinely new capability — a different scoring
model, another data view — is still a code change.

---

## Where the permission actually is

In Postgres. `site_config`'s RLS policies check `is_admin()`; `publish_site_config()`
re-checks it and raises if the caller is not an admin. The ✎ button and the
`isAdmin` branches in the client are there so a non-admin is not shown a
control that would fail — they are not the control.

Read on `site_config` is public and unauthenticated on purpose: the config
*is* the site, so a signed-out visitor has to be able to fetch it. Nothing
secret goes in it.

Every publish is written to the existing admin audit log as well as to
`site_config_history`.

---

## Tests

```
node test/studio.test.js          # theme, type, nav, order, features, CSS, presets, reload
node test/studio-pick.test.js     # hover, click-to-select, inspect, restyle, hide, Esc
node test/studio-blocks.test.js   # add, edit, sanitise, re-render, reload, delete
node test/studio-direct.test.js   # toolbar, inline typing, undo/redo, drag-to-reorder
node test/studio-publish.test.js  # the server half: load, realtime, publish, history
node test/studio-scope.test.js    # change one, change all like it
node test/site-config-sql.test.js # the two SQL files agree, and stay re-runnable
```

`site-config-sql` needs neither a browser nor a network — it is a plain
file comparison plus the guards that keep the migration safe to paste
twice.

`studio-publish` exists because of a bug that shipped and that the other four
could not see. The studio guarded every Supabase call with `window.sb`, but
`sb` is a top-level `let` — a *script-scope* binding that never becomes a
window property — so every server call was skipped and Publish reported
"Not connected to the database" against a healthy project. Everything else
still worked, because drafts live in `localStorage`.

The harness records each call on `window.__sb`, and the rule those tests
encode is: **assert the call happened, not only that the page changed.**

They drive the real file in a real browser against a stubbed Supabase — see
`test/studio-harness.js`. They need Playwright and a Chromium build; the
harness honours `CHROMIUM_PATH` and `PLAYWRIGHT_BROWSERS_PATH` if Chromium
is a system build rather than one Playwright downloaded.

---

## Config shape

```jsonc
{
  "v": 1,
  "theme":  { "--accent": "#ff2d78" },              // token -> value
  "type":   { "bodyFont": "'Sora',sans-serif",
              "scale": "1.05", "tracking": "-0.01" },
  "text":   { "#topTabs>button:nth-of-type(3)": "Games" },   // selector -> copy
  "hidden": { "[data-view=\"doubles\"]": true },
  "order":  { "#view-ladder": [3, 1, 2] },          // permutation of original positions
  "elcss":  { "#board": "border-radius:0;padding:8px" },
  "nav":    { "labels": { "predict": "Crystal Ball" } },
  "blocks": [ { "id": "b1", "name": "Nets notice", "anchor": "#board",
                "position": "before", "html": "<h3>Nets down</h3>",
                "enabled": true } ],
  "features": { "podium": false },                  // absent = on
  "css":    ".panel{border-radius:0}",
  "meta":   { "siteName": "FGTA" },
  "skin":   null                                    // null = leave as coded, "" = off
}
```

Every key is optional and every one defaults to "change nothing", so an
empty object and a fresh install are the same thing — and a config written
by an older version of the studio still loads.
