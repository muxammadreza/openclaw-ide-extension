/**
 * SchemaManager
 *
 * Resolves the JSON schema for openclaw.json for a specific openclaw version.
 * Merges plugin schema contributions on top of the base schema.
 *
 * Discovery priority (highest → lowest):
 *   1. Files shipped with the LOCAL openclaw package installation
 *      (version-exact; highest fidelity)
 *   2. Per-version cache on disk (avoids re-fetching on each activation)
 *   3. Bundled schema in this extension (always available, version-agnostic fallback)
 *
 * Plugin contributions are discovered from:
 *   a. package.json "openclaw.schemaContributions" field of each plugin
 *   b. A `openclaw-schema.json` / `schema.json` file in the plugin root
 *   c. Hardcoded well-known plugin schemas (see wellKnownPlugins.ts)
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { OpenClawPlugin, RuntimeInfo } from './openclawRuntime';
import { WELL_KNOWN_PLUGIN_SCHEMAS, WellKnownPluginSchema } from './wellKnownPlugins';

export interface ResolvedSchema {
  schema: Record<string, any>;
  /** Human-readable source label for the status bar. */
  source: 'local-install' | 'cache' | 'bundled';
  version: string;
}

export class SchemaManager {
  private readonly cacheDir: string;
  private readonly bundledSchemaPath: string;
  private memCache = new Map<string, ResolvedSchema>();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.cacheDir = path.join(context.globalStorageUri.fsPath, 'schemas');
    this.bundledSchemaPath = path.join(context.extensionPath, 'schemas', 'openclaw.schema.json');
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Get (and cache) the resolved schema for a given runtime.
   * If runtime is null (openclaw not installed), returns the bundled schema.
   */
  async resolve(runtime: RuntimeInfo | null): Promise<ResolvedSchema> {
    const version = runtime?.version ?? 'bundled';

    // Fast path: in-memory
    if (this.memCache.has(version)) {
      return this.memCache.get(version)!;
    }

    let result = await this.tryFromLocalInstall(runtime);
    if (!result) {
      result = this.tryFromDiskCache(version);
    }
    if (!result) {
      result = this.loadBundled(version);
    }

    // Merge plugin contributions on top
    if (runtime && runtime.plugins.length > 0) {
      result = await this.mergePluginContributions(result, runtime.plugins);
    }

    this.memCache.set(version, result);

    // Persist to disk cache if sourced from local install (for offline use next time)
    if (result.source === 'local-install') {
      this.writeDiskCache(version, result.schema);
    }

    return result;
  }

  /** Clear all caches (e.g. when user runs "Refresh Schema"). */
  clearCache(): void {
    this.memCache.clear();
  }

  /** Write the resolved schema to a known path so VS Code's jsonValidation can reference it. */
  writeActiveSchema(schema: Record<string, any>): string {
    const dest = path.join(this.context.globalStorageUri.fsPath, 'openclaw-active.schema.json');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(schema, null, 2), 'utf8');
    return dest;
  }

  // ── Source 1: Local package install ───────────────────────────────────────

  private async tryFromLocalInstall(runtime: RuntimeInfo | null): Promise<ResolvedSchema | null> {
    if (!runtime?.packageDir) {
      return null;
    }

    // Candidate schema file paths inside the openclaw package directory
    const candidates = [
      'dist/config-schema.json',
      'dist/schema/openclaw.schema.json',
      'schema/openclaw.schema.json',
      'schemas/openclaw.schema.json',
      'src/config-schema.json',
      'config-schema.json',
      'openclaw.schema.json',
      // TypeScript-generated JSON schemas
      'dist/types/config.schema.json',
      'dist/generated/schema.json',
    ];

    for (const rel of candidates) {
      const full = path.join(runtime.packageDir, rel);
      if (!fs.existsSync(full)) {
        continue;
      }
      try {
        const raw = fs.readFileSync(full, 'utf8');
        const schema = JSON.parse(raw) as Record<string, any>;
        if (this.looksLikeSchema(schema)) {
          return { schema, source: 'local-install', version: runtime.version };
        }
      } catch {
        // corrupt file — try next
      }
    }

    // Try introspecting via the CLI: `openclaw config schema --json`
    const cliSchema = await this.tryCliSchema(runtime);
    if (cliSchema) {
      return { schema: cliSchema, source: 'local-install', version: runtime.version };
    }

    return null;
  }

  private tryCliSchema(runtime: RuntimeInfo): Promise<Record<string, any> | null> {
    // Derive the binary path from the package dir
    const binaryPath = this.resolveBinaryFromPackageDir(runtime.packageDir);
    if (!binaryPath) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      // Try multiple sub-commands that openclaw might expose
      const subCmds = [
        'config schema --json',
        'schema --json',
        'config schema dump',
      ];

      let idx = 0;
      const tryNext = () => {
        if (idx >= subCmds.length) {
          resolve(null);
          return;
        }
        const sub = subCmds[idx++];
        const { exec } = require('child_process') as typeof import('child_process');
        exec(`"${binaryPath}" ${sub}`, { timeout: 10000 }, (err, stdout) => {
          if (err || !stdout?.trim()) {
            tryNext();
            return;
          }
          try {
            const schema = JSON.parse(stdout) as Record<string, any>;
            if (this.looksLikeSchema(schema)) {
              resolve(schema);
            } else {
              tryNext();
            }
          } catch {
            tryNext();
          }
        });
      };
      tryNext();
    });
  }

  private resolveBinaryFromPackageDir(pkgDir: string): string | null {
    if (!pkgDir) {
      return null;
    }
    const candidates = [
      path.join(pkgDir, 'bin', 'openclaw.js'),
      path.join(pkgDir, 'bin', 'openclaw'),
      path.join(pkgDir, '..', '.bin', 'openclaw'),
      path.join(pkgDir, '..', '.bin', 'openclaw.cmd'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return c;
      }
    }
    return null;
  }

  // ── Source 2: Disk cache ──────────────────────────────────────────────────

  private tryFromDiskCache(version: string): ResolvedSchema | null {
    const cachePath = this.diskCachePath(version);
    if (!fs.existsSync(cachePath)) {
      return null;
    }
    try {
      const schema = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as Record<string, any>;
      return { schema, source: 'cache', version };
    } catch {
      return null;
    }
  }

  private writeDiskCache(version: string, schema: Record<string, any>): void {
    try {
      fs.writeFileSync(this.diskCachePath(version), JSON.stringify(schema, null, 2), 'utf8');
    } catch {
      // non-fatal
    }
  }

  private diskCachePath(version: string): string {
    const safe = version.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(this.cacheDir, `${safe}.schema.json`);
  }

  // ── Source 3: Bundled schema ──────────────────────────────────────────────

  private loadBundled(version: string): ResolvedSchema {
    const schema = JSON.parse(fs.readFileSync(this.bundledSchemaPath, 'utf8')) as Record<string, any>;
    return { schema, source: 'bundled', version };
  }

  // ── Plugin schema merging ─────────────────────────────────────────────────

  private async mergePluginContributions(
    base: ResolvedSchema,
    plugins: OpenClawPlugin[],
  ): Promise<ResolvedSchema> {
    // Deep-clone the schema to avoid mutating the cached copy
    const schema: Record<string, any> = JSON.parse(JSON.stringify(base.schema));

    for (const plugin of plugins) {
      const contrib = await this.loadPluginSchema(plugin);
      if (contrib) {
        this.applySchemaContributions(schema, contrib, plugin.id);
      }
    }

    return { ...base, schema };
  }

  private async loadPluginSchema(plugin: OpenClawPlugin): Promise<PluginContribution | null> {
    // 1. Check well-known built-in schemas first
    const wellKnown = WELL_KNOWN_PLUGIN_SCHEMAS.find(
      (s) => s.id === plugin.id || plugin.id.endsWith(s.id.replace(/^@openclaw\//, '/')),
    );
    if (wellKnown) {
      return wellKnown.contribution;
    }

    // 2. Try plugin's package.json "openclaw.schemaContributions"
    if (plugin.dir) {
      const pkgPath = path.join(plugin.dir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
            openclaw?: { schemaContributions?: PluginContribution };
          };
          if (pkg.openclaw?.schemaContributions) {
            return pkg.openclaw.schemaContributions;
          }
        } catch {
          // continue
        }
      }

      // 3. Look for a dedicated schema file in the plugin root
      const schemaCandidates = [
        'openclaw-schema.json',
        'schema.json',
        'dist/schema.json',
        'dist/openclaw-schema.json',
      ];
      for (const rel of schemaCandidates) {
        const full = path.join(plugin.dir, rel);
        if (!fs.existsSync(full)) {
          continue;
        }
        try {
          const raw = JSON.parse(fs.readFileSync(full, 'utf8')) as any;
          // Accept either a full contribution object or a raw JSON schema
          if (raw.channels || raw.tools || raw.skills || raw.properties) {
            return raw as PluginContribution;
          }
          if (raw.$schema || raw.type === 'object') {
            // It's a raw JSON schema for the full config; merge as-is
            return { rawSchema: raw };
          }
        } catch {
          // continue
        }
      }
    }

    return null;
  }

  /**
   * Apply a plugin's schema contributions to the base schema.
   *
   * A contribution can declare:
   *   channels   – new channel sub-schemas (merged into channels.properties)
   *   tools      – new tool entries (merged into tools.properties.allow.items.enum)
   *   skills     – new skill names
   *   properties – arbitrary root-level properties to add
   *   definitions – new definitions to add
   *   rawSchema   – a full schema to deep-merge (used as last resort)
   */
  private applySchemaContributions(
    schema: Record<string, any>,
    contrib: PluginContribution,
    pluginId: string,
  ): void {
    // Ensure safe paths exist
    schema.properties ??= {};
    schema.definitions ??= {};

    // channels.<id>
    if (contrib.channels) {
      schema.properties.channels ??= { type: 'object', properties: {}, additionalProperties: false };
      schema.properties.channels.properties ??= {};
      // When plugin adds a channel, it needs to be allowed by additionalProperties
      // Switch to true so unknown plugin channels don't error
      schema.properties.channels.additionalProperties = true;

      for (const [channelId, channelSchema] of Object.entries(contrib.channels)) {
        schema.properties.channels.properties[channelId] = {
          description: `${channelId} channel (provided by plugin ${pluginId})`,
          ...(channelSchema as object),
        };
      }
    }

    // tools.allow.items.enum
    if (contrib.tools && Array.isArray(contrib.tools)) {
      try {
        const toolEnum: string[] =
          schema.properties?.tools?.properties?.allow?.items?.enum ?? [];
        for (const t of contrib.tools) {
          if (!toolEnum.includes(t)) {
            toolEnum.push(t);
          }
        }
        if (schema.properties?.tools?.properties?.allow?.items) {
          schema.properties.tools.properties.allow.items.enum = toolEnum;
        }
      } catch {
        // non-fatal
      }
    }

    // skills (add known skill names to completions — stored as a custom extension field)
    if (contrib.skills && Array.isArray(contrib.skills)) {
      schema['x-openclaw-skills'] ??= [];
      for (const s of contrib.skills) {
        if (!(schema['x-openclaw-skills'] as string[]).includes(s)) {
          (schema['x-openclaw-skills'] as string[]).push(s);
        }
      }
    }

    // Arbitrary root properties
    if (contrib.properties) {
      schema.properties.additionalProperties = true; // allow plugin root keys
      for (const [key, val] of Object.entries(contrib.properties)) {
        schema.properties[key] = {
          description: `Provided by plugin ${pluginId}`,
          ...(val as object),
        };
      }
    }

    // Extra definitions (e.g. shared sub-schemas referenced via $ref)
    if (contrib.definitions) {
      for (const [key, val] of Object.entries(contrib.definitions)) {
        schema.definitions[`plugin.${pluginId}.${key}`] = val;
      }
    }

    // Raw full-schema deep-merge (last resort)
    if (contrib.rawSchema) {
      deepMerge(schema, contrib.rawSchema as Record<string, any>);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private looksLikeSchema(obj: Record<string, any>): boolean {
    // Heuristic: must be an object with at least some of these JSON schema fields
    return (
      obj !== null &&
      typeof obj === 'object' &&
      (obj['$schema'] || obj['type'] === 'object' || obj['properties'] || obj['definitions'])
    );
  }
}

// ── Plugin contribution type ──────────────────────────────────────────────────

export interface PluginContribution {
  /** New channel sub-schemas keyed by channel ID. */
  channels?: Record<string, object>;
  /** Additional allowed tool category names. */
  tools?: string[];
  /** Additional skill names. */
  skills?: string[];
  /** Additional root-level config properties. */
  properties?: Record<string, object>;
  /** Additional JSON schema definitions. */
  definitions?: Record<string, object>;
  /** Full raw JSON schema (deep-merged as fallback). */
  rawSchema?: object;
}

// ── Shallow deep-merge (non-destructive) ─────────────────────────────────────

function deepMerge(target: Record<string, any>, source: Record<string, any>): void {
  for (const [key, val] of Object.entries(source)) {
    if (
      val !== null &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      typeof target[key] === 'object' &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      deepMerge(target[key] as Record<string, any>, val as Record<string, any>);
    } else if (!(key in target)) {
      // Only add, never overwrite existing keys
      target[key] = val;
    }
  }
}
