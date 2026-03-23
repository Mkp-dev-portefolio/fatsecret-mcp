# 🥗 FatSecret MCP Server

A **Model Context Protocol (MCP)** server for the [FatSecret Platform API](https://platform.fatsecret.com). Connect any MCP-compatible LLM (Claude, GPT-4, Cursor, Continue, etc.) directly to FatSecret's nutrition database and food-logging features.

## Features

| Tool | Description | Auth |
|------|-------------|------|
| `search_foods` | Search the FatSecret food database by name | OAuth 2.0 |
| `get_food` | Get full nutrition info for a specific food (all servings + micros) | OAuth 2.0 |
| `search_recipes` | Search recipes with calorie/macro filters | OAuth 2.0 |
| `get_food_entries` | Read diary entries for any date | OAuth 1.0 |
| `add_food_entry` | Log a food to the diary | OAuth 1.0 |
| `get_daily_nutrition` | Daily macro/calorie totals aggregated from diary | OAuth 1.0 |
| `get_month_of_statistics` | Per-day nutrition stats for an entire month | OAuth 1.0 |

> **Note:** Tools marked **OAuth 1.0** require additional user-level tokens (see [Obtaining User Tokens](#obtaining-user-tokens-diary-features)). The three **OAuth 2.0** tools work with just your app credentials.

---

## Quick Start

### 1. Get API Credentials

1. Sign up at [platform.fatsecret.com](https://platform.fatsecret.com)
2. Create an application to receive your **Client ID** and **Client Secret**

### 2. Install & Build

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/fatsecret-mcp.git
cd fatsecret-mcp

# Install dependencies
npm install

# Build TypeScript
npm run build
```

### 3. Configure Credentials

```bash
cp .env.example .env
# Edit .env and fill in your credentials
```

### 4. Test It

```bash
# Quick sanity check — search for "apple"
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_foods","arguments":{"query":"apple"}}}' \
  | FATSECRET_CLIENT_ID=xxx FATSECRET_CLIENT_SECRET=yyy node dist/index.js
```

---

## Claude Desktop Configuration

Add this to your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "fatsecret": {
      "command": "node",
      "args": ["/absolute/path/to/fatsecret-mcp/dist/index.js"],
      "env": {
        "FATSECRET_CLIENT_ID": "your_client_id",
        "FATSECRET_CLIENT_SECRET": "your_client_secret",
        "FATSECRET_ACCESS_TOKEN": "your_access_token",
        "FATSECRET_ACCESS_TOKEN_SECRET": "your_access_token_secret"
      }
    }
  }
}
```

Or, if you prefer using a `.env` file and `npx`:

```json
{
  "mcpServers": {
    "fatsecret": {
      "command": "npx",
      "args": ["fatsecret-mcp"],
      "env": {
        "FATSECRET_CLIENT_ID": "your_client_id",
        "FATSECRET_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

After editing the config, restart Claude Desktop. You should see FatSecret tools available in Claude's tool panel.

---

## Tool Reference

### `search_foods`

Search the FatSecret food database.

**Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | ✅ | — | Search term (e.g. `"chicken breast"`) |
| `max_results` | number | | `10` | Results per page (1–50) |
| `page_number` | number | | `0` | Zero-based page index |
| `food_type` | `"generic"` \| `"brand"` \| `"all"` | | `"all"` | Filter by food type |
| `region` | string | | — | ISO 3166-1 alpha-2 code (e.g. `"US"`) |

**Example prompt:** *"Search for grilled salmon and show me the calories"*

---

### `get_food`

Get complete nutrition data for a food item.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `food_id` | string | ✅ | FatSecret food ID (from `search_foods`) |
| `flag_default_serving` | boolean | | Highlight default serving (default `true`) |

**Example prompt:** *"Get full nutrition info for food ID 35718"*

---

### `search_recipes`

Search FatSecret's recipe collection.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | | Search term (e.g. `"lemon chicken"`) |
| `max_results` | number | | Results per page (1–50, default `10`) |
| `page_number` | number | | Zero-based page index |
| `calories_min` | number | | Minimum calories per serving |
| `calories_max` | number | | Maximum calories per serving |
| `sort_by` | string | | `newest` \| `oldest` \| `caloriesPerServingAscending` \| `caloriesPerServingDescending` |
| `must_have_images` | boolean | | Only return recipes with images |

**Example prompt:** *"Find high-protein recipes under 400 calories"*

---

### `get_food_entries`

Read food diary entries. *Requires OAuth 1.0 tokens.*

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `date` | string | | `YYYY-MM-DD` (defaults to today) |
| `food_entry_id` | string | | Retrieve a specific entry |

**Example prompt:** *"What did I eat for lunch today?"*

---

### `add_food_entry`

Log a food to the diary. *Requires OAuth 1.0 tokens.*

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `food_id` | string | ✅ | FatSecret food ID |
| `serving_id` | string | ✅ | Serving size ID (from `get_food`) |
| `number_of_units` | number | ✅ | Number of servings consumed |
| `meal` | `"breakfast"` \| `"lunch"` \| `"dinner"` \| `"other"` | ✅ | Meal slot |
| `date` | string | | `YYYY-MM-DD` (defaults to today) |
| `food_entry_name` | string | | Custom display name |

**Example prompt:** *"Log 1.5 servings of chicken breast (food_id 4888, serving_id 15183) as dinner today"*

---

### `get_daily_nutrition`

Aggregate calorie and macro totals for a day. *Requires OAuth 1.0 tokens.*

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `date` | string | | `YYYY-MM-DD` (defaults to today) |

**Example prompt:** *"How many calories and grams of protein did I eat yesterday?"*

---

### `get_month_of_statistics`

Per-day nutrition data for an entire month. *Requires OAuth 1.0 tokens.*

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `date` | string | | Any date in the target month (defaults to current month) |

**Example prompt:** *"Show me my nutrition stats for March 2026"*

---

## Obtaining User Tokens (Diary Features)

Diary tools require a **three-legged OAuth 1.0** flow to obtain a user-specific access token and secret. Here's the full process:

### Step 1 — Get a Request Token

```bash
# Replace with your actual credentials
curl -X POST "https://www.fatsecret.com/oauth/request_token" \
  -H "Authorization: OAuth oauth_callback=\"oob\", \
      oauth_consumer_key=\"YOUR_CLIENT_ID\", \
      oauth_nonce=\"$(openssl rand -hex 16)\", \
      oauth_signature_method=\"HMAC-SHA1\", \
      oauth_timestamp=\"$(date +%s)\", \
      oauth_version=\"1.0\", \
      oauth_signature=\"<computed_signature>\""
```

> **Tip:** Use a library like [oauth-1.0a](https://www.npmjs.com/package/oauth-1.0a) or the [FatSecret API Demo](https://platform.fatsecret.com/api-demo) to handle signature generation.

### Step 2 — Authorize in Browser

Direct the user to:
```
https://www.fatsecret.com/oauth/authorize?oauth_token=<request_token>
```

The user logs in and approves. FatSecret shows a **PIN/verifier code**.

### Step 3 — Exchange for Access Token

```bash
curl -X POST "https://www.fatsecret.com/oauth/access_token" \
  -H "Authorization: OAuth oauth_consumer_key=\"YOUR_CLIENT_ID\", \
      oauth_token=\"<request_token>\", \
      oauth_verifier=\"<pin_code>\", \
      ..."
```

The response contains `oauth_token` (access token) and `oauth_token_secret`. Store these as `FATSECRET_ACCESS_TOKEN` and `FATSECRET_ACCESS_TOKEN_SECRET`.

> For a one-person setup (logging your own meals), you can use the FatSecret API Demo tool to complete the OAuth 1.0 flow and copy the resulting tokens directly.

---

## Example Conversation

Once configured in Claude Desktop, you can have natural conversations like:

> **You:** "I just had a bowl of oatmeal with milk for breakfast. Can you log it?"
>
> **Claude:** *(calls `search_foods` → `get_food` → `add_food_entry` automatically)*
> "Done! I logged 1 cup of cooked oatmeal (147 kcal) and 1 cup of whole milk (149 kcal) as breakfast. That's 296 kcal total with 13g protein."

> **You:** "How are my macros looking today?"
>
> **Claude:** *(calls `get_daily_nutrition`)*
> "You've had 1,240 kcal so far: 87g protein (28%), 142g carbs (46%), 38g fat (27%)."

---

## Development

```bash
# Run in development mode (no build step)
npm run dev

# Type-check only
npm run typecheck

# Build for production
npm run build
```

### Project Structure

```
src/
├── index.ts          # MCP server entry point, tool dispatch
├── fatsecret.ts      # API client (OAuth 2.0 + OAuth 1.0 HMAC-SHA1)
└── tools/
    ├── food.ts       # search_foods, get_food, search_recipes
    ├── diary.ts      # get_food_entries, add_food_entry
    └── nutrition.ts  # get_daily_nutrition, get_month_of_statistics
```

---

## API Limitations & Known Constraints

| Limitation | Detail |
|-----------|--------|
| **Diary requires OAuth 1.0** | Diary and monthly stats endpoints do not support OAuth 2.0. You must complete the 3-legged OAuth 1.0 flow and store personal tokens. |
| **No rate limit docs** | FatSecret does not publish rate limits publicly. The free tier is generally limited to ~2 req/sec. Premier accounts have higher limits. |
| **JSON inconsistency** | Single-result responses return an object; multi-result responses return an array. The client handles this automatically via `toArray()`. |
| **Premier features** | Barcode scanning, image recognition (Snap It), and NLP food logging require a Premier API subscription. |
| **Region availability** | Some foods/brands are region-specific. Use the `region` parameter to filter. |
| **Date integers** | FatSecret dates are stored as "days since 1970-01-01". The client converts to/from `YYYY-MM-DD` strings transparently. |

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

## Contributing

Issues and pull requests are welcome! Please open an issue first for major changes.
