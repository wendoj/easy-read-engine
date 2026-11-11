/**
 * The client address used as the rate-limit key, read from proxy headers.
 *
 * In production the only proxy is Traefik (managed by Dokploy, design
 * "Deployment"). Traefik appends the address of the peer it accepted the
 * connection from to `X-Forwarded-For`, so with 1 trusted proxy the last entry
 * is the client. Earlier entries are whatever the client sent and can be
 * forged, so they are ignored. `X-Real-Ip` (also set by Traefik) is the
 * fallback. With no usable header (local `next dev`), every request shares the
 * key "unknown".
 *
 * IPv6 clients usually hold a whole /64, so they are keyed by their /64.
 * Addresses are never logged in full: `maskClientKey` keeps a /24 or /48.
 */
import { isIP } from "node:net";

/** Proxies in front of the app that append to `X-Forwarded-For`. Traefik only. */
export const DEFAULT_TRUSTED_PROXY_HOPS = 1;

export const UNKNOWN_CLIENT = "unknown";

function stripAddress(raw: string): string {
  let s = raw.trim();
  // "[2001:db8::1]:443" or "[2001:db8::1]"
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracket) s = bracket[1];
  // "203.0.113.7:51234"
  const v4port = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(s);
  if (v4port) s = v4port[1];
  return s;
}

/** Eight 16-bit groups. Expects an address that `isIP` accepted as version 6. */
function ipv6Groups(ip: string): number[] {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const [a, b, c, d] = tail.split(".").map(Number);
    s = `${s.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = s.split("::");
  const headGroups = head ? head.split(":") : [];
  if (rest === undefined) return headGroups.map((g) => parseInt(g, 16));
  const restGroups = rest ? rest.split(":") : [];
  const zeros = new Array<string>(8 - headGroups.length - restGroups.length).fill("0");
  return [...headGroups, ...zeros, ...restGroups].map((g) => parseInt(g, 16));
}

/** The key for one address, or null if it isn't a valid IP address. */
export function keyForAddress(raw: string): string | null {
  const ip = stripAddress(raw);
  const version = isIP(ip);
  if (version === 4) return ip;
  if (version !== 6) return null;
  const g = ipv6Groups(ip);
  // IPv4-mapped (::ffff:a.b.c.d) is the IPv4 client.
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff].join(".");
  }
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
}

export function clientKey(headers: Headers, trustedProxyHops: number = DEFAULT_TRUSTED_PROXY_HOPS): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded && trustedProxyHops > 0) {
    const entries = forwarded
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    const index = Math.max(0, entries.length - trustedProxyHops);
    const key = entries[index] !== undefined ? keyForAddress(entries[index]) : null;
    if (key) return key;
  }
  const real = headers.get("x-real-ip");
  if (real) {
    const key = keyForAddress(real);
    if (key) return key;
  }
  return UNKNOWN_CLIENT;
}

/** A key safe to log: an IPv4 /24 ("203.0.113.x") or an IPv6 /48. */
export function maskClientKey(key: string): string {
  if (isIP(key) === 4) return `${key.split(".").slice(0, 3).join(".")}.x`;
  if (key.endsWith("::/64")) return `${key.split(":").slice(0, 3).join(":")}::/48`;
  return key === UNKNOWN_CLIENT ? key : "masked";
}
