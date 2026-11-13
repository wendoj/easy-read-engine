/**
 * Prompt files in `prompts/` have a `## System` and a `## User` section.
 * HTML comments are maintainer notes and are removed before sending.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type PromptName = "rewrite" | "regenerate" | "judge" | "vision";

export interface PromptTemplate {
  system: string;
  user: string;
}

export class PromptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptError";
  }
}

/** `prompts/` sits at the repo root. The web app runs from `web/`, scripts may run from the root. */
export function defaultPromptsDir(cwd: string = process.cwd()): string {
  const candidates = [path.resolve(cwd, "../prompts"), path.resolve(cwd, "prompts")];
  return candidates.find((dir) => existsSync(path.join(dir, "rewrite.md"))) ?? candidates[0];
}

export function parsePrompt(raw: string, name = "prompt"): PromptTemplate {
  const text = raw.replace(/<!--[\s\S]*?-->/g, "");
  const sys = text.search(/^## System\s*$/m);
  const usr = text.search(/^## User\s*$/m);
  if (sys < 0 || usr < 0 || usr < sys) {
    throw new PromptError(`${name} needs a "## System" section followed by a "## User" section`);
  }
  return {
    system: text.slice(sys + "## System".length, usr).trim(),
    user: text.slice(usr + "## User".length).trim(),
  };
}

export async function loadPrompt(name: PromptName, dir: string = defaultPromptsDir()): Promise<PromptTemplate> {
  const raw = await readFile(path.join(dir, `${name}.md`), "utf8");
  return parsePrompt(raw, `prompts/${name}.md`);
}

/**
 * Throws if the template uses a name that has no value, or a value is given
 * that the template never uses. A replacer function is used so `$` in letter
 * text is never treated as a pattern.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  const used = new Set<string>();
  const out = template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) {
      throw new PromptError(`No value for placeholder {{${key}}}`);
    }
    used.add(key);
    return vars[key];
  });
  const unused = Object.keys(vars).filter((k) => !used.has(k));
  if (unused.length > 0) throw new PromptError(`Template has no placeholder for: ${unused.join(", ")}`);
  return out;
}

/** The system section as is, and the user section with `vars` filled in. */
export function renderPrompt(prompt: PromptTemplate, vars: Record<string, string>): PromptTemplate {
  return { system: prompt.system, user: renderTemplate(prompt.user, vars) };
}

/** Collapses runs of whitespace, including newlines. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
