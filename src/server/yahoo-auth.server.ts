// Yahoo Finance session helper — tracks cookies through the consent redirect
// chain and obtains a crumb so we can call the protected quoteSummary endpoint.
//
// The flow:
//  1. Hit https://fc.yahoo.com to get the initial A1/A3 cookies (no consent wall).
//  2. Use those cookies to fetch /v1/test/getcrumb which returns a short token.
//  3. Cache (cookie, crumb) for an hour. Reset on 401/403.

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const TTL_MS = 60 * 60 * 1000;

let cached: { cookie: string; crumb: string; at: number } | null = null;
let inflight: Promise<{ cookie: string; crumb: string } | null> | null = null;

function readSetCookies(headers: Headers): string[] {
  const anyH = headers as any;
  if (typeof anyH.getSetCookie === "function") {
    const arr = anyH.getSetCookie();
    if (Array.isArray(arr) && arr.length) return arr;
  }
  // Fallback: combined header (may have commas inside values, best-effort)
  const sc = headers.get("set-cookie");
  if (!sc) return [];
  // Split on comma followed by a cookie-name (letters/digits/_) and "="
  return sc.split(/,(?=\s*[A-Za-z0-9_-]+=)/);
}

function mergeCookies(existing: string, fromHeaders: string[]): string {
  const jar = new Map<string, string>();
  if (existing) {
    for (const part of existing.split(";")) {
      const [k, ...rest] = part.trim().split("=");
      if (k) jar.set(k, rest.join("="));
    }
  }
  for (const sc of fromHeaders) {
    const first = sc.split(";")[0];
    const [k, ...rest] = first.trim().split("=");
    if (k && rest.length) jar.set(k, rest.join("="));
  }
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function fetchAuth(): Promise<{ cookie: string; crumb: string } | null> {
  try {
    console.log("[YahooAuth] Starting crumb handshake");
    let cookie = "";
    const seedRes = await fetch("https://fc.yahoo.com", {
      method: "GET",
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "manual",
    }).catch((e) => {
      console.log("[YahooAuth] fc.yahoo.com fetch threw:", e?.message);
      return null;
    });
    if (seedRes) {
      const sc = readSetCookies(seedRes.headers);
      console.log("[YahooAuth] fc.yahoo.com status:", seedRes.status, "set-cookies:", sc.length);
      cookie = mergeCookies(cookie, sc);
    }

    // Step 2 — fall back to the public quote page which also drops the same
    // cookies. We follow redirects manually so we can collect cookies from each
    // hop (consent.yahoo.com → guce.yahoo.com → finance.yahoo.com).
    if (!cookie) {
      let url: string | null = "https://finance.yahoo.com/quote/AAPL/";
      for (let hop = 0; hop < 5 && url; hop++) {
        const r: Response = await fetch(url, {
          method: "GET",
          headers: {
            "User-Agent": BROWSER_UA,
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
            ...(cookie ? { Cookie: cookie } : {}),
          },
          redirect: "manual",
        });
        cookie = mergeCookies(cookie, readSetCookies(r.headers));
        if (r.status >= 300 && r.status < 400) {
          const loc = r.headers.get("location");
          if (!loc) break;
          url = loc.startsWith("http") ? loc : new URL(loc, url).toString();
        } else {
          url = null;
        }
      }
    }

    if (!cookie) {
      console.log("[YahooAuth] No cookie obtained — aborting");
      return null;
    }
    console.log("[YahooAuth] Cookie jar size (chars):", cookie.length);

    const crumbRes = await fetch(
      "https://query1.finance.yahoo.com/v1/test/getcrumb",
      {
        method: "GET",
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "*/*",
          Cookie: cookie,
        },
      },
    );
    const crumb = (await crumbRes.text()).trim();
    console.log(
      "[YahooAuth] getcrumb status:",
      crumbRes.status,
      "body[0..200]:",
      crumb.slice(0, 200),
    );
    if (
      !crumb ||
      crumb.length > 64 ||
      crumb.includes("<") ||
      crumb.toLowerCase().includes("too many") ||
      crumb.toLowerCase().includes("error")
    ) {
      console.log("[YahooAuth] Crumb rejected by validator");
      return null;
    }
    console.log("[YahooAuth] ✓ crumb obtained");
    return { cookie, crumb };
  } catch (e: any) {
    console.log("[YahooAuth] threw:", e?.message);
    return null;
  }
}

export async function getYahooAuth(): Promise<{ cookie: string; crumb: string } | null> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) {
    return { cookie: cached.cookie, crumb: cached.crumb };
  }
  if (inflight) return inflight;
  inflight = (async () => {
    const fresh = await fetchAuth();
    if (fresh) cached = { ...fresh, at: Date.now() };
    inflight = null;
    return fresh;
  })();
  return inflight;
}

export function clearYahooAuth() {
  cached = null;
}

export const YAHOO_BROWSER_UA = BROWSER_UA;
