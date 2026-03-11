#!/usr/bin/env node
/**
 * generate-schema.mjs
 *
 * Generates an accurate openclaw.schema.json from the installed OpenClaw npm package's
 * TypeScript type declarations. Can be run:
 *
 *   1. Manually to regenerate the bundled schema:
 *        node scripts/generate-schema.mjs [openclaw-pkg-dir]
 *
 *   2. Automatically by SchemaManager at runtime when a version mismatch is detected.
 *
 * Approach:
 *   - Uses ts-json-schema-generator to convert dist/plugin-sdk/config/types.openclaw.d.ts
 *     → JSON Schema Draft 7, which VS Code's JSON language service supports.
 *   - Enhances the output with extension channel schemas (feishu, line, matrix, etc.)
 *     bundled inside the openclaw package's extensions/ directory.
 *
 * Usage:
 *   node scripts/generate-schema.mjs [<openclaw-pkg-dir>] [--out <path>]
 *
 * Environment variables:
 *   OPENCLAW_PKG_DIR  - Alternate way to pass the package directory.
 *
 * Output:
 *   If --out is given, writes to that path.
 *   Otherwise, prints JSON to stdout.
 *   Exits 0 on success, 1 on failure.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ── Argument parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let pkgDir = args.find((a) => !a.startsWith("--")) ?? process.env["OPENCLAW_PKG_DIR"] ?? "";
let outPath = "";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out" && args[i + 1]) {
    outPath = args[i + 1];
    i++;
  }
}

if (!pkgDir) {
  // Try to resolve openclaw from the module graph
  try {
    const require = createRequire(import.meta.url);
    const resolved = require.resolve("openclaw/package.json");
    pkgDir = resolved.replace(/[\\/]package\.json$/, "");
  } catch {
    // not found in node_modules
  }
}

if (!pkgDir) {
  process.stderr.write(
    "Usage: generate-schema.mjs <openclaw-pkg-dir> [--out <path>]\n" +
    "  Or set OPENCLAW_PKG_DIR environment variable.\n",
  );
  process.exit(1);
}

pkgDir = resolve(pkgDir);

// ── Locate the main type entry point ─────────────────────────────────────────

const MAIN_TYPES_FILE = join(pkgDir, "dist", "plugin-sdk", "config", "types.openclaw.d.ts");

if (!existsSync(MAIN_TYPES_FILE)) {
  process.stderr.write(`Error: Type definitions not found at: ${MAIN_TYPES_FILE}\n`);
  process.stderr.write(`Make sure the path points to the openclaw package root.\n`);
  process.exit(1);
}

// ── Run ts-json-schema-generator ──────────────────────────────────────────────

/**
 * Resolve the ts-json-schema-generator binary:
 *   1. Local node_modules (from extension or openclaw)
 *   2. Global npm / npx
 */
function findTsJsonSchemaGenerator() {
  // Search in extension dir, openclaw pkg dir, and global
  const candidates = [
    join(__dirname, "..", "node_modules", ".bin", "ts-json-schema-generator"),
    join(pkgDir, "node_modules", ".bin", "ts-json-schema-generator"),
    // Windows variants
    join(__dirname, "..", "node_modules", ".bin", "ts-json-schema-generator.cmd"),
    join(pkgDir, "node_modules", ".bin", "ts-json-schema-generator.cmd"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }
  return null;
}

function generateSchema(typesFile, typeName) {
  const bin = findTsJsonSchemaGenerator();
  const args = [
    "--path", typesFile,
    "--type", typeName,
    "--no-top-ref",
    "--expose", "all",
    "--jsDoc", "extended",
  ];

  let stdout;
  if (bin) {
    stdout = execFileSync(bin, args, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 120_000,
    }).toString("utf8");
  } else {
    // Fall back to npx
    stdout = execFileSync("npx", ["--yes", "ts-json-schema-generator", ...args], {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 300_000,
      shell: process.platform === "win32",
    }).toString("utf8");
  }

  return JSON.parse(stdout);
}

process.stderr.write(`Generating schema from: ${MAIN_TYPES_FILE}\n`);
let schema;
try {
  schema = generateSchema(MAIN_TYPES_FILE, "OpenClawConfig");
} catch (e) {
  process.stderr.write(`Error generating schema: ${e.message}\n`);
  process.exit(1);
}

// ── Enhance the schema ────────────────────────────────────────────────────────

// Read the package version to track which openclaw version produced this schema
let openclawVersion = "unknown";
try {
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  openclawVersion = pkg.version ?? "unknown";
} catch {
  // ignore
}

schema["$id"] = "https://openclaw.ai/schemas/openclaw.schema.json";
schema["title"] = "OpenClaw Configuration";
schema["description"] =
  "Configuration schema for openclaw.json — " +
  "the personal AI assistant gateway. " +
  "See https://docs.openclaw.ai/gateway/configuration for documentation.";
schema["x-openclaw-version"] = openclawVersion;

// Ensure $schema is listed as an optional string property if not already present
if (schema.properties && !schema.properties["$schema"]) {
  schema.properties["$schema"] = {
    type: "string",
    description: "JSON Schema identifier (optional). VS Code uses this to provide IntelliSense.",
  };
}

// ── Add extension channel schemas ─────────────────────────────────────────────
//
// Extension channels (feishu, line, matrix, mattermost, nextcloud-talk, nostr,
// tlon, twitch, zalo, synology-chat, etc.) are shipped as extensions/ subdirs
// within the openclaw package.  Their config schemas live in
// extensions/<name>/src/config-schema.ts  which we cannot execute directly,
// so we add well-known descriptions and basic shapes here.
//
// The ChannelsConfig type has [key: string]: any, so additionalProperties is
// already unconstrained — these entries just add documentation and completions.

const EXTENSION_CHANNELS = {
  feishu: {
    description: "Feishu / Lark channel integration (requires openclaw feishu extension).",
    type: "object",
    properties: {
      enabled: { type: "boolean" },
      appId: { type: "string", description: "Feishu app ID." },
      appSecret: { type: "string", description: "Feishu app secret. Prefer env-var reference." },
      encryptKey: { type: "string", description: "Feishu encrypt key for event webhook." },
      verificationToken: { type: "string" },
      domain: {
        type: "string",
        enum: ["feishu", "lark"],
        default: "feishu",
        description: 'Domain: "feishu" (default) or "lark".',
      },
      connectionMode: {
        type: "string",
        enum: ["websocket", "webhook"],
        default: "websocket",
        description:
          '"websocket" (default): long-lived WebSocket connection managed by Feishu. ' +
          '"webhook": traditional HTTP POST to a public URL; requires verificationToken.',
      },
      webhookPath: { type: "string", default: "/feishu/events" },
      dmPolicy: { $ref: "#/definitions/DmPolicy" },
      allowFrom: { type: "array", items: { type: "string" } },
      groupPolicy: { $ref: "#/definitions/GroupPolicy" },
      historyLimit: { type: "integer", minimum: 0 },
      configWrites: { type: "boolean", default: true },
      accounts: {
        type: "object",
        description: "Multi-account configuration.",
        additionalProperties: { type: "object" },
      },
      defaultAccount: { type: "string" },
    },
  },
  line: {
    description: "LINE channel integration (requires openclaw line extension).",
    type: "object",
    properties: {
      enabled: { type: "boolean" },
      channelAccessToken: { type: "string", description: "LINE channel access token." },
      channelSecret: { type: "string", description: "LINE channel secret." },
      webhookPath: { type: "string", default: "/line" },
      dmPolicy: { $ref: "#/definitions/DmPolicy" },
      allowFrom: { type: "array", items: { type: "string" } },
      groupPolicy: { $ref: "#/definitions/GroupPolicy" },
      historyLimit: { type: "integer", minimum: 0 },
      mediaMaxMb: { type: "number" },
    },
  },
  matrix: {
    description: "Matrix channel integration (requires openclaw matrix extension).",
    type: "object",
    properties: {
      enabled: { type: "boolean" },
      homeserverUrl: { type: "string", description: "Matrix homeserver URL (e.g. https://matrix.org)." },
      accessToken: { type: "string", description: "Matrix bot access token. Prefer env-var reference." },
      userId: { type: "string", description: "Full Matrix user ID (e.g. @bot:matrix.org)." },
      dmPolicy: { $ref: "#/definitions/DmPolicy" },
      allowFrom: { type: "array", items: { type: "string" } },
      groupPolicy: { $ref: "#/definitions/GroupPolicy" },
      historyLimit: { type: "integer", minimum: 0 },
      encryptionEnabled: { type: "boolean", default: false },
    },
  },
  mattermost: {
    description: "Mattermost channel integration (requires openclaw mattermost extension).",
    type: "object",
    properties: {
      enabled: { type: "boolean" },
      botToken: { type: "string", description: "Mattermost bot access token. Prefer env-var reference." },
      baseUrl: { type: "string", description: "Mattermost server base URL." },
      dmPolicy: { $ref: "#/definitions/DmPolicy" },
      allowFrom: { type: "array", items: { type: "string" } },
      groupPolicy: { $ref: "#/definitions/GroupPolicy" },
      chatmode: {
        type: "string",
        enum: ["oncall", "onmessage", "onchar"],
        default: "oncall",
      },
      historyLimit: { type: "integer", minimum: 0 },
      textChunkLimit: { type: "integer" },
      configWrites: { type: "boolean", default: true },
      accounts: {
        type: "object",
        additionalProperties: { type: "object" },
      },
      defaultAccount: { type: "string" },
    },
  },
  "nextcloud-talk": {
    description: "Nextcloud Talk channel integration (requires openclaw nextcloud-talk extension).",
    type: "object",
    properties: {
      enabled: { type: "boolean" },
      baseUrl: { type: "string", description: "Nextcloud instance URL." },
      username: { type: "string" },
      password: { type: "string", description: "Prefer env-var reference." },
      dmPolicy: { $ref: "#/definitions/DmPolicy" },
      allowFrom: { type: "array", items: { type: "string" } },
      groupPolicy: { $ref: "#/definitions/GroupPolicy" },
      pollIntervalMs: { type: "integer", default: 3000 },
    },
  },
  nostr: {
    description: "Nostr channel integration (requires openclaw nostr extension).",
    type: "object",
    properties: {
      enabled: { type: "boolean" },
      privateKey: { type: "string", description: "Nostr private key (nsec or hex). Prefer env-var reference." },
      relays: { type: "array", items: { type: "string" }, description: "WebSocket relay URLs." },
      dmPolicy: { $ref: "#/definitions/DmPolicy" },
      allowFrom: { type: "array", items: { type: "string" } },
      historyLimit: { type: "integer", minimum: 0 },
    },
  },
  synologychat: {
    description: "Synology Chat channel integration (requires openclaw synology-chat extension).",
    type: "object",
    properties: {
      enabled: { type: "boolean" },
      incomingWebhook: { type: "string", description: "Synology Chat incoming webhook URL." },
      token: { type: "string", description: "Synology Chat outgoing webhook token." },
      webhookPath: { type: "string", default: "/synologychat" },
      dmPolicy: { $ref: "#/definitions/DmPolicy" },
      allowFrom: { type: "array", items: { type: "string" } },
    },
  },
  tlon: {
    description: "Tlon/Urbit channel integration (requires openclaw tlon extension).",
    type: "object",
    properties: {
      enabled: { type: "boolean" },
      ship: { type: "string", description: "Urbit ship name (e.g. ~sampel-palnet)." },
      url: { type: "string", description: "Urbit ship URL." },
      code: { type: "string", description: "Urbit web login code. Prefer env-var reference." },
      dmPolicy: { $ref: "#/definitions/DmPolicy" },
      allowFrom: { type: "array", items: { type: "string" } },
    },
  },
  twitch: {
    description: "Twitch channel integration (requires openclaw twitch extension).",
    type: "object",
    properties: {
      enabled: { type: "boolean" },
      accessToken: { type: "string", description: "Twitch OAuth access token. Prefer env-var reference." },
      clientId: { type: "string" },
      channels: { type: "array", items: { type: "string" }, description: "Twitch channels to join." },
      dmPolicy: { $ref: "#/definitions/DmPolicy" },
      allowFrom: { type: "array", items: { type: "string" } },
      commandPrefix: { type: "string", default: "!" },
    },
  },
  webchat: {
    description: "WebChat (embedded web widget) channel integration.",
    type: "object",
    properties: {
      enabled: { type: "boolean" },
      path: { type: "string", default: "/chat" },
      allowOrigins: { type: "array", items: { type: "string" } },
      dmPolicy: { $ref: "#/definitions/DmPolicy" },
      historyLimit: { type: "integer", minimum: 0 },
    },
  },
  zalo: {
    description: "Zalo Official Account channel integration (requires openclaw zalo extension).",
    type: "object",
    properties: {
      enabled: { type: "boolean" },
      accessToken: { type: "string", description: "Zalo OA access token. Prefer env-var reference." },
      oaId: { type: "string", description: "Zalo Official Account ID." },
      webhookPath: { type: "string", default: "/zalo" },
      dmPolicy: { $ref: "#/definitions/DmPolicy" },
      allowFrom: { type: "array", items: { type: "string" } },
      historyLimit: { type: "integer", minimum: 0 },
      accounts: {
        type: "object",
        additionalProperties: { type: "object" },
      },
      defaultAccount: { type: "string" },
    },
  },
  zalouser: {
    description: "Zalo Personal (user) channel integration (requires openclaw zalouser extension).",
    type: "object",
    properties: {
      enabled: { type: "boolean" },
      phone: { type: "string", description: "Zalo personal phone number." },
      dmPolicy: { $ref: "#/definitions/DmPolicy" },
      allowFrom: { type: "array", items: { type: "string" } },
    },
  },
};

// Inject extension channels into ChannelsConfig
if (!schema.definitions) {
  schema.definitions = {};
}
if (!schema.definitions["ChannelsConfig"]) {
  schema.definitions["ChannelsConfig"] = { type: "object", properties: {} };
}
if (!schema.definitions["ChannelsConfig"].properties) {
  schema.definitions["ChannelsConfig"].properties = {};
}
for (const [channelId, channelSchema] of Object.entries(EXTENSION_CHANNELS)) {
  if (!schema.definitions["ChannelsConfig"].properties[channelId]) {
    schema.definitions["ChannelsConfig"].properties[channelId] = channelSchema;
  }
}

// Remove additionalProperties: false from ChannelsConfig to allow plugin channels
delete schema.definitions["ChannelsConfig"].additionalProperties;

// ── Output ────────────────────────────────────────────────────────────────────

const output = JSON.stringify(schema, null, 2) + "\n";

if (outPath) {
  writeFileSync(outPath, output, "utf8");
  process.stderr.write(`Schema written to: ${outPath}\n`);
} else {
  process.stdout.write(output);
}
