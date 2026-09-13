// The real declarations live in packages/shared now — this file stays as a
// re-export so every existing `import ... from "./types.js"` in this package
// keeps working unchanged. `export type *` is fully erased at compile time
// (these are types only, no runtime values), so this has zero runtime cost.
export type * from "@content-engine/shared";
