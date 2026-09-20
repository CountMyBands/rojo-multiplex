import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { normalizeConfig } from "../manager.mjs";

test("loads individually configured projects and groups by containing folder", () => {
  const root = mkdtempSync(join(tmpdir(), "rojo-multiplex-"));
  const games = join(root, "games");
  mkdirSync(games);
  const alpha = join(games, "alpha.project.json");
  const beta = join(games, "beta.project.json");
  writeFileSync(alpha, JSON.stringify({ name: "Alpha" }));
  writeFileSync(beta, JSON.stringify({ name: "Beta" }));

  const config = normalizeConfig({ projects: [{ projectPath: alpha }, { projectPath: beta }] }, join(root, "config.json"));
  assert.deepEqual(config.projects.map((project) => project.name), ["Alpha", "Beta"]);
  assert.equal(config.projects[0].folderPath, config.projects[1].folderPath);
  assert.deepEqual(config.projects.map((project) => project.proxyPort), [34900, 34901]);
});

test("preserves internal ports and running preference", () => {
  const root = mkdtempSync(join(tmpdir(), "rojo-multiplex-"));
  const projectPath = join(root, "default.project.json");
  writeFileSync(projectPath, JSON.stringify({ name: "Game" }));
  const config = normalizeConfig({
    projects: [{ projectPath, proxyPort: 35555, backendPort: 46666, desiredRunning: true }],
  }, join(root, "config.json"));
  assert.equal(config.projects[0].proxyPort, 35555);
  assert.equal(config.projects[0].backendPort, 46666);
  assert.equal(config.projects[0].desiredRunning, true);
});
