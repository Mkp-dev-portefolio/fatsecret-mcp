/**
 * FatSecret API Client
 *
 * Handles both OAuth 2.0 (client credentials, for public food/recipe data)
 * and OAuth 1.0 HMAC-SHA1 (3-legged, for user diary/profile endpoints).
 *
 * OAuth 2.0 endpoints: food search, food get, recipe search
 * OAuth 1.0 endpoints: food diary, monthly statistics (require user tokens)
 */

import * as crypto from "crypto";

// ─── Constants ────────────────────────────────────────────────────────────────

const OAUTH2_TOKEN_URL = "https://oauth.fatsecret.com/connect/token";
const API_BASE_URL = "https://platform.fatsecret.com/rest";
const SERVER_API_URL = `${API_BASE_URL}/server.api`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface OAuth2Token {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

interface CachedToken extends OAuth2Token {
  expiresAt: number;
}

export interface FatSecretError {
  code: number;
  message: string;
}

export interface FoodSearchResult {
  foods_search: {
    max_results: string;
    total_results: string;
    page_number: string;
    results?: {
      food: FoodSummary | FoodSummary[];
    };
  };
}

export interface FoodSummary {
  food_id: string;
  food_name: string;
  food_type: string;
  food_url: string;
  brand_name?: string;
  food_sub_categories?: { food_sub_category: string[] };
  servings?: {
    serving: ServingSummary | ServingSummary[];
  };
}

export interface ServingSummary {
  serving_id: string;
  serving_description: string;
  serving_url?: string;
  metric_serving_amount?: string;
  metric_serving_unit?: string;
  number_of_units?: string;
  measurement_description?: string;
  calories?: string;
  carbohydrate?: string;
  protein?: string;
  fat?: string;
  saturated_fat?: string;
  polyunsaturated_fat?: string;
  monounsaturated_fat?: string;
  trans_fat?: string;
  cholesterol?: string;
  sodium?: string;
  potassium?: string;
  fiber?: string;
  sugar?: string;
  added_sugars?: string;
  vitamin_a?: string;
  vitamin_c?: string;
  vitamin_d?: string;
  calcium?: string;
  iron?: string;
  is_default?: string;
}

export interface FoodDetail {
  food: {
    food_id: string;
    food_name: string;
    food_type: string;
    food_url: string;
    brand_name?: string;
    food_sub_categories?: { food_sub_category: string | string[] };
    servings: {
      serving: ServingSummary | ServingSummary[];
    };
  };
}

export interface FoodEntriesResult {
  food_entries?: {
    food_entry: FoodEntry | FoodEntry[];
  };
}

export interface FoodEntry {
  food_entry_id: string;
  food_entry_description: string;
  date_int: string;
  meal: string;
  food_id?: string;
  serving_id?: string;
  number_of_units?: string;
  calories?: string;
  carbohydrate?: string;
  protein?: string;
  fat?: string;
  saturated_fat?: string;
  fiber?: string;
  sugar?: string;
  sodium?: string;
  potassium?: string;
}

export interface FoodEntryAddResult {
  food_entry: {
    food_entry_id: string;
    date_int: string;
    meal: string;
    food_id: string;
    serving_id: string;
    number_of_units: string;
    food_entry_description: string;
    calories: string;
    carbohydrate: string;
    protein: string;
    fat: string;
  };
}

export interface MonthResult {
  month: {
    from_date_int: string;
    to_date_int: string;
    day?: DaySummary | DaySummary[];
  };
}

export interface DaySummary {
  date_int: string;
  calories: string;
  carbohydrate: string;
  protein: string;
  fat: string;
}

export interface RecipeSearchResult {
  recipes: {
    max_results: string;
    total_results: string;
    page_number: string;
    recipe?: RecipeSummary | RecipeSummary[];
  };
}

export interface RecipeSummary {
  recipe_id: string;
  recipe_name: string;
  recipe_description: string;
  recipe_image?: string;
  recipe_nutrition: {
    calories: string;
    carbohydrate: string;
    protein: string;
    fat: string;
  };
  recipe_ingredients?: {
    ingredient: string | string[];
  };
  recipe_types?: {
    recipe_type: string | string[];
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a YYYY-MM-DD date string (or today) to days since Unix epoch.
 * FatSecret uses this integer format for date parameters.
 */
export function dateToDayInt(dateStr?: string): number {
  const date = dateStr ? new Date(dateStr + "T00:00:00Z") : new Date();
  return Math.floor(date.getTime() / (1000 * 60 * 60 * 24));
}

/**
 * Convert a FatSecret day integer back to a YYYY-MM-DD string.
 */
export function dayIntToDate(dayInt: number): string {
  const ms = dayInt * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().split("T")[0];
}

/**
 * Normalise FatSecret's inconsistent single-item vs array responses.
 * When there's only 1 result, the API returns an object; for >1 it returns an array.
 */
export function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class FatSecretClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly accessToken: string | undefined;
  private readonly accessTokenSecret: string | undefined;
  private cachedToken: CachedToken | null = null;

  constructor() {
    const clientId = process.env.FATSECRET_CLIENT_ID;
    const clientSecret = process.env.FATSECRET_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error(
        "Missing required environment variables: FATSECRET_CLIENT_ID and FATSECRET_CLIENT_SECRET"
      );
    }

    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.accessToken = process.env.FATSECRET_ACCESS_TOKEN;
    this.accessTokenSecret = process.env.FATSECRET_ACCESS_TOKEN_SECRET;
  }

  // ── OAuth 2.0 ──────────────────────────────────────────────────────────────

  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 60-second buffer)
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.access_token;
    }

    const credentials = Buffer.from(
      `${this.clientId}:${this.clientSecret}`
    ).toString("base64");

    const response = await fetch(OAUTH2_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=basic",
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `OAuth 2.0 token request failed (${response.status}): ${body}`
      );
    }

    const token = (await response.json()) as OAuth2Token;
    this.cachedToken = {
      ...token,
      // Refresh 60 seconds before actual expiry
      expiresAt: Date.now() + (token.expires_in - 60) * 1000,
    };

    return this.cachedToken.access_token;
  }

  // ── OAuth 1.0 HMAC-SHA1 ───────────────────────────────────────────────────

  private buildOAuth1Header(
    method: string,
    url: string,
    bodyParams: Record<string, string>
  ): string {
    if (!this.accessToken || !this.accessTokenSecret) {
      throw new Error(
        "Diary and monthly statistics features require OAuth 1.0 user credentials.\n" +
          "Please set FATSECRET_ACCESS_TOKEN and FATSECRET_ACCESS_TOKEN_SECRET in your .env file.\n" +
          "See README.md for instructions on obtaining user tokens."
      );
    }

    const nonce = crypto.randomBytes(16).toString("hex");
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const oauthParams: Record<string, string> = {
      oauth_consumer_key: this.clientId,
      oauth_nonce: nonce,
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: timestamp,
      oauth_token: this.accessToken,
      oauth_version: "1.0",
    };

    // Build the parameter string: all body params + oauth params, sorted
    const allParams: Record<string, string> = {
      ...bodyParams,
      ...oauthParams,
    };

    const paramString = Object.keys(allParams)
      .sort()
      .map(
        (k) =>
          `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`
      )
      .join("&");

    // Signature base string
    const signatureBase = [
      method.toUpperCase(),
      encodeURIComponent(url),
      encodeURIComponent(paramString),
    ].join("&");

    // Signing key: consumer secret + "&" + token secret (both percent-encoded)
    const signingKey = `${encodeURIComponent(this.clientSecret)}&${encodeURIComponent(this.accessTokenSecret)}`;

    const signature = crypto
      .createHmac("sha1", signingKey)
      .update(signatureBase)
      .digest("base64");

    oauthParams["oauth_signature"] = signature;

    // Build Authorization header
    return (
      "OAuth " +
      Object.keys(oauthParams)
        .sort()
        .map(
          (k) =>
            `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`
        )
        .join(", ")
    );
  }

  // ── Public request (OAuth 2.0) ─────────────────────────────────────────────

  async publicGet<T>(path: string, params: Record<string, string>): Promise<T> {
    const token = await this.getAccessToken();
    const qs = new URLSearchParams({ ...params, format: "json" });
    const url = `${API_BASE_URL}/${path}?${qs.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`FatSecret API error (${response.status}): ${body}`);
    }

    const data = (await response.json()) as T;
    this.checkApiError(data);
    return data;
  }

  // ── User diary request (OAuth 1.0) ────────────────────────────────────────

  async diaryPost<T>(
    method: string,
    params: Record<string, string>
  ): Promise<T> {
    const bodyParams: Record<string, string> = {
      ...params,
      method,
      format: "json",
    };

    const authHeader = this.buildOAuth1Header("POST", SERVER_API_URL, bodyParams);
    const body = new URLSearchParams(bodyParams);

    const response = await fetch(SERVER_API_URL, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(
        `FatSecret diary API error (${response.status}): ${errBody}`
      );
    }

    const data = (await response.json()) as T;
    this.checkApiError(data);
    return data;
  }

  // ── Error checking ────────────────────────────────────────────────────────

  private checkApiError(data: unknown): void {
    if (
      data &&
      typeof data === "object" &&
      "error" in data &&
      data.error
    ) {
      const err = (data as { error: FatSecretError }).error;
      throw new Error(`FatSecret error ${err.code}: ${err.message}`);
    }
  }
}
