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
  }
});

export default vite.getViteConfig();
```
