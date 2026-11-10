import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { handleFeedback, handleRecommend, contractBody } from "./service.js";
import { FileMuseStore, MemoryMuseStore } from "../feedback/store.js";
import { MemoryCatalog } from "../pipeline.js";
import { API_VERSION, MODEL_VERSION } from "../schemas/constants.js";
import { apiError } from "../util.js";

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error("payload too large");
        error.code = "too_large";
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

function send(res, result) {
  const payload = JSON.stringify(result.body);
  res.writeHead(result.statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...CORS_HEADERS,
  });
  res.end(payload);
}

export function createServer(options = {}) {
  const store = options.store ?? new MemoryMuseStore();
  const catalog = options.catalog ?? null;
  const maxBytes = options.maxBytes ?? 1_000_000;
  const deps = { store, catalog, config: options.config, now: options.now };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }
      if (req.method === "GET" && url.pathname === "/health") {
        send(res, {
          statusCode: 200,
          body: { ok: true, api_version: API_VERSION, model_version: MODEL_VERSION, personalization: "baseline" },
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/outfits/contract") {
        send(res, { statusCode: 200, body: contractBody() });
        return;
      }
      if (url.pathname === "/v1/outfits/recommend" || url.pathname === "/v1/outfits/feedback") {
        if (req.method !== "POST") {
          send(res, apiError(405, "method_not_allowed", "Use POST."));
          return;
        }
        const raw = await readBody(req, maxBytes);
        let body;
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          send(res, apiError(400, "invalid_json", "Request body must be JSON."));
          return;
        }
        const result =
          url.pathname === "/v1/outfits/recommend" ? handleRecommend(body, deps) : handleFeedback(body, deps);
        send(res, result);
        return;
      }
      send(res, apiError(404, "not_found", "No Muse route matches this path."));
    } catch (error) {
      if (error.code === "too_large") {
        send(res, apiError(413, "payload_too_large", "The request body exceeds the size limit."));
        return;
      }
      send(res, apiError(500, "internal_error", "Muse failed while handling the request."));
    }
  });
  return server;
}

function parseArgs(argv) {
  const args = {
    port: Number(process.env.PORT) || 8787,
    wardrobe: process.env.MUSE_WARDROBE_FILE ?? null,
    data: process.env.MUSE_DATA_DIR ?? null,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--port") args.port = Number(argv[++index]);
    else if (flag === "--wardrobe") args.wardrobe = argv[++index];
    else if (flag === "--data") args.data = argv[++index];
  }
  return args;
}

export function loadCatalog(file) {
  if (!file) return null;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return new MemoryCatalog(parsed);
}

function main() {
  const args = parseArgs(process.argv);
  const store = args.data ? new FileMuseStore(args.data) : new MemoryMuseStore();
  const server = createServer({ store, catalog: loadCatalog(args.wardrobe) });
  const host = process.env.MUSE_HOST || "0.0.0.0";
  server.listen(args.port, host, () => {
    process.stdout.write(`Muse listening on http://${host}:${args.port}\n`);
  });
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  main();
}
