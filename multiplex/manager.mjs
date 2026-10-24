import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { connect as netConnect } from "node:net";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultConfigPath = join(moduleDir, "rojo-multiplex.json");
const defaultConfig = {
  managerPort: 34871,
  bindAddress: "127.0.0.1",
  proxyPortStart: 34900,
  backendPortStart: 46000,
  rojoCommand: "rojo",
  projects: [],
};
const maxProjectLogLines = 500;
const maxProjectLogBytes = 1_000_000;

let activeManager = null;

function writeCli(message) {
  if (process.env.ROJO_MULTIPLEX_EMBEDDED === "1") return;
  const stream = process.stdout;
  if (!stream || stream.destroyed || !stream.writable) return;
  try {
    stream.write(message, () => {});
  } catch (error) {
    if (error?.code !== "EPIPE") throw error;
  }
}

function parseArgs(argv) {
  const result = { config: defaultConfigPath };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--config" && argv[index + 1]) result.config = resolve(argv[++index]);
    else if (argv[index] === "--help" || argv[index] === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return result;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function projectName(path) {
  try {
    const value = readJson(path);
    if (typeof value.name === "string" && value.name.trim()) return value.name.trim();
  } catch {
    // Existing malformed projects are reported by Rojo when started.
  }
  return basename(path).replace(/\.project\.jsonc?$/i, "");
}

function stableId(path) {
  const label = projectName(path).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
  const hash = createHash("sha1").update(path.toLowerCase()).digest("hex").slice(0, 7);
  return `${label}-${hash}`;
}

function nextFreePort(used, start, forbidden) {
  let port = start;
  while (used.has(port) || forbidden?.has(port)) port += 1;
  used.add(port);
  return port;
}

export function normalizeConfig(rawConfig = {}, configPath = defaultConfigPath) {
  const configDir = dirname(configPath);
  const managerPort = Number(rawConfig.managerPort ?? defaultConfig.managerPort);
  const proxyPortStart = Number(rawConfig.proxyPortStart ?? defaultConfig.proxyPortStart);
  const backendPortStart = Number(rawConfig.backendPortStart ?? defaultConfig.backendPortStart);
  const usedProxyPorts = new Set();
  const usedBackendPorts = new Set();
  const forbidden = new Set([managerPort]);

  const projects = (rawConfig.projects ?? []).map((rawEntry) => {
    const entry = typeof rawEntry === "string" ? { project: rawEntry } : rawEntry;
    const pathValue = entry.projectPath ?? entry.project;
    const projectPath = isAbsolute(pathValue) ? resolve(pathValue) : resolve(configDir, pathValue);
    const proxyPort = entry.proxyPort == null ? nextFreePort(usedProxyPorts, proxyPortStart, forbidden) : Number(entry.proxyPort);
    usedProxyPorts.add(proxyPort);
    const backendPort = entry.backendPort == null ? nextFreePort(usedBackendPorts, backendPortStart) : Number(entry.backendPort);
    usedBackendPorts.add(backendPort);
    return {
      id: entry.id ? String(entry.id) : stableId(projectPath),
      name: entry.name ? String(entry.name) : projectName(projectPath),
      projectPath,
      folderPath: dirname(projectPath),
      proxyPort,
      backendPort,
      desiredRunning: entry.desiredRunning === true,
      state: "stopped",
      detail: null,
      child: null,
      proxy: null,
      stopping: false,
      restartTimer: null,
      autoRestartAttempts: 0,
      lastCrashDetail: null,
    };
  });

  return {
    managerPort,
    proxyPortStart,
    backendPortStart,
    bindAddress: String(rawConfig.bindAddress ?? defaultConfig.bindAddress),
    rojoCommand: String(rawConfig.rojoCommand ?? defaultConfig.rojoCommand),
    projects,
  };
}

function serializableConfig(config) {
  return {
    managerPort: config.managerPort,
    bindAddress: config.bindAddress,
    proxyPortStart: config.proxyPortStart,
    backendPortStart: config.backendPortStart,
    rojoCommand: config.rojoCommand,
    projects: config.projects.map((project) => ({
      id: project.id,
      name: project.name,
      projectPath: project.projectPath,
      proxyPort: project.proxyPort,
      backendPort: project.backendPort,
      desiredRunning: project.desiredRunning,
    })),
  };
}

function saveConfig(config, configPath) {
  writeFileSync(configPath, `${JSON.stringify(serializableConfig(config), null, 2)}\n`, "utf8");
}

function cleanLogText(value) {
  return String(value).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\r\n]+/g, " ").trim();
}

function prepareProjectLogging(project, configPath) {
  const logsDir = join(dirname(configPath), "logs");
  mkdirSync(logsDir, { recursive: true });
  project.logPath = join(logsDir, `${project.id}.log`);
  project.logs = [];
  project.lastOutput = null;
  project.lastCrashDetail = null;
  if (existsSync(project.logPath)) {
    project.logs = readFileSync(project.logPath, "utf8").split(/\r?\n/).filter(Boolean).slice(-maxProjectLogLines);
  }
  logProject(project, "gateway", "Gateway session started");
}

function logProject(project, source, message) {
  const text = cleanLogText(message);
  if (!text || !project.logPath) return;
  const line = `[${new Date().toISOString()}] [${source}] ${text}`;
  project.logs.push(line);
  if (project.logs.length > maxProjectLogLines) project.logs.splice(0, project.logs.length - maxProjectLogLines);
  appendFileSync(project.logPath, `${line}\n`, "utf8");
  if (statSync(project.logPath).size > maxProjectLogBytes) {
    writeFileSync(project.logPath, `${project.logs.join("\n")}\n`, "utf8");
  }
}

function clearProjectLog(project) {
  project.logs = [];
  writeFileSync(project.logPath, "", "utf8");
  logProject(project, "gateway", "Log cleared");
}

function publicProject(project) {
  return {
    id: project.id,
    name: project.name,
    folderPath: project.folderPath,
    projectPath: project.projectPath,
    host: "localhost",
    port: project.proxyPort,
    state: project.state,
    detail: project.detail,
    pid: project.child?.pid ?? null,
  };
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cache-Control", "no-store");
}

function sendJson(response, status, value) {
  if (response.destroyed) return;
  setCorsHeaders(response);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function rewriteHeaders(headers, backendPort) {
  const result = { ...headers, host: `localhost:${backendPort}` };
  if (typeof result.origin === "string") {
    result.origin = result.origin.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?/i, `$1localhost:${backendPort}`);
  }
  return result;
}

function createProjectProxy(project, bindAddress) {
  const upgradedSockets = new Set();
  const server = createHttpServer((request, response) => {
    if (project.state !== "running") {
      return sendJson(response, 503, { error: `Rojo project '${project.name}' is ${project.state}`, detail: project.detail });
    }
    const upstream = httpRequest({
      hostname: "127.0.0.1",
      port: project.backendPort,
      method: request.method,
      path: request.url,
      headers: rewriteHeaders(request.headers, project.backendPort),
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.on("error", (error) => {
      logProject(project, "proxy", `Backend request failed: ${error.message}`);
      if (response.headersSent) response.destroy(error);
      else sendJson(response, 502, { error: "Rojo backend unavailable", detail: error.message });
    });
    request.pipe(upstream);
  });

  server.on("upgrade", (request, clientSocket, head) => {
    if (project.state !== "running") return clientSocket.destroy();
    upgradedSockets.add(clientSocket);
    clientSocket.on("close", () => upgradedSockets.delete(clientSocket));
    const upstreamSocket = netConnect(project.backendPort, "127.0.0.1", () => {
      const headers = rewriteHeaders(request.headers, project.backendPort);
      const lines = [`${request.method} ${request.url} HTTP/${request.httpVersion}`];
      for (const [name, value] of Object.entries(headers)) {
        if (Array.isArray(value)) for (const item of value) lines.push(`${name}: ${item}`);
        else if (value !== undefined) lines.push(`${name}: ${value}`);
      }
      upstreamSocket.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length) upstreamSocket.write(head);
      clientSocket.pipe(upstreamSocket).pipe(clientSocket);
    });
    upstreamSocket.on("error", (error) => {
      logProject(project, "proxy", `WebSocket backend failed: ${error.message}`);
      clientSocket.destroy();
    });
    clientSocket.on("error", () => upstreamSocket.destroy());
  });

  server.on("error", (error) => {
    project.state = "error";
    project.detail = `Proxy failed: ${error.message}`;
    logProject(project, "proxy", project.detail);
  });
  server.__upgradedSockets = upgradedSockets;
  server.listen(project.proxyPort, bindAddress);
  return server;
}

function startRojo(project, config) {
  if (project.child || project.state === "starting" || project.state === "running") return;
  if (project.restartTimer) clearTimeout(project.restartTimer);
  project.restartTimer = null;
  project.stopping = false;
  project.state = "starting";
  project.detail = "Starting Rojo...";
  if (!project.proxy) project.proxy = createProjectProxy(project, config.bindAddress);

  const args = ["serve", project.projectPath, "--address", "127.0.0.1", "--port", String(project.backendPort)];
  const bundledRojo = join(moduleDir, "bin", process.platform === "win32" ? "rojo.exe" : "rojo");
  const rojoCommand = process.env.ROJO_MULTIPLEX_ROJO || (existsSync(bundledRojo) ? bundledRojo : config.rojoCommand);
  project.lastOutput = null;
  project.lastCrashDetail = null;
  logProject(project, "gateway", `Starting Rojo on backend port ${project.backendPort}: ${rojoCommand} ${args.join(" ")}`);
  // Run from the project's folder so toolchain-manager shims (Rokit, Aftman,
  // Foreman) resolve the Rojo version that project pins.
  const child = spawn(rojoCommand, args, { cwd: project.folderPath, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  project.child = child;
  const buffers = { stdout: "", stderr: "" };
  const processLine = (source, line) => {
    const text = cleanLogText(line);
    if (!text) return;
    project.lastOutput = text;
    if (source === "stderr" && /\bDetails:/i.test(text)) project.lastCrashDetail = text;
    project.detail = text;
    logProject(project, source, text);
    if (/server listening|visit http/i.test(text)) {
      project.state = "running";
      project.detail = null;
      project.autoRestartAttempts = 0;
    }
    writeCli(`[${project.name}] ${text}\n`);
  };
  const consume = (source, chunk) => {
    buffers[source] += chunk.toString();
    const lines = buffers[source].split(/\r?\n/);
    buffers[source] = lines.pop() ?? "";
    for (const line of lines) processLine(source, line);
  };
  const flush = () => {
    for (const source of ["stdout", "stderr"]) {
      if (buffers[source]) processLine(source, buffers[source]);
      buffers[source] = "";
    }
  };
  child.stdout.on("data", (chunk) => consume("stdout", chunk));
  child.stderr.on("data", (chunk) => consume("stderr", chunk));
  child.on("error", (error) => {
    project.state = "error";
    project.detail = error.message;
    logProject(project, "gateway", `Could not launch Rojo: ${error.message}`);
  });
  child.on("exit", (code, signal) => {
    flush();
    project.child = null;
    if (project.stopping) {
      project.state = "stopped";
      project.detail = null;
      logProject(project, "gateway", `Rojo stopped (${signal ?? code ?? "unknown"})`);
      if (project.desiredRunning) setTimeout(() => startRojo(project, config), 250);
    } else {
      const exitReason = `Rojo exited (${signal ?? code ?? "unknown"})`;
      const crashDetail = project.lastCrashDetail ?? project.lastOutput;
      project.state = "error";
      project.detail = crashDetail ? `${exitReason}: ${crashDetail}` : exitReason;
      logProject(project, "gateway", project.detail);
      if (project.desiredRunning) {
        project.autoRestartAttempts += 1;
        const retryDelay = Math.min(1_000 * (2 ** (project.autoRestartAttempts - 1)), 10_000);
        project.detail = `${project.detail} — retrying in ${retryDelay / 1_000}s`;
        logProject(project, "gateway", `Automatic recovery attempt ${project.autoRestartAttempts} scheduled in ${retryDelay / 1_000}s`);
        project.restartTimer = setTimeout(() => {
          project.restartTimer = null;
          startRojo(project, config);
        }, retryDelay);
      }
    }
  });
}

function stopRojo(project) {
  project.desiredRunning = false;
  project.stopping = true;
  if (project.restartTimer) clearTimeout(project.restartTimer);
  project.restartTimer = null;
  logProject(project, "gateway", "Stopping Rojo");
  if (project.child && !project.child.killed) project.child.kill();
  else {
    project.state = "stopped";
    project.detail = null;
  }
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  for (const socket of server.__upgradedSockets ?? []) socket.destroy();
  server.closeAllConnections?.();
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

export function createManager(config, { configPath = defaultConfigPath } = {}) {
  for (const project of config.projects) prepareProjectLogging(project, configPath);
  for (const project of config.projects) if (project.desiredRunning) startRojo(project, config);

  const indexPath = join(moduleDir, "public", "index.html");
  const iconPath = join(moduleDir, "electron", "assets", "icon-source.png");
  const managerServer = createHttpServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://localhost:${config.managerPort}`);
      if (request.method === "OPTIONS") {
        setCorsHeaders(response);
        response.writeHead(204, { "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "content-type" });
        return response.end();
      }
      if (request.method === "GET" && url.pathname === "/api/projects") {
        return sendJson(response, 200, { version: 1, projects: config.projects.map(publicProject) });
      }
      if (request.method === "GET" && url.pathname === "/api/status") {
        return sendJson(response, 200, { ok: true, projects: config.projects.map(publicProject) });
      }
      if (request.method === "POST" && url.pathname === "/api/projects") {
        const body = await readBody(request);
        const projectPath = resolve(String(body.projectPath ?? ""));
        if (!/\.project\.jsonc?$/i.test(projectPath)) return sendJson(response, 400, { error: "Choose a .project.json or .project.jsonc file." });
        if (!existsSync(projectPath)) return sendJson(response, 400, { error: "Project file does not exist." });
        try { readJson(projectPath); } catch (error) { return sendJson(response, 400, { error: `Project JSON is invalid: ${error.message}` }); }
        const existing = config.projects.find((project) => project.projectPath.toLowerCase() === projectPath.toLowerCase());
        if (existing) return sendJson(response, 200, { project: publicProject(existing), existing: true });

        const proxyPorts = new Set(config.projects.map((project) => project.proxyPort));
        const backendPorts = new Set(config.projects.map((project) => project.backendPort));
        const project = {
          id: stableId(projectPath),
          name: projectName(projectPath),
          folderPath: dirname(projectPath),
          projectPath,
          proxyPort: nextFreePort(proxyPorts, config.proxyPortStart, new Set([config.managerPort])),
          backendPort: nextFreePort(backendPorts, config.backendPortStart),
          desiredRunning: false,
          state: "stopped",
          detail: null,
          child: null,
          proxy: null,
          stopping: false,
          restartTimer: null,
          autoRestartAttempts: 0,
          lastCrashDetail: null,
        };
        prepareProjectLogging(project, configPath);
        config.projects.push(project);
        saveConfig(config, configPath);
        return sendJson(response, 201, { project: publicProject(project) });
      }

      const match = url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(start|stop|restart|logs))?$/);
      if (match) {
        const project = config.projects.find((item) => item.id === decodeURIComponent(match[1]));
        if (!project) return sendJson(response, 404, { error: "Unknown project." });
        if (request.method === "GET" && match[2] === "logs") {
          return sendJson(response, 200, { project: publicProject(project), lines: project.logs, logPath: project.logPath });
        }
        if (request.method === "DELETE" && match[2] === "logs") {
          clearProjectLog(project);
          return sendJson(response, 200, { ok: true, lines: project.logs, logPath: project.logPath });
        }
        if (request.method === "POST" && match[2] === "start") {
          project.desiredRunning = true;
          startRojo(project, config);
          saveConfig(config, configPath);
          return sendJson(response, 200, { project: publicProject(project) });
        }
        if (request.method === "POST" && match[2] === "stop") {
          stopRojo(project);
          saveConfig(config, configPath);
          return sendJson(response, 200, { project: publicProject(project) });
        }
        if (request.method === "POST" && match[2] === "restart") {
          stopRojo(project);
          project.desiredRunning = true;
          setTimeout(() => startRojo(project, config), 500);
          saveConfig(config, configPath);
          return sendJson(response, 200, { project: publicProject(project) });
        }
        if (request.method === "DELETE" && !match[2]) {
          stopRojo(project);
          await closeServer(project.proxy);
          config.projects = config.projects.filter((item) => item !== project);
          saveConfig(config, configPath);
          return sendJson(response, 200, { removed: project.id });
        }
      }

      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        return response.end(readFileSync(indexPath, "utf8"));
      }
      if (request.method === "GET" && url.pathname === "/app-icon.png") {
        response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
        return response.end(readFileSync(iconPath));
      }
      return sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      return sendJson(response, 500, { error: error.message });
    }
  });
  managerServer.listen(config.managerPort, config.bindAddress);

  const close = async () => {
    for (const project of config.projects) stopRojo(project);
    await Promise.all(config.projects.map((project) => closeServer(project.proxy)));
    await closeServer(managerServer);
  };
  return { config, managerServer, close };
}

export async function start({ configPath = defaultConfigPath } = {}) {
  if (activeManager) return activeManager;
  if (!existsSync(configPath)) writeFileSync(configPath, `${JSON.stringify(defaultConfig, null, 2)}\n`, "utf8");
  const config = normalizeConfig(readJson(configPath), configPath);
  activeManager = createManager(config, { configPath });
  writeCli(`Rojo Multiplex manager: http://${config.bindAddress}:${config.managerPort}\n`);
  return activeManager;
}

export async function shutdown() {
  if (!activeManager) return;
  const manager = activeManager;
  activeManager = null;
  await manager.close();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log("Usage: node manager.mjs [--config path/to/rojo-multiplex.json]");
  await start({ configPath: args.config });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await shutdown();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
