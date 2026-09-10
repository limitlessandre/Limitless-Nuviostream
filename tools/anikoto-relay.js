"use strict";
// Bun/Node entry point; createRelay is separately embeddable and owns no server.
const http = require("node:http");
const {Readable} = require("node:stream");
const {createRelay} = require("./anikoto-relay-core");
async function start({port = 8787, ...options} = {}) {
  const relay = createRelay(options);
  const server = http.createServer(async (req, res) => {
    const address = server.address();
    if (req.headers.host !== "127.0.0.1:" + address.port) {res.writeHead(403); res.end("Loopback only"); return;}
    try {
      const request = new Request("http://127.0.0.1:" + address.port + req.url, {method: req.method, headers: req.headers});
      const response = await relay.handle(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) {res.end(); return;}
      const body = Readable.fromWeb(response.body);
      res.on("close", () => body.destroy());
      body.on("error", () => res.destroy()); body.pipe(res);
    } catch (_) {if (!res.headersSent) res.writeHead(502); res.end();}
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {server.once("error", reject); server.listen(port, "127.0.0.1", resolve);});
  return {relay, port: server.address().port, async close() {relay.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}};
}
if (require.main === module) start().then(app => {
  console.log("[AniKoto relay v4] http://127.0.0.1:" + app.port + "/health");
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => app.close().then(() => process.exit(0)));
}).catch(error => {console.error(error.message); process.exitCode = 1;});
module.exports = {start};
