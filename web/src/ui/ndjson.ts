/** Errors never include the line that failed to parse, because a line can hold letter text. */

export class NdjsonParseError extends Error {
  constructor() {
    super("A line in the stream is not valid JSON.");
    this.name = "NdjsonParseError";
  }
}

function parseLine(line: string): unknown | undefined {
  const trimmed = line.trim();
  if (trimmed === "") return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new NdjsonParseError();
  }
}

/** A chunk can end mid-line; the rest is kept until the next chunk or `end()`. */
export class NdjsonParser {
  private buffer = "";

  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const parts = this.buffer.split("\n");
    this.buffer = parts.pop() ?? "";
    const values: unknown[] = [];
    for (const part of parts) {
      const value = parseLine(part);
      if (value !== undefined) values.push(value);
    }
    return values;
  }

  /** The last line, when the stream doesn't end with a newline. */
  end(): unknown[] {
    const rest = this.buffer;
    this.buffer = "";
    const value = parseLine(rest);
    return value === undefined ? [] : [value];
  }
}

export async function* readNdjson(stream: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  const parser = new NdjsonParser();
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield* parser.push(decoder.decode(value, { stream: true }));
    }
    finished = true;
    yield* parser.push(decoder.decode());
    yield* parser.end();
  } finally {
    // The caller stopped early or a line failed to parse: stop the download too.
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
