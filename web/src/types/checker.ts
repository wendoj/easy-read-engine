/**
 * GENERATED FILE. DO NOT EDIT BY HAND.
 *
 * Types for the checker service, generated from checker/openapi.json
 * (the FastAPI schema in checker/src/http_app.py) with openapi-typescript.
 * To update: change the Pydantic models, then run `npm run gen:checker-types` in web/.
 */

export interface paths {
    "/analyse": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Analyse
         * @description Sentences of the Original, with spans, and its key facts.
         */
        post: operations["analyse_analyse_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/key-facts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Key Facts
         * @description Key facts in `text`, with spans and normalised values.
         */
        post: operations["key_facts_key_facts_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Check
         * @description P1 to P8 for the lines, in rule order, one result per rule.
         */
        post: operations["check_check_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/symbols": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Symbols
         * @description Pictograms for `q`, best first.
         */
        get: operations["symbols_symbols_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/config/action-synonyms": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Action Synonyms
         * @description The verb swaps P1 accepts in required actions, for the rule report.
         *
         *     `checks/config.py` is the only copy; the web app shows this list as is.
         */
        get: operations["action_synonyms_config_action_synonyms_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Health
         * @description Ready when the spaCy model and the symbol index are loaded.
         */
        get: operations["health_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /**
         * ActionSynonym
         * @description One entry of the P1 action synonym table: a verb that P1 treats as `counts_as`.
         */
        ActionSynonym: {
            /** Word */
            word: string;
            /** Counts As */
            counts_as: string;
        };
        /** AnalyseRequest */
        AnalyseRequest: {
            /** Original */
            original: string;
        };
        /**
         * Analysis
         * @description What `analyse` returns: the Original's sentences and its key facts.
         */
        Analysis: {
            /** Sentences */
            sentences: components["schemas"]["Sentence"][];
            /** Key Facts */
            key_facts: components["schemas"]["KeyFact"][];
        };
        /**
         * CheckRequest
         * @description `key_facts` must come from the Original (`/analyse` or `/key-facts`),
         *     never from the output, so P1 compares the output with the Original (R2.4).
         */
        CheckRequest: {
            /** Original */
            original: string;
            /** Key Facts */
            key_facts: components["schemas"]["KeyFact"][];
            /** Lines */
            lines: components["schemas"]["Line"][];
        };
        /** CheckResult */
        CheckResult: {
            /**
             * Rule
             * @enum {string}
             */
            rule: "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7" | "P8" | "P9" | "P10";
            /** Passed */
            passed: boolean;
            /** Line Ids */
            line_ids: string[];
            /** Failed Fact Ids */
            failed_fact_ids: string[];
            /** Details */
            details: string[];
        };
        /** ErrorResponse */
        ErrorResponse: {
            /** Detail */
            detail: string;
        };
        /** Health */
        Health: {
            /**
             * Status
             * @enum {string}
             */
            status: "ok" | "starting";
            /** Spacy Loaded */
            spacy_loaded: boolean;
            /** Spacy Model */
            spacy_model: string;
            /** Symbol Index Loaded */
            symbol_index_loaded: boolean;
        };
        /** KeyFact */
        KeyFact: {
            /** Id */
            id: string;
            /**
             * Type
             * @enum {string}
             */
            type: "date" | "time" | "money" | "reference" | "phone" | "address" | "action";
            /** Value */
            value: string;
            /** Normalised */
            normalised: string;
            /** Start */
            start: number;
            /** End */
            end: number;
            /** Sentence Id */
            sentence_id: string;
        };
        /** KeyFactsRequest */
        KeyFactsRequest: {
            /** Text */
            text: string;
        };
        /** Line */
        Line: {
            /** Id */
            id: string;
            /** Text */
            text: string;
            /** Source Sentence Id */
            source_sentence_id: string;
            /** Symbol Id */
            symbol_id: string | null;
        };
        /** Sentence */
        Sentence: {
            /** Id */
            id: string;
            /** Text */
            text: string;
            /** Start */
            start: number;
            /** End */
            end: number;
        };
        /**
         * SymbolMatch
         * @description One `find_symbol` result: a pictogram ID from the symbol index and its rank score.
         */
        SymbolMatch: {
            /** Id */
            id: string;
            /** Score */
            score: number;
        };
        /** ValidationErrorResponse */
        ValidationErrorResponse: {
            /** Detail */
            detail: components["schemas"]["ValidationIssue"][];
        };
        /**
         * ValidationIssue
         * @description One invalid field: where it is and what kind of error it is. Never the
         *     submitted value or a message that could quote it.
         */
        ValidationIssue: {
            /** Loc */
            loc: (string | number)[];
            /** Type */
            type: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    analyse_analyse_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AnalyseRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Analysis"];
                };
            };
            /** @description Request body too large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Invalid request */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationErrorResponse"];
                };
            };
        };
    };
    key_facts_key_facts_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["KeyFactsRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KeyFact"][];
                };
            };
            /** @description Request body too large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Invalid request */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationErrorResponse"];
                };
            };
        };
    };
    check_check_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CheckRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CheckResult"][];
                };
            };
            /** @description Request body too large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Invalid request */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationErrorResponse"];
                };
            };
        };
    };
    symbols_symbols_get: {
        parameters: {
            query: {
                q: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SymbolMatch"][];
                };
            };
            /** @description Request body too large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Invalid request */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationErrorResponse"];
                };
            };
        };
    };
    action_synonyms_config_action_synonyms_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActionSynonym"][];
                };
            };
        };
    };
    health_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
        };
    };
}
