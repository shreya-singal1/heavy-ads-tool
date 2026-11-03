// Tiny static server for previewing the site locally (the same files GitHub Pages serves).
//   node serve.js        then open http://localhost:8080/
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8080;
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".md": "text/plain", ".json": "application/json" };

http
  .createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") { p = "/index.html"; }
    const file = path.normalize(path.join(__dirname, p));
    if (!file.startsWith(__dirname) || file.includes(path.sep + ".git")) { res.writeHead(403); res.end("forbidden"); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(data);
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log("site on http://localhost:" + PORT));
