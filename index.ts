// Pi extension entry point.
//
// This file is the single extension entry that the Pi package loader
// imports. It re-exports the default export from the layered source
// tree (`pi-extension/src/index.ts`), keeping the source layout unchanged
// while giving the package a clean top-level entry for `pi install`
// to discover via the `pi.extensions` manifest.

export { default } from "./pi-extension/src/index.js";
