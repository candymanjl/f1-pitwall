"use strict";

const http = require("http");
const { handleRelay } = require("./handler");

const PORT = Number(process.env.PORT || 8799);

function headerLookup(req) {
  return (name) => {
    const key = Object.keys(req.headers).find((h) => h.toLowerCase() === name.toLowerCase());
    return key ? String(req.headers[key] ?? "") : "";
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    void handleRelay({
      method: req.method || "GET",
      path: url.pathname,
      search: url.search,
      header: headerLookup(req),
      body: async () => Buffer.concat(chunks).toString("utf8"),
    }).then((result) => {
      res.writeHead(result.status, result.headers);
      res.end(result.body);
    });
  });
});

if (require.main === module) {
  server.listen(PORT, "127.0.0.1", () => {
    process.stdout.write(`OpenF1 relay listening on http://127.0.0.1:${PORT}\n`);
  });
}

module.exports = { server, PORT };
