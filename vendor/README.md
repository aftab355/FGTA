# vendor/

Third-party libraries the scoreboard video export needs, served from this
origin rather than a CDN.

| file | package | version | licence |
|---|---|---|---|
| `mp4-muxer.min.js` | [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) | 5.2.2 | MIT |
| `webm-muxer.min.js` | [webm-muxer](https://github.com/Vanilagy/webm-muxer) | 5.0.3 | MIT |

They are copied verbatim from
`https://cdn.jsdelivr.net/npm/<package>@<version>/build/<package>.min.js`,
and each defines one global (`Mp4Muxer`, `WebMMuxer`).

**Why they live here and not on a CDN.** The export is the one feature on
this site that is supposed to work with no signal at all — a phone at a court
with the app already open. A `<script src="https://cdn…">` is a network
request like any other, and the service worker deliberately does not touch
cross-origin requests, so a CDN copy is exactly the thing that is missing
when it is needed. Served from here they are precached in the shell (see
`sw.js`) and are there offline, behind an ad blocker, and on a school
network that only allows this domain.

Neither is loaded at page load — `sbxLoadMuxer()` in index.html injects
whichever one the chosen codec needs, the first time an export runs.

To update one: download the new minified build into this folder, bump the
version in the table above, and bump `VERSION` in `sw.js` so installed
copies drop the old precache.
