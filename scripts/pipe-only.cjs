// The same race with no app: drives `pipeToNodeResponse` from this project's `next` on a plain
// node:http server. usage: node scripts/pipe-only.cjs. Exit 1 = the pipe never settled.
"use strict";
const http = require("node:http");
const { pipeToNodeResponse } = require("next/dist/server/pipe-readable.js");

const server = http.createServer(async (req, res) => {
  res.on("close", () => console.log(`res 'close': writableEnded=${res.writableEnded} writableFinished=${res.writableFinished}`));
  res.on("finish", () => console.log("res 'finish'"));
  // The bytes stay in flight: the socket's write callback never runs.
  res.socket.write = () => true;
  const end = res.end;
  res.end = function (...args) {
    const result = end.apply(this, args);
    // The client resets now: after end(), before 'finish'.
    res.socket.destroy(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
    return result;
  };
  const settled = pipeToNodeResponse(new Response('{"ok":true}').body, res).then(
    () => "settled",
    (e) => `rejected: ${e.message}`,
  );
  const outcome = await Promise.race([settled, new Promise((r) => setTimeout(() => r("STILL PENDING after 3 s"), 3000))]);
  console.log(`pipeToNodeResponse: ${outcome}`);
  process.exit(outcome.startsWith("STILL") ? 1 : 0);
});

server.listen(0, () => http.get({ port: server.address().port, path: "/" }).on("error", () => {}));
