import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

interface Config {
  students: string[];
  parentPin: string;
  setsDir?: string;
  dbPath?: string;
  port?: number;
}

const CONFIG_FILE = "cat-simulator.config.json";

function readConfig(): Config {
  if (!existsSync(CONFIG_FILE)) {
    fail(
      `Missing ${CONFIG_FILE}.\n` +
        `Copy cat-simulator.config.example.json to ${CONFIG_FILE} and put in your Students' names and a Parent PIN.`,
    );
  }
  const config = JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Partial<Config>;
  if (!Array.isArray(config.students) || config.students.length === 0) fail(`${CONFIG_FILE}: "students" needs at least one name.`);
  if (typeof config.parentPin !== "string" || config.parentPin === "") fail(`${CONFIG_FILE}: "parentPin" is missing.`);
  return config as Config;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const config = readConfig();
const setsDir = resolve(config.setsDir ?? "sets");
if (!existsSync(setsDir)) fail(`The Exercise Sets folder ${setsDir} doesn't exist. Create it and add a set, e.g. sets/001/1-math.md.`);
const dbPath = resolve(config.dbPath ?? "cat.sqlite");
const port = config.port ?? 3000;

const app = createApp({
  db: new DatabaseSync(dbPath),
  setsDir,
  students: config.students,
  parentPin: config.parentPin,
});
app.get("/", (c) => c.text("CAT Simulator server is running. The Student and Parent screens are not built yet."));

// Listen on this computer only.
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  console.log(`CAT Simulator running at http://localhost:${port}`);
  console.log(`  Exercise Sets: ${setsDir}`);
  console.log(`  Logs:          ${dbPath}`);
});
