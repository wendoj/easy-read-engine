/**
 * Pipeline types (design "Pipeline orchestrator" and "Data Models").
 */
import type { ActionSynonym, CheckResult, KeyFact, Line, Sentence, SymbolMatch } from "@/src/checker-client/schemas";
import type {
  JudgePair,
  JudgeResult,
  RegenerateInput,
  RegenerateResult,
  RewriteInput,
  RewriteResult,
} from "@/src/llm";

export type Rule = CheckResult["rule"];
export type Status = "passed" | "flagged" | "blocked";

/** Which provider and model answered one model call. */
export interface ModelUse {
  task: "rewrite" | "regenerate" | "judge";
  attempt: number;
  provider: string;
  model: string;
}

export type ConversionResult = {
  status: Status;
  original: { text: string; sentences: Sentence[] };
  keyFacts: KeyFact[];
  /** Empty when `status` is "blocked" (R2.5). */
  lines: Line[];
  /** Always all 10 rules, P1 to P10 in order (R6.1). */
  checks: CheckResult[];
  /** 1 to 3. */
  attempts: number;
  /** The R7.1 statement. */
  notice: string;
  /**
   * False when the judge gave no valid answer on the last try. P9 and P10 are
   * then failed with "judge unavailable" and flagged, never passed.
   */
  judgeAvailable: boolean;
  /** Provider and model for each model call that answered. */
  models: ModelUse[];
  /**
   * The verb swaps P1 accepted in required actions, listed in the rule report.
   * From the checker's `GET /config/action-synonyms`; `ACTION_SYNONYMS` in
   * checker/src/checks/config.py is the only copy.
   */
  actionSynonyms: ActionSynonym[];
};

export type PipelineStage = "analysing" | "rewriting" | "checking" | "regenerating";

/** Streamed by `/api/convert` (task 17). Holds no letter content. */
export interface ProgressEvent {
  type: "progress";
  stage: PipelineStage;
  attempt: number;
  maxAttempts: number;
}

/** The model calls the pipeline makes. `modelFromClient` wraps the real ones. */
export interface PipelineModel {
  rewrite(input: RewriteInput): Promise<RewriteResult>;
  regenerate(input: RegenerateInput): Promise<RegenerateResult>;
  judge(pairs: JudgePair[]): Promise<JudgeResult>;
}

/** The checker calls the pipeline makes. A `CheckerClient` fits. */
export interface PipelineChecker {
  analyse(original: string): Promise<{ sentences: Sentence[]; key_facts: KeyFact[] }>;
  check(request: { original: string; key_facts: KeyFact[]; lines: Line[] }): Promise<CheckResult[]>;
  /** `find_symbol`, best first. Used to pick a pictogram per line. */
  symbols(q: string, limit?: number): Promise<SymbolMatch[]>;
  /** P1's action synonym table, copied into the result for the rule report. */
  actionSynonyms(): Promise<ActionSynonym[]>;
}

/**
 * Log events. Rule results, counts, timings and provider and model only.
 * Never letter text, Easy Read lines, check details or key-fact values (R7.4).
 */
export type PipelineLogEvent =
  | {
      msg: "pipeline_attempt";
      attempt: number;
      results: { rule: Rule; passed: boolean; lines: number }[];
      judgeAvailable: boolean;
      regenerateLines: number;
      missingFacts: number;
      ms: number;
    }
  | {
      msg: "pipeline_done";
      status: Status;
      attempts: number;
      judgeAvailable: boolean;
      failedRules: Rule[];
      models: ModelUse[];
      ms: number;
    };

export type PipelineLogger = (event: PipelineLogEvent) => void;

export interface PipelineDeps {
  model: PipelineModel;
  checker: PipelineChecker;
  onProgress?: (event: ProgressEvent) => void;
  logger?: PipelineLogger;
  now?: () => number;
}
