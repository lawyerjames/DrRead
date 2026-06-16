const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4173);
const root = __dirname;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
};

function resolvePath(url) {
  const requestPath = decodeURIComponent(new URL(url, `http://localhost:${port}`).pathname);
  const normalizedPath = path
    .normalize(requestPath)
    .replace(/^([/\\])+/, "")
    .replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(root, normalizedPath === "" ? "index.html" : normalizedPath);

  if (!filePath.startsWith(root)) {
    return null;
  }

  return filePath;
}

const server = http.createServer((request, response) => {
  const filePath = resolvePath(request.url);

  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(content);
  });
});

function getNetworkUrls() {
  const urls = [`http://127.0.0.1:${port}/`];
  const interfaces = os.networkInterfaces();

  Object.values(interfaces).forEach((items) => {
    items
      .filter((item) => item.family === "IPv4" && !item.internal)
      .forEach((item) => urls.push(`http://${item.address}:${port}/`));
  });

  return [...new Set(urls)];
}

server.listen(port, host, () => {
  console.log("DrRead is running:");
  getNetworkUrls().forEach((url) => console.log(`  ${url}`));
});
