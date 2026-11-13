import path from "node:path";
import { fileURLToPath } from "node:url";
import { type CheckerClient, CheckerUnavailable } from "../src/checker-client";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const LETTERS_DIR = path.join(ROOT, "fixtures/letters");
export const CHECKER_START = "cd checker && uv run uvicorn http_app:app --app-dir src";

/** spaCy takes a few seconds to load. */
const CHECKER_START_WAIT_MS = 30_000;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A problem with the setup, not a letter. Its message is safe to print. */
export class SetupError extends Error {}

export async function waitForChecker(checker: CheckerClient): Promise<void> {
  const deadline = Date.now() + CHECKER_START_WAIT_MS;
  for (;;) {
    try {
      if ((await checker.health()).status === "ok") return;
    } catch (err) {
      if (err instanceof CheckerUnavailable) {
        throw new SetupError(`The checker service is not reachable at ${process.env.CHECKER_URL}. Start it with:\n  ${CHECKER_START}`);
      }
      throw err;
    }
    if (Date.now() > deadline) throw new SetupError("The checker service is still starting. Try again in a moment.");
    await sleep(1000);
  }
}
