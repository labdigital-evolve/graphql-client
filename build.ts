import isolatedDeclarations from "bun-plugin-isolated-decl";

await Bun.build({
  entrypoints: ["./src/server.ts", "./src/browser.ts"],
  outdir: "./dist",
  target: "node",
  sourcemap: "external",
  plugins: [isolatedDeclarations()],
});
