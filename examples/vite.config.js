import Vitex from "@belsignum/vitex";

const options = {
  sitenames: ["mysite", "other-site"], // sitenames
  aliases: [
    { find: "@sitepackage", replacement: "packages/sitepackage" }
  ],
  server: {
    allowedHosts: ["vite.ddev.site"]
  },
  staticCopyTargets: [
    { src: "packages/sitepackage/Resources/Private/Frontend/Assets/Media/*", dest: "media" },
    { src: "node_modules/bootstrap-icons/*", dest: "bootstrap-icons" },
    { src: "node_modules/bootstrap/dist/js/bootstrap.bundle.min.js*", dest: "bootstrap" }
  ]
}
const vitex = new Vitex(options);

// Export the generated Vite configuration
export default vitex.getViteConfig();
