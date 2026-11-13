/** Injectable HTTP transport for chat completions, so tests never touch the network. */
export interface TransportRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal;
}

export interface TransportResponse {
  status: number;
  /** Lower-case names. */
  headers: Record<string, string>;
  json: unknown;
}

export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

export const fetchTransport: Transport = async ({ url, headers, body, signal }) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
  });
  const outHeaders: Record<string, string> = {};
  res.headers.forEach((value, name) => {
    outHeaders[name.toLowerCase()] = value;
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, headers: outHeaders, json };
};
