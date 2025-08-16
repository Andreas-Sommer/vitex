# 🛠️ Vitex

<p align="center">
  <a href="https://www.npmjs.com/package/@belsignum/vitex">
    <img alt="npm" src="https://img.shields.io/npm/v/@belsignum/vitex?style=flat-square">
  </a>
  <a href="https://opensource.org/licenses/MIT">
    <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square">
  </a>
  <img alt="Made with Love" src="https://img.shields.io/badge/Made%20with-%E2%9D%A4-red?style=flat-square">
  <img alt="Status: Developer Friendly" src="https://img.shields.io/badge/status-developer--friendly-blue?style=flat-square">
</p>

A modular and reusable Vite configuration helper tailored for TYPO3 frontend development.

Vitex is designed to simplify the build setup for TYPO3-based projects using Vite. It provides automatic entrypoint resolution, namespaced output for sites handling, and post-build manifest cleanup. It supports multi-site structures, structured SCSS/JS asset handling, and a clean developer experience.

## 🚀 Features

- Automatic entrypoint resolution via `ViteEntrypoints.json`
- Namespace-aware output naming for sites (e.g. `mysite_default`, `global_main`)
- Manifest cleanup (removes self-imports, normalizes asset names)
- Configurable aliases, copy targets, plugins, server settings
- No build step required – raw JS usable directly in dev setup
- Fully compatible with Vite + TYPO3 + SCSS/JS workflows

**New in v1.1.0**
- Optional **Root Build support**: discover entry points in a project-level `Build/Frontend` folder
    - Default patterns (configurable):
        - `Styles/*.scss`, `JavaScript/*.js` (top-level only)
        - `Styles/*/*.scss`, `JavaScript/*/*.js` (one sitename folder level)
- Sitename-aware output for Root Build (`<sitename>_File.css`; fallback `global_*`)
- PostCSS auto-pickup and CSS minification via `esbuild` (keeps icon-font PUA glyphs intact)
- Improved alias resolution and `staticCopyTargets` handling
- Post-build manifest normalization retained

## 📦 Installation

If used locally:

```bash
npm install file:./packages/vitex
```
Or as an installed package:

```bash
npm install @belsignum/vitex
```

## 🧩 Usage
```JavaScript
// vite.config.js
import Vitex from 'vitex';

const vite = new Vitex({
    sitenames: ['mysite', 'other-site'],
    outputPath: 'public/assets/',
    packagesPath: 'packages/sitepackage',
    aliases: [
        { find: '@sitepackage', replacement: 'packages/sitepackage' }
    ],
    staticCopyTargets: [
        { src: 'node_modules/bootstrap-icons/*', dest: 'bootstrap-icons' }
    ],
    server: {
        allowedHosts: ['vite.ddev.site']
    },

    // New in v1.1.0:
    rootBuild: {
        enabled: true,               // enable discovery in Build/Frontend
        path: 'Build/Frontend',
        patterns: [
            'Styles/*.scss',
            'JavaScript/*.js',
            'Styles/*/*.scss',
            'JavaScript/*/*.js'
        ],
        // treat underscore-prefixed files as partials/components
        ignoreUnderscore: true
    }
});

export default vite.getViteConfig();
```

## Scripts

Add npm scripts to your `package.json`:

```json
"scripts": {
"dev": "vite --host 0.0.0.0",
"build": "vite build",
"watch": "vite build --watch",
"preview": "vite preview"
}
```

## ⚙️ Configuration Options

Vitex accepts the following options when creating a new instance:

| Option              | Type       | Default              | Description |
|---------------------|------------|----------------------|-------------|
| **sitenames**       | `string[]` | `[]`                 | List of TYPO3 site identifiers used for namespacing output files. |
| **outputPath**      | `string`   | `public/assets/`     | Path where compiled assets will be written. |
| **packagesPath**    | `string`   | `packages/sitepackage` | Path to your sitepackage or TYPO3 package containing frontend sources. |
| **aliases**         | `array`    | `[]`                 | Custom alias definitions passed directly to Vite (`{ find, replacement }`). |
| **staticCopyTargets** | `array`  | `[]`                 | Copy patterns for static assets (uses [vite-plugin-static-copy](https://github.com/sapphi-red/vite-plugin-static-copy)). |
| **server**          | `object`   | `{}`                 | Extra Vite dev server configuration, e.g. `allowedHosts`. |
| **rootBuild**       | `object`   | `{ enabled: false }` | Enables discovery of entrypoints from a global `Build/Frontend` folder. |
| └─ `enabled`        | `boolean`  | `false`              | Whether root-level build discovery is active. |
| └─ `path`           | `string`   | `"Build/Frontend"`   | Folder scanned for global entrypoints. |
| └─ `patterns`       | `string[]` | see below            | Glob patterns used to discover SCSS/JS entrypoints.<br>Default: `['Styles/*.scss','JavaScript/*.js','Styles/*/*.scss','JavaScript/*/*.js']`. |
| └─ `ignoreUnderscore` | `boolean` | `true`              | Treat underscore-prefixed files (`_partial.scss`) as partials and ignore them. |

## Changelog

### v1.1.0
- Added support for **Root Build** (e.g. project-level `Build/Frontend`)
- Improved configuration and documentation
- PostCSS auto-pickup and CSS minification via `esbuild` (keeps icon-font PUA glyphs intact)

### v1.0.3
- Initial public release

---

## License

[MIT License](https://opensource.org/licenses/MIT)
