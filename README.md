# A route handler's request listener never settles when the client resets between `res.end()` and `'finish'`

Built from the Next.js [App Router reproduction template](https://github.com/vercel/next.js/tree/canary/examples/reproduction-template). Verified on `next@16.5.0-canary.21` (pinned in `package-lock.json`), Node 24.16.0, macOS. First seen on 16.4.0, where `repro:pipe` fails the same way.

`createWriterFromResponse` (`packages/next/src/server/pipe-readable.ts`) ends the response in `close()` with `res.end(); return finished.promise`, and `finished` resolves only on `res.once('finish')`. When the client resets after `end()` but before the final write completes, Node emits `'close'` and never `'finish'`, so `close()` stays pending, then `pipeToNodeResponse`, `sendResponse` and the request listener `next start` gives `http.createServer`. The pipe's abort signal cannot rescue it: a `WritableStream` abort waits for the in-flight `close()`.

## What is here

- `app/api/hang/route.ts`: an ordinary `GET` route handler. `?delay=<ms>` waits before answering; `?size=<bytes>` pads the JSON body.
- `scripts/track-pending.cjs`: preloaded into `next start`. It wraps only the listener passed to `node:http`'s `createServer` and counts listener promises that have not settled; `GET /__pending` lists those older than 2 s. A request with header `x-reset-after-end: 1` gets the race forced: its socket's write callback never runs and the socket is reset right after `res.end()`.
- `scripts/reproduce.mjs`: the client. `forced` sends requests with that header; `natural` sends pairs of GETs on kept-alive sockets and destroys the second within a few ms of its answer, with no server-side forcing.
- `scripts/pipe-only.cjs`: the same race with no app, calling `pipeToNodeResponse` from this project's `next` on a plain `http` server.
- `scripts/apply-fix.mjs`: applies the one-line fix below to `node_modules/next` in place (undo with `npm ci`).

## Steps

```bash
npm install
npm run build
PORT=3000 npm run start:tracked     # next start, with the listener counter preloaded
```

In a second terminal:

```bash
npm run repro:forced                # 20 requests, the race forced on each
SIZE=100000 npm run repro:natural   # 3000 pairs of GETs, 100 KB bodies, real client resets
npm run repro:pipe                  # no server needed
```

Restart `start:tracked` between runs: the counter is cumulative.

## Expected

Every request listener settles once its response closes: `request listeners still pending 3 s later: 0`, and `pipeToNodeResponse: settled`.

## Actual

| Run (fresh `next start` each, 16.5.0-canary.21) | Listeners still pending |
| --- | --- |
| `repro:forced` (20 requests) | 20 |
| `repro:natural`, `SIZE=0` (6000 requests, 2243 reset) | 0 |
| `repro:natural`, `SIZE=100000` (6000 requests, 2380 reset) | 229 |
| `repro:natural`, `SIZE=2000000` (6000 requests, 3000 reset) | 808 |
| `repro:pipe` | `pipeToNodeResponse: STILL PENDING after 3 s` |

Each stuck request reports `writableEnded: true, writableFinished: true, destroyed: true`: the response is gone, `'finish'` never fired, and the listener's promise (with everything its closure holds) is retained for the life of the process. The natural counts vary run to run (a second `SIZE=100000` run left 57).

## The fix

Resolve `finished` on `'close'` too, in `createWriterFromResponse`:

```ts
res.once('close', () => finished.resolve())
```

`npm run apply-fix`, then `rm -rf .next && npm run build` (Turbopack bundles the ESM copy of `pipe-readable.js` into `.next/server/chunks`), then the same runs: `repro:forced` 0 pending, `SIZE=100000` 0, `SIZE=2000000` 0, `repro:pipe` settled.
