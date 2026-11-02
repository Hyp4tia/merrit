import { config } from "./config.ts";
import { getLinkedInToken, saveLinkedInToken } from "./db.ts";

const AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const POSTS_URL = "https://api.linkedin.com/rest/posts";

export function isConfigured(): boolean {
  return Boolean(config.linkedin.clientId && config.linkedin.clientSecret);
}

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.linkedin.clientId,
    redirect_uri: config.linkedin.redirectUri,
    state,
    // userinfo (to learn the person urn) needs openid and profile. Posting needs
    // w_member_social. All three are self-serve on the Share on LinkedIn product.
    scope: "openid profile w_member_social",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

export async function exchangeCode(code: string): Promise<{ personUrn: string; scope: string }> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.linkedin.clientId,
      client_secret: config.linkedin.clientSecret,
      redirect_uri: config.linkedin.redirectUri,
    }),
  });

  const payload = (await response.json()) as TokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new Error(`LinkedIn token exchange failed (${response.status}): ${payload.error_description ?? payload.error ?? "unknown"}`);
  }

  const userinfo = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${payload.access_token}` },
  });
  if (!userinfo.ok) {
    throw new Error(`LinkedIn userinfo failed (${userinfo.status}): ${await userinfo.text()}`);
  }
  const person = (await userinfo.json()) as { sub?: string };
  if (!person.sub) throw new Error("LinkedIn userinfo returned no person id");

  const expiresAt = payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000) : null;
  await saveLinkedInToken({
    access_token: payload.access_token,
    scope: payload.scope ?? "w_member_social",
    person_urn: `urn:li:person:${person.sub}`,
    expires_at: expiresAt,
  });

  return { personUrn: `urn:li:person:${person.sub}`, scope: payload.scope ?? "w_member_social" };
}

export class LinkedInError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly scopeProblem: boolean,
  ) {
    super(message);
  }
}

// Official Posts API only. No browser automation, no unofficial endpoints.
export async function publishPost(commentary: string): Promise<{ url: string; postUrn: string }> {
  const token = await getLinkedInToken();
  if (!token) throw new LinkedInError("No LinkedIn token. Authorize first at /oauth/linkedin/start.", 0, false);
  if (!token.person_urn) throw new LinkedInError("Stored LinkedIn token has no person urn. Re-authorize.", 0, false);
  if (token.expires_at && token.expires_at.getTime() < Date.now()) {
    throw new LinkedInError("Stored LinkedIn token has expired. Re-authorize.", 401, false);
  }

  const body = {
    author: token.person_urn,
    commentary,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  const response = await fetch(POSTS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token.access_token}`,
      "content-type": "application/json",
      "LinkedIn-Version": config.linkedin.version,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    const scopeProblem = /scope|NotEnoughScopes|ACCESS_DENIED|permission/i.test(detail);
    throw new LinkedInError(`LinkedIn publish failed (${response.status}): ${detail.slice(0, 500)}`, response.status, scopeProblem);
  }

  // The Posts API returns the created urn in a response header, and no body.
  const postUrn = response.headers.get("x-restli-id") ?? "";
  const numeric = postUrn.split(":").pop() ?? "";
  const url = numeric ? `https://www.linkedin.com/feed/update/${postUrn}/` : "https://www.linkedin.com/feed/recent-activity/all/";

  return { url, postUrn };
}
