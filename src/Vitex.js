import fs from "node:fs";
import path, {basename, dirname, resolve} from "node:path";
import {defineConfig} from "vite";
import autoOrigin from "vite-plugin-auto-origin";
import typo3 from "vite-plugin-typo3";
import {viteStaticCopy} from "vite-plugin-static-copy";

/**
 * Vitex
 * --------------------
 * A configurable Vite configuration class optimized for modular frontend setups such as TYPO3 extensions.
 *
 * Features:
 *  - Collects Vite entrypoints from `ViteEntrypoints.json` files in TYPO3 extensions.
 *  - Optionally collects additional entrypoints from a configurable root build folder
 *    (e.g. "Build/Frontend"), independent of extensions.
 *    - Supports site-specific naming via `options.sitenames` (prefix `<site>_...`).
 *    - Files without a matching sitename in their path are prefixed with `global_...`.
 *    - By default only matches top-level files:
 *         Styles/*.scss, JavaScript/*.js
 *         Styles/<sitename>/*.scss, JavaScript/<sitename>/*.js
 *    - Ignores deeper subdirectories (no `**` recursion).
 *    - Optionally ignores files starting with `_` (e.g. SCSS partials) if
 *      `rootBuild.ignoreUnderscore` is set to `true`.
 *
 * The resulting entrypoints are merged and returned as a complete Vite configuration.
 *
 * Constructor Options:
 * @param {Object} options - Configuration object
 * @param {string[]} [options.sitenames=[]] - Valid site or namespace identifiers (used for entry name logic)
 * @param {string} [options.outputPath='public/assets/'] - Target output directory for the Vite build
 * @param {string} [options.packagesPath='packages'] - Base directory for extensions/packages
 * @param {Object[]} [options.aliases=[]] - Vite alias definitions, e.g. `{ find: '@foo', replacement: 'src/foo' }`
 * @param {Object[]} [options.staticCopyTargets=[]] - Targets for `vite-plugin-static-copy`, `{ src, dest }`
 * @param {Object[]} [options.plugins=[]] - Additional Vite plugins to include
 * @param {Object} [options.server={}] - Vite dev server options (e.g. `{ allowedHosts: [...] }`)
 *
 * Usage:
 * const generator = new ViteConfigGenerator({
 *   sitenames: ['mysite'],
 *   outputPath: 'public/assets/',
 *   aliases: [{ find: '@sitepackage', replacement: 'packages/sitepackage' }],
 *   staticCopyTargets: [{ src: 'node_modules/something/*', dest: 'vendor' }],
 *   server: { allowedHosts: ['vite.ddev.site'] }
 * });
 *
 * export default generator.getViteConfig();
 */
class Vitex {
  constructor(options = {}) {
    // Define constants
    this.validSitenames = options.sitenames || [];
    // --- Optimization flags (all optional) -------------------------------
    // optimize.bundleBootstrap: bundle all Bootstrap modules into a single chunk (default: true)
    // optimize.stripJsComments: remove JS comments in the output (default: true)
    // optimize.commentsPolicy:  'none' | 'eof' | 'inline'  (only relevant if esbuild minification is used)
    //                           default: 'none'  -> also removes license banners like /*! ... */
    this.optimize = {
      bundleBootstrap: options.optimize?.bundleBootstrap ?? true,
      stripJsComments: options.optimize?.stripJsComments ?? true,
      commentsPolicy: options.optimize?.commentsPolicy ?? 'none'
    };
    this.outputPath = options.outputPath || "public/assets/";
    this.packagesPath = options.packagesPath || "packages";
    this.aliases = options.aliases || [];
    this.extraPlugins = options.plugins || [];
    this.staticCopyTargets = options.staticCopyTargets || [];
    // ── Root-Build: flexible folder structure inside a base path ──────────────
    // Minimal-invasive with reasonable defaults. Only top-level files (no deep subfolders).
    const rb = options.rootBuild || {};
    this.rootBuildEnabled = rb.enabled ?? true;
    this.rootBuildPath = rb.path ?? "Build/Frontend";
    // Defaults: only top-level files in Styles/ and JavaScript/
    // plus one additional level for site-specific folders
    // (Styles/<sitename>/*.scss, JavaScript/<sitename>/*.js)
    this.rootBuildPatterns = Array.isArray(rb.patterns) && rb.patterns.length > 0 ? rb.patterns
      : ["Styles/*.scss", "JavaScript/*.js", "Styles/*/*.scss", "JavaScript/*/*.js"];
    // Optional: ignore files starting with "_" (e.g. SCSS partials)
    this.rootBuildIgnoreUnderscore = rb.ignoreUnderscore === true;
    // Map absolute file path → site name (used for naming <site>_*)
    this._siteHints = new Map();
    this.serverOptions = options.server || {};
    this.viteEntrypoints = this._generateEntrypoints();
  }

  /**
   * Search for all `ViteEntrypoints.json` files in `Configuration/` of all packages.
   * Returns an empty array if the packagesPath does not exist or cannot be read.
   * @returns {string[]} Array of file paths.
   */
  _findViteEntrypointsFiles() {
    // Ensure the base path exists
    if (!fs.existsSync(this.packagesPath)) {
      console.warn(`ℹ️ packagesPath not found: ${this.packagesPath}`);
      return [];
    }

    let entries;
    try {
      entries = fs.readdirSync(this.packagesPath);
    } catch (e) {
      console.warn(`ℹ️ Unable to read packagesPath: ${this.packagesPath}`, e);
      return [];
    }

    return entries
      .map(pkg => resolve(this.packagesPath, pkg, "Configuration", "ViteEntrypoints.json"))
      .filter(fs.existsSync);
  }

  /**
   * Expands wildcard paths (`*.js`, `*.scss`) to real file paths.
   * @param {string} baseDir Base directory of the JSON file.
   * @param {string} relativePath The path to expand.
   * @returns {string[]} Array of resolved file paths.
   */
  _expandEntryPaths(baseDir, relativePath) {
    // Only support simple one-level globs:
    // - "Dir/*.ext"   (files directly in Dir)
    // - "Dir/*/*.ext" (files one level below Dir)
    // No support for "**" recursion.

    // No wildcard at all → return the resolved path
    if (!relativePath.includes("*")) {
      return [resolve(baseDir, relativePath)];
    }

    const dirPart = dirname(relativePath);     // e.g. "Styles" or "Styles/*"
    const globPart = basename(relativePath);   // e.g. "*.scss"

    const fileRegex = new RegExp("^" + globPart
      .replace(/\./g, "\\.")
      .replace(/\*/g, ".*") + "$");

    // Case A: simple "Dir/*.ext"
    if (!dirPart.includes("*")) {
      const absoluteDir = resolve(baseDir, dirPart);
      if (!fs.existsSync(absoluteDir)) {
        console.warn(`⚠️ Warning: Directory not found for pattern ${relativePath}`);
        return [];
      }
      let matched = fs.readdirSync(absoluteDir, { withFileTypes: true })
        .filter(e => e.isFile() && fileRegex.test(e.name))
        .map(e => resolve(absoluteDir, e.name));
      if (this.rootBuildIgnoreUnderscore) {
        matched = matched.filter(p => !basename(p).startsWith("_"));
      }
      if (matched.length === 0) {
        console.warn(`⚠️ Warning: No files found for pattern ${relativePath}`);
      }
      return matched;
    }

    // Case B: one-level wildcard in directory, e.g. "Styles/*/*.scss"
    // Only support a single "/*" at the end of dirPart
    const starIdx = dirPart.indexOf("/*");
    const parentDir = resolve(baseDir, dirPart.slice(0, starIdx)); // "Styles"
    if (!fs.existsSync(parentDir)) {
      console.warn(`⚠️ Warning: Directory not found for pattern ${relativePath}`);
      return [];
    }

    // Iterate immediate subdirectories
    const subdirs = fs.readdirSync(parentDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => resolve(parentDir, e.name));

    let files = [];
    for (const sub of subdirs) {
      let matched = fs.readdirSync(sub, { withFileTypes: true })
        .filter(e => e.isFile() && fileRegex.test(e.name))
        .map(e => resolve(sub, e.name));
      if (this.rootBuildIgnoreUnderscore) {
        matched = matched.filter(p => !basename(p).startsWith("_"));
      }
      files.push(...matched);
    }

    if (files.length === 0) {
      // Directory exists, but no matches across all subdirs
      console.warn(`⚠️ Warning: No files found for pattern ${relativePath}`);
    }

    return files;
  }

  /**
   * Root-Build entrypoints: expands patterns inside this.rootBuildPath.
   * Automatically detects the site if any path segment matches one of options.sitenames.
   * Later combined with package entrypoints (ViteEntrypoints.json).
   */
  _generateRootEntrypoints() {
    if (!this.rootBuildEnabled) return [];
    const baseDir = resolve(process.cwd(), this.rootBuildPath);
    if (!fs.existsSync(baseDir)) return [];
    const files = [];
    for (const pat of this.rootBuildPatterns) {
      const found = this._expandEntryPaths(baseDir, pat);
      for (const f of found) {
        files.push(f);
        // Site detection: check if any path segment matches a sitename
        const parts = f.split(path.sep);
        const partsLower = parts.map((p) => p.toLowerCase());
        const sitesLower = this.validSitenames.map((s) => s.toLowerCase());
        const matchIndex = sitesLower.findIndex((s) => partsLower.includes(s));
        const site = matchIndex !== -1 ? this.validSitenames[matchIndex] : undefined;
        if (site) this._siteHints.set(f, site);
      }
    }
    return files;
  }


  _generatePackageEntrypoints() {
    const viteEntrypointFiles = this._findViteEntrypointsFiles();
    return viteEntrypointFiles.flatMap(file => {
      const baseDir = dirname(file);
      const rawEntrypoints = fs.readFileSync(file, "utf-8");
      return JSON.parse(rawEntrypoints).flatMap(relativePath =>
        this._expandEntryPaths(baseDir, relativePath)
      );
    });
  }

  // Combines root-build and package entrypoints (original behavior preserved)
  _generateEntrypoints() {
    const fromRoot = this._generateRootEntrypoints();
    const fromPackages = this._generatePackageEntrypoints();
    return [...fromRoot, ...fromPackages];
  }

  /**
   * Generates a unique entry name based on file path.
   * @param {string} entryPath The full file path.
   * @returns {string} Generated name.
   */
  _generateEntryName(entryPath) {
    if (!entryPath.endsWith(".scss") && !entryPath.endsWith(".js")) return entryPath;

    const fileName = basename(entryPath, path.extname(entryPath)).toLowerCase();

    // 1) Prefer site hint from root-build detection
    const hintedSite = this._siteHints.get(entryPath);
    if (hintedSite) return `${hintedSite}_${fileName}`;

    // 2) Fallback for package entries: case-insensitive folder match
    const parentFolder = basename(dirname(entryPath));
    const parentLower = parentFolder.toLowerCase();
    const sitesLower = this.validSitenames.map((s) => s.toLowerCase());
    const matchIndex = sitesLower.findIndex((s) => s === parentLower);
    const isGlobal = matchIndex === -1;

    return isGlobal ? `global_${fileName}` : `${this.validSitenames[matchIndex]}_${fileName}`;
  }

  /**
   * Post-processes the Vite manifest.json:
   * - Removes self-referencing imports
   * - Corrects the "name" field according to namespace rules
   * - Leaves "file" untouched
   */
  _cleanManifest(manifest) {
    return Object.fromEntries(
      Object.entries(manifest).map(([key, entry]) => {
        const newEntry = {...entry};

        // 🔹 Remove self-referencing imports
        if (newEntry.src && newEntry.imports) {
          const normalizedSrc = newEntry.src.replace(/\\/g, "/").replace(/^\.\//, "");

          newEntry.imports = newEntry.imports.filter(importPath => {
            const normalizedImport = importPath.replace(/\\/g, "/").replace(/^\.\//, "");

            const isSame = normalizedImport === normalizedSrc;
            if (isSame) {
              console.log(`🧹 Removed self-import: ${normalizedImport}`);
            }

            return !isSame;
          });
        }

        // 🔹 Only update name if src exists
        if (newEntry.src) {
          const ext = path.extname(newEntry.src);
          // 🔹 Only for js and scss
          if (ext === ".js" || ext === ".scss") {
            newEntry.name = this._generateEntryName(newEntry.src);
          } else {
            // ❌ Entferne name für Assets
            delete newEntry.name;
          }
        }

        return [key, newEntry];
      })
    );
  }

  _saveCleanedManifest() {
    const manifestPath = path.resolve(this.outputPath, ".vite/manifest.json");

    if (!fs.existsSync(manifestPath)) {
      console.warn("⚠️ Manifest not found. Skipping cleanup.");
      return;
    }

    const raw = fs.readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(raw);
    const cleaned = this._cleanManifest(manifest);

    fs.writeFileSync(manifestPath, JSON.stringify(cleaned, null, 2));
    console.log("✅ Cleaned manifest.json written.");
  }

  _resolveStaticTargets() {
    return this.staticCopyTargets.map(target => {
      let resolvedSrc = target.src;

      this.aliases.forEach(alias => {
        if (resolvedSrc.startsWith(alias.find)) {
          resolvedSrc = resolvedSrc.replace(alias.find, alias.replacement);
        }
      });

      return {
        src: path.resolve(process.cwd(), resolvedSrc), // <-- instead of this.currentDir
        dest: target.dest
      };
    });
  }

  /**
   * Generates a Vite configuration object.
   * @returns {object} Vite configuration.
   */
  getViteConfig() {
    // Optional tiny plugin: re-escape PUA glyphs in final CSS assets (belt & suspenders)
    const escapeUnicodeInCssPlugin = {
      name: 'escape-unicode-in-css',
      enforce: 'post',
      generateBundle(_options, bundle) {
        for (const [fileName, chunk] of Object.entries(bundle)) {
          if (chunk.type === 'asset' && fileName.endsWith('.css')) {
            const src = String(chunk.source);
            chunk.source = src.replace(/[\uE000-\uF8FF]/g, ch => '\\' + ch.codePointAt(0).toString(16));
          }
        }
      }
    };

    // After build, clean the manifest.json
    const postBuildManifestCleanupPlugin = {
      name: 'postbuild-manifest-cleanup',
      generateBundle: (outputOptions, bundle) => {
        this._saveCleanedManifest();
      }
    };

    const entryPoints = {};
    this.viteEntrypoints.forEach(entryPath => {
      // Use only the technical base name → affects "file"
      const entryName = this._generateEntryName(entryPath);

      if (!entryPoints[entryName]) {
        entryPoints[entryName] = resolve(entryPath);
      } else {
        console.warn(`⚠️ Duplicate entry name detected: ${entryName}. Renaming...`);
        entryPoints[`${entryName}_${Object.keys(entryPoints).length}`] = resolve(entryPath);
      }
    });

    return defineConfig({
      base: "",
      build: {
        manifest: true,
        cssCodeSplit: true,
        outDir: resolve(this.outputPath),

        // Minify with Terser: also removes all /*! Bootstrap … */ banners
        minify: 'terser',
        terserOptions: {
          compress: true,
          mangle: true,
          format: {
            comments: false // strip all comments completely
          }
        },

        rollupOptions: {
          input: entryPoints,
          output: {
            // Combine Bootstrap + Popper -> ONE chunk
            manualChunks(id) {
              if (id.includes('node_modules/bootstrap')) return 'bootstrap'
              if (id.includes('@popperjs/core')) return 'bootstrap'
            },
            chunkFileNames: 'assets/[name]-[hash].js',
            entryFileNames: 'assets/[name]-[hash].js',
            assetFileNames: 'assets/[name]-[hash][extname]'
          }
        },

        // CSS-Minify over esbuild (LightningCSS disabled)
        cssMinify: 'esbuild'
      },
      css: {
        devSourcemap: true,
        // make sure your postcss.config.cjs is used (even when called via class)
        postcss: './postcss.config.cjs',
      },
      server: {
        ...this.serverOptions
      },
      plugins: [
        typo3({debug: true}),
        viteStaticCopy({
          targets: this._resolveStaticTargets()
        }),
        autoOrigin(),
        ...this.extraPlugins,
        postBuildManifestCleanupPlugin,
        escapeUnicodeInCssPlugin // <- add last
      ],
      resolve: {
        alias: this.aliases.map(alias => ({
          find: alias.find,
          replacement: path.resolve(alias.replacement)
        }))
      }
    });
  }
}

export default Vitex;
