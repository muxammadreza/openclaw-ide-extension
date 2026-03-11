/**
 * OpenClawRuntime
 *
 * Detects the locally installed openclaw binary, resolves its version,
 * package root, plugins directory, and the user's config path.
 *
 * Discovery order:
 *   1. Configured path in settings (openclaw.binaryPath)
 *   2. PATH lookup via `which`/`where`
 *   3. Common global npm / pnpm / bun install paths
 */
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface OpenClawPlugin {
  id: string;
  version: string;
  /** Resolved directory of the plugin package on disk. */
  dir: string;
}

export interface RuntimeInfo {
  version: string;          // e.g. "1.4.2"
  packageDir: string;       // e.g. "/usr/local/lib/node_modules/openclaw"
  configPath: string;       // e.g. "/home/user/.openclaw/openclaw.json"
  pluginsDir: string;       // e.g. "/home/user/.openclaw/plugins" or ""
  plugins: OpenClawPlugin[];
}

export class OpenClawRuntime {
  private cached: RuntimeInfo | null = null;
  private lastCheckMs = 0;
  private static CACHE_TTL_MS = 30_000; // 30 s

  /** Return cached or freshly-detected runtime info. Returns null if openclaw is not found. */
  async detect(forceRefresh = false): Promise<RuntimeInfo | null> {
    const now = Date.now();
    if (!forceRefresh && this.cached && now - this.lastCheckMs < OpenClawRuntime.CACHE_TTL_MS) {
      return this.cached;
    }

    const binaryPath = await this.findBinary();
    if (!binaryPath) {
      this.cached = null;
      return null;
    }

    const version = await this.readVersion(binaryPath);
    if (!version) {
      this.cached = null;
      return null;
    }

    const packageDir = await this.resolvePackageDir(binaryPath);
    const configPath = this.resolveConfigPath();
    const pluginsDir = this.resolvePluginsDir(configPath);
    const plugins = packageDir ? await this.discoverPlugins(packageDir, pluginsDir) : [];

    this.cached = { version, packageDir: packageDir ?? '', configPath, pluginsDir, plugins };
    this.lastCheckMs = now;
    return this.cached;
  }

  // ── Binary discovery ──────────────────────────────────────────────────────

  private async findBinary(): Promise<string | null> {
    // 1. User-configured path
    const cfg = vscode.workspace.getConfiguration('openclaw');
    const configured = cfg.get<string>('binaryPath', '').trim();
    if (configured && fs.existsSync(configured)) {
      return configured;
    }

    // 2. PATH / which / where
    const fromPath = await this.execWhich('openclaw');
    if (fromPath) {
      return fromPath;
    }

    // 3. Common global install locations
    const candidates = this.globalBinaryCandidates();
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return c;
      }
    }

    return null;
  }

  private globalBinaryCandidates(): string[] {
    const home = os.homedir();
    const candidates: string[] = [];

    if (process.platform === 'win32') {
      candidates.push(
        path.join(process.env['APPDATA'] ?? '', 'npm', 'openclaw.cmd'),
        path.join(home, '.bun', 'bin', 'openclaw.exe'),
        path.join(home, 'scoop', 'shims', 'openclaw.cmd'),
      );
    } else {
      candidates.push(
        '/usr/local/bin/openclaw',
        '/usr/bin/openclaw',
        path.join(home, '.local', 'bin', 'openclaw'),
        path.join(home, '.npm-global', 'bin', 'openclaw'),
        path.join(home, 'node_modules', '.bin', 'openclaw'),
        path.join(home, '.bun', 'bin', 'openclaw'),
        path.join(home, '.pnpm', 'bin', 'openclaw'),
        // Homebrew (Apple Silicon + Intel)
        '/opt/homebrew/bin/openclaw',
        '/usr/local/opt/openclaw/bin/openclaw',
        // nvm / volta / fnm common paths
        path.join(home, '.volta', 'bin', 'openclaw'),
        path.join(home, '.nvm', 'versions', 'node', 'current', 'bin', 'openclaw'),
      );
    }
    return candidates;
  }

  private execWhich(name: string): Promise<string | null> {
    const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`;
    return new Promise((resolve) => {
      cp.exec(cmd, (err, stdout) => {
        if (err || !stdout) {
          resolve(null);
          return;
        }
        resolve(stdout.split('\n')[0].trim() || null);
      });
    });
  }

  // ── Version detection ─────────────────────────────────────────────────────

  private readVersion(binaryPath: string): Promise<string | null> {
    return new Promise((resolve) => {
      cp.exec(`"${binaryPath}" --version`, { timeout: 8000 }, (err, stdout) => {
        if (err || !stdout) {
          resolve(null);
          return;
        }
        // Accept "1.2.3", "openclaw/1.2.3", "openclaw 1.2.3 node/22.0.0 ..."
        const m = /\b(\d+\.\d+\.\d+(?:-[\w.]+)?)\b/.exec(stdout);
        resolve(m ? m[1] : null);
      });
    });
  }

  // ── Package directory resolution ──────────────────────────────────────────

  /**
   * Follow symlinks from the binary to the actual package root.
   * e.g. /usr/local/bin/openclaw → /usr/local/lib/node_modules/openclaw/bin/openclaw.js
   *      → /usr/local/lib/node_modules/openclaw
   */
  private async resolvePackageDir(binaryPath: string): Promise<string | null> {
    try {
      // Resolve symlink chain
      const realBin = fs.realpathSync(binaryPath);
      // Walk up until we find a package.json that says "openclaw"
      let dir = path.dirname(realBin);
      for (let i = 0; i < 6; i++) {
        const pkg = path.join(dir, 'package.json');
        if (fs.existsSync(pkg)) {
          const data = JSON.parse(fs.readFileSync(pkg, 'utf8')) as { name?: string };
          if (data.name === 'openclaw') {
            return dir;
          }
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
          break;
        }
        dir = parent;
      }
    } catch {
      // fall through
    }

    // Fallback: try npm/pnpm global root
    const npmRoot = await this.execCmd('npm root -g');
    if (npmRoot) {
      const candidate = path.join(npmRoot.trim(), 'openclaw');
      if (fs.existsSync(path.join(candidate, 'package.json'))) {
        return candidate;
      }
    }

    const pnpmRoot = await this.execCmd('pnpm root -g');
    if (pnpmRoot) {
      const candidate = path.join(pnpmRoot.trim(), 'openclaw');
      if (fs.existsSync(path.join(candidate, 'package.json'))) {
        return candidate;
      }
    }

    return null;
  }

  // ── Config & plugins paths ────────────────────────────────────────────────

  resolveConfigPath(): string {
    const cfg = vscode.workspace.getConfiguration('openclaw');
    const custom = cfg.get<string>('configPath', '').trim();
    if (custom) {
      return custom;
    }
    return path.join(os.homedir(), '.openclaw', 'openclaw.json');
  }

  private resolvePluginsDir(configPath: string): string {
    const openclawDir = path.dirname(configPath);
    // Plugins can live in ~/.openclaw/plugins/ or ~/.openclaw/node_modules/
    const candidates = [
      path.join(openclawDir, 'plugins'),
      path.join(openclawDir, 'node_modules'),
      path.join(openclawDir, 'extensions'),
    ];
    return candidates.find(fs.existsSync) ?? path.join(openclawDir, 'plugins');
  }

  // ── Plugin discovery ──────────────────────────────────────────────────────

  private async discoverPlugins(packageDir: string, pluginsDir: string): Promise<OpenClawPlugin[]> {
    const plugins: OpenClawPlugin[] = [];
    const seen = new Set<string>();

    // 1. Try CLI: `openclaw plugins list --json`
    const cliPlugins = await this.pluginsFromCli();
    for (const p of cliPlugins) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        plugins.push(p);
      }
    }

    // 2. Scan the openclaw package's own node_modules for @openclaw/* plugins
    await this.scanNodeModules(path.join(packageDir, 'node_modules'), plugins, seen);

    // 3. Scan user's plugins directory
    if (fs.existsSync(pluginsDir)) {
      await this.scanNodeModules(pluginsDir, plugins, seen);
    }

    // 4. Scan npm global node_modules for @openclaw/* packages
    const npmRoot = await this.execCmd('npm root -g');
    if (npmRoot) {
      await this.scanNodeModules(npmRoot.trim(), plugins, seen);
    }

    return plugins;
  }

  private async pluginsFromCli(): Promise<OpenClawPlugin[]> {
    const binary = await this.findBinary();
    if (!binary) {
      return [];
    }

    return new Promise((resolve) => {
      cp.exec(`"${binary}" plugins list --json`, { timeout: 8000 }, (err, stdout) => {
        if (err || !stdout) {
          resolve([]);
          return;
        }
        try {
          const raw = JSON.parse(stdout);
          if (Array.isArray(raw)) {
            resolve(
              raw
                .filter((p: any) => p && p.id)
                .map((p: any) => ({
                  id: String(p.id),
                  version: String(p.version ?? '0.0.0'),
                  dir: String(p.dir ?? p.path ?? ''),
                })),
            );
          } else {
            resolve([]);
          }
        } catch {
          resolve([]);
        }
      });
    });
  }

  private async scanNodeModules(
    modsDir: string,
    out: OpenClawPlugin[],
    seen: Set<string>,
  ): Promise<void> {
    if (!fs.existsSync(modsDir)) {
      return;
    }
    try {
      // Top-level packages
      const entries = fs.readdirSync(modsDir);
      for (const entry of entries) {
        if (entry.startsWith('.')) {
          continue;
        }
        // Scoped packages like @openclaw/mattermost
        if (entry.startsWith('@')) {
          const scopeDir = path.join(modsDir, entry);
          if (fs.statSync(scopeDir).isDirectory()) {
            const scopeEntries = fs.readdirSync(scopeDir);
            for (const scoped of scopeEntries) {
              await this.tryLoadPlugin(path.join(scopeDir, scoped), `${entry}/${scoped}`, out, seen);
            }
          }
        } else {
          await this.tryLoadPlugin(path.join(modsDir, entry), entry, out, seen);
        }
      }
    } catch {
      // ignore read errors
    }
  }

  private async tryLoadPlugin(
    dir: string,
    name: string,
    out: OpenClawPlugin[],
    seen: Set<string>,
  ): Promise<void> {
    const pkgPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      return;
    }
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
        name?: string;
        version?: string;
        keywords?: string[];
        openclaw?: unknown;
      };
      // An openclaw plugin declares itself via keywords or an "openclaw" key in package.json
      const isPlugin =
        pkg.openclaw !== undefined ||
        (Array.isArray(pkg.keywords) && pkg.keywords.includes('openclaw-plugin'));
      if (!isPlugin) {
        return;
      }
      const id = pkg.name ?? name;
      if (seen.has(id)) {
        return;
      }
      seen.add(id);
      out.push({ id, version: pkg.version ?? '0.0.0', dir });
    } catch {
      // ignore
    }
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  private execCmd(cmd: string): Promise<string | null> {
    return new Promise((resolve) => {
      cp.exec(cmd, { timeout: 8000 }, (err, stdout) => {
        resolve(err ? null : stdout);
      });
    });
  }
}
