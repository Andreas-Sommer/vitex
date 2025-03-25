import fs from "node:fs";
import path, { basename, dirname, resolve } from "node:path";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import autoOrigin from "vite-plugin-auto-origin";
import typo3 from "vite-plugin-typo3";
import { viteStaticCopy } from "vite-plugin-static-copy";

/**
 * Vitex
 * --------------------
 * A configurable Vite configuration class optimized for modular frontend setups such as TYPO3 extensions.
 *
 * Features:
 * - Reads `ViteEntrypoints.json` from package Configuration folders
 * - Resolves wildcard-based SCSS/JS entrypoints
 * - Generates namespace-based entry names (e.g. `mysite_default`, `global_main`)
 * - Cleans up the Vite manifest after build:
 *   - Removes self-imports
 *   - Removes `name` for static assets (e.g. fonts/images)
 *   - Applies namespaced `name` values only to SCSS and JS
 * - Supports dynamic aliases, plugin extension, static copy targets, and Vite dev server options
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
    this.outputPath = options.outputPath || "public/assets/";
    this.packagesPath = options.packagesPath || "packages";
    this.currentDir = dirname(fileURLToPath(import.meta.url));
    this.aliases = options.aliases || [];
    this.extraPlugins = options.plugins || [];
    this.staticCopyTargets = options.staticCopyTargets || [];
    this.serverOptions = options.server || {};
    this.viteEntrypoints = this._generateEntrypoints();
  }

  /**
   * Search for all `ViteEntrypoints.json` files in `Configuration/` of all packages.
   * @returns {string[]} Array of file paths.
   */
  _findViteEntrypointsFiles() {
    return fs.readdirSync(this.packagesPath)
      .map(pkg => resolve(this.packagesPath, pkg, "Configuration", "ViteEntrypoints.json"))
      .filter(fs.existsSync); // Return only existing files
  }

  /**
   * Expands wildcard paths (`*.js`, `*.scss`) to real file paths.
   * @param {string} baseDir Base directory of the JSON file.
   * @param {string} relativePath The path to expand.
   * @returns {string[]} Array of resolved file paths.
   */
  _expandEntryPaths(baseDir, relativePath) {
    if (!relativePath.includes("*")) {
      return [resolve(baseDir, relativePath)];
    }
    // Extract directory and pattern
    const dirPart = dirname(relativePath);
    const globPart = basename(relativePath);
    const regex = new RegExp("^" + globPart.replace("*", ".*") + "$");
    const absoluteDir = resolve(baseDir, dirPart);

    const matchedFiles = fs.readdirSync(absoluteDir)
      .filter(file => regex.test(file))
      .map(file => resolve(absoluteDir, file));

    if (matchedFiles.length === 0) {
      console.warn(`⚠️ Warning: No files found for pattern ${relativePath}`);
    }

    return matchedFiles;
  }

  /**
   * Reads `ViteEntrypoints.json` and converts relative paths to absolute ones.
   * @returns {string[]} List of absolute paths.
   */
  _generateEntrypoints() {
    const viteEntrypointFiles = this._findViteEntrypointsFiles();

    return viteEntrypointFiles.flatMap(file => {
      const baseDir = dirname(file);
      const rawEntrypoints = fs.readFileSync(file, "utf-8");
      return JSON.parse(rawEntrypoints).flatMap(relativePath =>
        this._expandEntryPaths(baseDir, relativePath)
      );
    });
  }

  /**
   * Generates a unique entry name based on file path.
   * @param {string} entryPath The full file path.
   * @returns {string} Generated name.
   */
  _generateEntryName(entryPath) {
    if (!entryPath.endsWith(".scss") && !entryPath.endsWith(".js")) return entryPath;

    const fileName = basename(entryPath, path.extname(entryPath)); // "main"
    const parentFolder = basename(dirname(entryPath)); // "JavaScript" oder "mysite"

    const isGlobal = !this.validSitenames.includes(parentFolder);

    // Fix: Namen korrekt erzeugen, aber `file` nicht verändern
    return isGlobal ? `global_${fileName}` : `${parentFolder}_${fileName}`;
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
        const newEntry = { ...entry };

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
        src: path.resolve(process.cwd(), resolvedSrc), // <-- statt this.currentDir
        dest: target.dest
      };
    });
  }

  /**
   * Generates a Vite configuration object.
   * @returns {object} Vite configuration.
   */
  getViteConfig() {
    // After build, clean the manifest.json
    const postBuildManifestCleanupPlugin = {
      name: 'postbuild-manifest-cleanup',
      closeBundle: () => {
        this._saveCleanedManifest();
      }
    };

    const entryPoints = {};
    this.viteEntrypoints.forEach(entryPath => {
      // Nur den technischen Basisnamen nehmen → beeinflusst "file"
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
        rollupOptions: {
          input: entryPoints
        },
        outDir: resolve(this.outputPath),
      },
      css: { devSourcemap: true },
      server: {
        ...this.serverOptions
      },
      plugins: [
        typo3({ debug: true }),
        viteStaticCopy({
          targets: this._resolveStaticTargets()
        }),
        autoOrigin(),
        ...this.extraPlugins,
        postBuildManifestCleanupPlugin
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
