// Preloaded into `next start` (NODE_OPTIONS=--require). It touches no Next internals: it wraps the
// listener Next passes to node:http's createServer and counts the listener promises that have not
// settled. GET /__pending answers with every request whose listener is still pending after 2 s.
//
// A request carrying `x-reset-after-end: 1` gets the race forced instead of waited for: its
// socket's write callback never runs (as for bytes still in flight), and the socket is reset
// right after res.end(), so the response emits 'close' and never 'finish'.
"use strict";
const http = require("node:http");

const open = new Map();
let next = 0;
const createServer = http.createServer;
http.createServer = function tracked(...args) {
  const at = args.findIndex((a) => typeof a === "function");
  if (at === -1) return createServer.apply(this, args);
  const listener = args[at];
  args[at] = function (req, res) {
    if (req.url === "/__pending") {
      const now = Date.now();
      const pending = [...open.values()]
        .filter((e) => now - e.since > 2000)
        .map((e) => ({
          url: e.url,
          forced: e.forced,
          pendingMs: now - e.since,
          writableEnded: e.res.writableEnded,
          writableFinished: e.res.writableFinished,
          destroyed: e.res.destroyed,
        }));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ pending: pending.length, requests: pending }));
      return;
    }
    const forced = req.headers["x-reset-after-end"] === "1";
    if (forced) {
      res.socket.write = () => true;
      const end = res.end;
      res.end = function (...a) {
        const result = end.apply(this, a);
        res.socket.destroy(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
        return result;
      };
    }
    const id = next++;
    open.set(id, { url: req.url, forced, since: Date.now(), res });
    const result = listener.call(this, req, res);
    Promise.resolve(result).finally(() => open.delete(id));
    return result;
  };
  return createServer.apply(this, args);
};
