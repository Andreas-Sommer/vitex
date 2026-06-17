import fs from "node:fs";
import path, {basename, dirname, resolve} from "node:path";
import {defineConfig} from "vite";
import autoOrigin from "vite-plugin-auto-origin";
import {getDefaultAllowedOrigins, getDefaultIgnoreList} from "vite-plugin-typo3";
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
      commentsPolicy: options.optimize?.commentsPolicy ?? 'none',
      assetsInlineLimit: options.optimize?.assetsInlineLimit ?? 4096
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
    const ext = path.extname(entryPath).toLowerCase();
    if (ext !== ".scss" && ext !== ".js") return entryPath;

    const fileName = basename(entryPath, ext).toLowerCase();
    // Suffix basierend auf dem Typ (js oder css)
    const typeSuffix = ext === ".scss" ? "css" : "js";

    // 1) Prefer site hint from root-build detection
    const hintedSite = this._siteHints.get(entryPath);
    let sitePrefix = "global";

    if (hintedSite) {
      sitePrefix = hintedSite;
    } else {
      // 2) Fallback for package entries: case-insensitive folder match
      const parentFolder = basename(dirname(entryPath)).toLowerCase();
      const sitesLower = this.validSitenames.map((s) => s.toLowerCase());
      const matchIndex = sitesLower.findIndex((s) => s === parentFolder);
      if (matchIndex !== -1) {
        sitePrefix = this.validSitenames[matchIndex];
      }
    }

    return `${sitePrefix}_${fileName}_${typeSuffix}`;
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

        // 🔹 Use src or the key (which is often the relative source path in Vite)
        const effectivePath = newEntry.src || key;

        // 🔹 Remove self-referencing imports
        if (effectivePath && newEntry.imports) {
          const normalizedSrc = effectivePath.replace(/\\/g, "/").replace(/^\.\//, "");

          newEntry.imports = newEntry.imports.filter(importPath => {
            const normalizedImport = importPath.replace(/\\/g, "/").replace(/^\.\//, "");

            const isSame = normalizedImport === normalizedSrc;
            if (isSame) {
              console.log(`Sweep removed self-import: ${normalizedImport}`);
            }

            return !isSame;
          });
        }

        // 🔹 Correction for SCSS entries with JS wrappers
        if (newEntry.isEntry && effectivePath.endsWith('.scss')) {
          if (newEntry.file.endsWith('.js') && newEntry.css && newEntry.css.length > 0) {
            // We take the first CSS as the primary file
            const mainCss = newEntry.css[0];
            newEntry.file = mainCss;

            // Remove the first entry from the CSS array so it's not included twice
            newEntry.css = newEntry.css.slice(1);

            console.log(`✨ Replaced JS-wrapper with primary CSS for: ${effectivePath}`);
          }
        }

        // 🔹 Robust name assignment for entry points
        if (newEntry.isEntry && effectivePath) {
          const ext = path.extname(effectivePath).toLowerCase();
          // 🔹 Only for js and scss
          if (ext === ".js" || ext === ".scss") {
            // Normalize path to absolute to match against _siteHints (which contains absolute paths)
            const absolutePath = resolve(process.cwd(), effectivePath);
            newEntry.name = this._generateEntryName(absolutePath);
          }
        } else if (newEntry.src && !newEntry.isEntry) {
          // ❌ Remove name for assets
          delete newEntry.name;
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

  _resolveServerOptions() {
    const userWatch = this.serverOptions.watch || {};
    const userIgnored = userWatch.ignored
      ? (Array.isArray(userWatch.ignored) ? userWatch.ignored : [userWatch.ignored])
      : [];

    return {
      ...this.serverOptions,
      cors: this.serverOptions.cors ?? {
        origin: getDefaultAllowedOrigins()
      },
      watch: {
        ...userWatch,
        ignored: [
          ...getDefaultIgnoreList(),
          "**/.Build/**",
          "**/vendor/**",
          "**/node_modules/**",
          "**/.git/**",
          "**/public/assets/**",
          "**/public/_assets/**",
          ...userIgnored
        ]
      }
    };
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
      closeBundle: () => {
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
        assetsInlineLimit: this.optimize.assetsInlineLimit,
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
      publicDir: false,
      server: this._resolveServerOptions(),
      plugins: [
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
