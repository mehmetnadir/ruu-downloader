# Ruu Helper

A ~700-line Go program that does one thing: **fetch byte ranges over HTTP and write
them into a file at the right offset.** Nothing else.

It exists because a browser extension cannot do two things:

| Limit | Why the browser can't | What the helper does |
|---|---|---|
| 6 connections per host | `g_max_sockets_per_group` is a Chromium constant | opens as many as you tell it to |
| Downloads stop when you close the browser | no browser, no extension | keeps running as its own process |

## The deal we are offering you

You are being asked to run a binary on your machine. That deserves scepticism, so
here is exactly what you get and what you can check.

**What it does not do.** No auto-update. No telemetry. No analytics. No crash
reporting. It never phones home — the only hosts it contacts are the download URLs
the extension hands it. It executes nothing, installs nothing, and touches no file
outside the download directory you choose.

**What it listens on.** `127.0.0.1` only — never `0.0.0.0`, so nothing outside your
machine can reach it. Every request must carry a token that is generated fresh on
each start and handed to the extension over Chrome's native-messaging channel, which
only the extension ID baked into the installed manifest can open. A random program on
your machine that guesses the port still cannot talk to it.

**Why it will rarely change.** All the intelligence lives in the extension: how many
connections to use, how to split the file, when to back off, how to resume, how to
rename, which host is throttling. The helper is a dumb pipe that takes a job
description and executes it. That is deliberate — a binary you rarely have to update
is a binary you can actually audit once and keep.

**How to verify it.** The source is this directory; it is small enough to read in one
sitting. Builds are reproducible:

```
CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -buildid=" -o ruu-helper .
shasum -a 256 ruu-helper
```

The published checksum for each release is in `CHECKSUMS.txt`. If yours matches, the
binary you are running is the source you just read.

**How to remove it.** Quit it and delete the file. It has no installer, no service
registration you did not ask for, no registry keys, and no leftovers.

## Protocol

The extension speaks HTTP to `127.0.0.1:<port>`, `Authorization: Bearer <token>`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | version + capabilities |
| POST | `/jobs` | start a job (url, headers, dest, connections) |
| GET | `/jobs/{id}` | progress, completed ranges, error |
| DELETE | `/jobs/{id}` | cancel; partial file and journal are kept |

`GET /jobs/{id}` returns the acknowledged byte ranges, so the extension can resume a
job in its own engine if the helper is stopped — the two are interchangeable, and the
extension is always the source of truth.
