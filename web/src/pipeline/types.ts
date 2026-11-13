import type {
  ActionSynonym,
  CheckResult,
  KeyFact,
  Line,
  LineFactSpan,
  Sentence,
  SymbolMatch,
} from "@/src/checker-client/schemas";
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
  /** Empty when `status` is "blocked". */
  lines: Line[];
  /** Always all 10 rules, P1 to P10 in order. */
  checks: CheckResult[];
  /** 1 to 3. */
  attempts: number;
  notice: string;
  /** When false, P9 and P10 are failed with "judge unavailable" and flagged, never passed. */
  judgeAvailable: boolean;
  models: ModelUse[];
  /** From the checker. `ACTION_SYNONYMS` in checker/src/checks/config.py is the only copy. */
  actionSynonyms: ActionSynonym[];
  /**
   * From the checker, which matches by P1's normalised values, so the web app
   * never normalises values itself. Empty when blocked.
   */
  lineFacts: LineFactSpan[];
};

export type PipelineStage = "analysing" | "rewriting" | "checking" | "regenerating";

/** Holds no letter content. */
export interface ProgressEvent {
  type: "progress";
  stage: PipelineStage;
  attempt: number;
  maxAttempts: number;
}

/** `modelFromClient` wraps the real calls. */
export interface PipelineModel {
  rewrite(input: RewriteInput): Promise<RewriteResult>;
  regenerate(input: RegenerateInput): Promise<RegenerateResult>;
  judge(pairs: JudgePair[]): Promise<JudgeResult>;
}

/** A `CheckerClient` fits. */
export interface PipelineChecker {
  analyse(original: string): Promise<{ sentences: Sentence[]; key_facts: KeyFact[] }>;
  check(request: { original: string; key_facts: KeyFact[]; lines: Line[] }): Promise<CheckResult[]>;
  /** Called once, only when lines are returned. */
  lineFacts(request: { key_facts: KeyFact[]; lines: Line[] }): Promise<LineFactSpan[]>;
  /** Best first. */
  symbols(q: string, limit?: number): Promise<SymbolMatch[]>;
  actionSynonyms(): Promise<ActionSynonym[]>;
}

/** Never letter text, Easy Read lines, check details or key-fact values. */
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
    }
  | {
      msg: "pipeline_regenerate_failed";
      attempt: number;
      /** The error class name only, never its message. */
      error: string;
    }
  | {
      msg: "pipeline_line_facts_failed";
      attempt: number;
      /** The error class name only. */
      error: string;
    }
  | {
      /** The last try (`of`) failed P1, so the latest try that passed P1 (`attempt`) is the result. */
      msg: "pipeline_kept_earlier_try";
      attempt: number;
      of: number;
    };

export type PipelineLogger = (event: PipelineLogEvent) => void;

export interface PipelineDeps {
  model: PipelineModel;
  checker: PipelineChecker;
  onProgress?: (event: ProgressEvent) => void;
  logger?: PipelineLogger;
  now?: () => number;
}
