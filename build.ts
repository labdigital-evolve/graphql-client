import { $ } from "bun";
import isolatedDeclarations from "bun-plugin-isolated-decl";

// Clean up dist first
await $`rm -rf dist`;

const output = await Bun.build({
  entrypoints: ["./src/server.ts", "./src/browser.ts"],
  outdir: "./dist",
  target: "node",
  sourcemap: "external",
  plugins: [isolatedDeclarations()],
});

if (output.success) {
  console.log("Build successful");
} else {
  console.error("Build failed");
}
