import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { ipRestriction } from "hono/ip-restriction";
import { createApp } from "./app.js";

interface Config {
  students: string[];
  parentPin: string;
  setsDir?: string;
  dbPath?: string;
  port?: number;
  /** "0.0.0.0" lets other devices on the home Wi-Fi connect; "127.0.0.1" allows this computer only. */
  host?: string;
  /** Networks other devices may connect from, e.g. "10.10.50.0/24". This computer is always allowed. */
  allowedNetworks?: string[];
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
const host = config.host ?? "0.0.0.0";
const allowedNetworks = config.allowedNetworks ?? [];

const app = new Hono();
// Refuse every device that isn't this computer or on an allowed home network, before anything else runs.
app.use(
  "*",
  ipRestriction(getConnInfo, { allowList: ["127.0.0.1", "::1", ...allowedNetworks] }, (remote, c) =>
    c.text(`Not allowed: ${remote.addr} is not on the home network.`, 403),
  ),
);
app.route(
  "/",
  createApp({
    db: new DatabaseSync(dbPath),
    setsDir,
    students: config.students,
    parentPin: config.parentPin,
  }),
);
// The screens, built by `vite build` into dist/web. Any other page path (e.g. /parent) gets the app shell.
const webDir = resolve(import.meta.dirname, "../../dist/web");
if (!existsSync(webDir)) fail(`The screens haven't been built. Run "npm start" (it builds them) or "npm run build".`);
app.all("/api/*", (c) => c.json({ error: "Not found." }, 404));
app.use("/assets/*", serveStatic({ root: webDir }));
app.get("*", serveStatic({ path: `${webDir}/index.html` }));

serve({ fetch: app.fetch, port, hostname: host }, () => {
  console.log(`CAT Simulator running`);
  console.log(`  On this computer: http://localhost:${port}`);
  if (host === "0.0.0.0") {
    for (const { name, address } of homeNetworkAddresses()) {
      console.log(`  On the home Wi-Fi: http://${address}:${port}  (${name})`);
    }
  }
  console.log(`  Allowed devices: this computer${allowedNetworks.map((n) => `, ${n}`).join("")}`);
  console.log(`  Exercise Sets: ${setsDir}`);
  console.log(`  Logs:          ${dbPath}`);
});

/** Virtual adapters (Docker, VMs, VPN tunnels) whose addresses other devices at home can't use. */
const VIRTUAL_ADAPTER = /^(docker|br-|veth|virbr|vmnet|vboxnet|tun|tap|wg|tailscale|utun)/;

/** This computer's IPv4 addresses on the home network (e.g. 192.168.1.20), by adapter name. */
function homeNetworkAddresses(): { name: string; address: string }[] {
  return Object.entries(networkInterfaces())
    .filter(([name]) => !VIRTUAL_ADAPTER.test(name))
    .flatMap(([name, infos = []]) =>
      infos.filter((i) => i.family === "IPv4" && !i.internal).map((i) => ({ name, address: i.address })),
    );
}
