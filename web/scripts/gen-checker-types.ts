/**
 * Generate src/types/checker.ts from the checker service's OpenAPI schema.
 *
 * Run with `npm run gen:checker-types`. It exports the schema with
 * checker/scripts/export_openapi.py (needs uv), then converts it with
 * openapi-typescript and adds a do-not-edit header.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkerDir = path.resolve(webDir, "../checker");
const schemaPath = path.join(checkerDir, "openapi.json");
const outPath = path.join(webDir, "src/types/checker.ts");

const HEADER = `/**
 * GENERATED FILE. DO NOT EDIT BY HAND.
 *
 * Types for the checker service, generated from checker/openapi.json
 * (the FastAPI schema in checker/src/http_app.py) with openapi-typescript.
 * To update: change the Pydantic models, then run \`npm run gen:checker-types\` in web/.
 */

`;

async function main(): Promise<void> {
  execFileSync("uv", ["run", "python", "scripts/export_openapi.py", schemaPath], {
    cwd: checkerDir,
    stdio: "inherit",
  });
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const ast = await openapiTS(schema);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, HEADER + astToString(ast));
  console.log(`wrote ${path.relative(webDir, outPath)}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
