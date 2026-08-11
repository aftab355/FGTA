# Running your own stream relay

Two phones on the same wifi connect to each other directly and this whole page
is irrelevant. The problem is the normal case: someone filming at the court on
mobile data, someone watching at home. Both sit behind NAT that drops
unsolicited inbound packets, so neither can reach the other. The only way
through is a **TURN relay** — a machine with an address both sides can reach
outbound, which forwards the video between them.

FGTA ships with a free public relay (`openrelay.metered.ca`). It costs nothing
and needs no setup, but it is shared, rate-limited and often simply
unavailable. When it is, the stream fails to connect and there is nothing on
screen to say why. **That is the most common cause of "it worked at home but
not at the court".**

A PC left on at home fixes this permanently. It only needs to be on while
someone is streaming.

---

## 1. Install coturn

**Linux**

```sh
sudo apt install coturn
```

**Windows** — easiest inside WSL2, then follow the Linux steps. **macOS** —
`brew install coturn`.

## 2. Configure it

Create `/etc/turnserver.conf`:

```conf
listening-port=3478
realm=fgta
lt-cred-mech

# pick your own — this is the credential you type into the app
user=fgta:CHANGE-THIS-PASSWORD

# the relay hands these out to peers; must match what you forward in step 3
min-port=49160
max-port=49200

no-tls
no-dtls
no-multicast-peers

# only if the machine has a static public IP directly (rare at home) —
# with a home router you almost always want to leave this out
# external-ip=YOUR.PUBLIC.IP
```

Start it:

```sh
sudo systemctl enable --now coturn
```

If it refuses to start, run `turnserver -c /etc/turnserver.conf` by hand — it
prints the reason and exits.

## 3. Forward the ports on your router

In your router's admin page, forward to the PC's local address:

| Protocol | Port(s)       | Why                        |
|----------|---------------|----------------------------|
| UDP + TCP| 3478          | where clients first connect|
| UDP      | 49160–49200   | where the media flows      |

The media range is the part people forget, and without it the relay allocates
but no video ever arrives.

## 4. Give it a name that survives your IP changing

Home connections get a new public IP periodically. Use any dynamic-DNS
provider (DuckDNS, No-IP, Cloudflare) to get a hostname like
`yourname.duckdns.org` that follows it.

## 5. Point the app at it

On each device: **Matches → Point Tracker → 🛰 connection**

| Field    | Value                          |
|----------|--------------------------------|
| URL      | `turn:yourname.duckdns.org:3478` |
| username | `fgta`                         |
| password | whatever you set in step 2     |

Tap **save relay**, then **test connection**. You want:

```
✅ TURN relay allocated on your own server — cross-network streaming should work
```

If you get `❌ no TURN relay`, the app is reaching the internet but not your
relay: check port 3478 is forwarded, the hostname resolves, and the password
matches. Any error the TURN server returned is printed underneath.

Everyone who wants to use your relay enters the same three values. It is stored
on that device only and never leaves it.

---

## Notes

- **Your relay is tried first**, with the public ones kept behind it. A
  misconfigured private relay therefore degrades to the current behaviour
  rather than breaking streaming entirely.
- **Bandwidth**: relayed video is roughly 2–3 Mbps per viewer per angle, in
  *and* out of your PC. Three viewers on two angles is ~15 Mbps each way at
  peak. Check that against your upload before a big match.
- **The relay only forwards packets.** It cannot read the video: WebRTC
  encrypts end to end, and nothing is stored on the relay. It is a pipe, not a
  server.
- **Recordings do not go through it.** Recording is separate — it saves to the
  device doing the recording, or to Google Drive if that is connected. Using
  the PC as a recording target is a different feature and does not exist yet.
