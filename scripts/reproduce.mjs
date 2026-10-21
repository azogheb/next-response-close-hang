// Drives a running `npm run start:tracked` server and reports how many request listeners never
// settled. usage:
//   node scripts/reproduce.mjs forced [requests=20]   the race forced on every request
//   node scripts/reproduce.mjs natural [rounds=3000]  real client resets on kept-alive sockets
import http from "node:http";
import { Worker } from "node:worker_threads";

const port = Number(process.env.PORT ?? 3000);
const [mode = "forced", countArg] = process.argv.slice(2);

function get(path, { headers = {}, agent, abortMs } = {}) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path, headers, agent }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
      res.on("error", () => resolve("res-error"));
    });
    req.on("error", (e) => resolve(e.code ?? "error"));
    if (abortMs !== undefined) setTimeout(() => req.destroy(), abortMs);
  });
}

const tally = {};
const count = (k) => (tally[k] = (tally[k] ?? 0) + 1);

if (mode === "forced") {
  const n = Number(countArg ?? 20);
  for (let i = 0; i < n; i++) count(await get("/api/hang", { headers: { "x-reset-after-end": "1" } }));
} else {
  // Two identical GETs 1 ms apart on kept-alive sockets, each answered after the same random
  // 0-20 ms, the second destroyed within a couple of ms of that answer. BUSY=<n> spins n threads
  // to load the CPU, which widens the window between res.end() and 'finish'.
  const rounds = Number(countArg ?? 3000);
  const busy = Array.from({ length: Number(process.env.BUSY ?? 0) }, () => new Worker("for(;;){}", { eval: true }));
  const agent = new http.Agent({ keepAlive: true, maxSockets: 6 });
  for (let r = 0; r < rounds; r++) {
    const delay = Math.floor(Math.random() * 20);
    const path = `/api/hang?delay=${delay}&size=${process.env.SIZE ?? 0}`;
    const first = get(path, { agent });
    await new Promise((x) => setTimeout(x, 1));
    const second = get(path, { agent, abortMs: Math.max(0, delay - 1 + Math.floor(Math.random() * 4)) });
    for (const answer of await Promise.all([first, second])) count(answer);
  }
  agent.destroy();
  for (const w of busy) await w.terminate();
}
console.log(`${mode}: client saw`, tally);

await new Promise((x) => setTimeout(x, 3000));
const { pending, requests } = JSON.parse(await new Promise((resolve) => {
  http.get({ host: "127.0.0.1", port, path: "/__pending" }, (res) => {
    let body = "";
    res.on("data", (c) => (body += c));
    res.on("end", () => resolve(body));
  });
}));
console.log(`request listeners still pending 3 s later: ${pending}`);
if (requests.length) console.log(requests.slice(0, 3));
process.exit(pending > 0 ? 1 : 0);
