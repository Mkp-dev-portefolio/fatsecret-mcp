#!/usr/bin/env node
/**
 * FatSecret MCP Server
 *
 * A Model Context Protocol server that exposes FatSecret's nutrition and
 * food-logging API as LLM-callable tools. Compatible with any MCP host:
 * Claude Desktop, GPT-4 (via bridge), Cursor, Continue, etc.
 *
 * Authentication:
 *   - Public tools (search_foods, get_food, search_recipes):
 *       OAuth 2.0 client credentials — only FATSECRET_CLIENT_ID + FATSECRET_CLIENT_SECRET needed.
 *   - Diary tools (get_food_entries, add_food_entry, edit_food_entry, delete_food_entry,
 *       get_weight_entries, update_weight_entry, delete_weight_entry,
 *       get_daily_nutrition, get_month_of_statistics):
 *       OAuth 1.0 (3-legged) — also requires FATSECRET_ACCESS_TOKEN + FATSECRET_ACCESS_TOKEN_SECRET.
 *       Note: write tools (add/edit/delete) also require Diary Read/Write API access from FatSecret.
 *
 * Usage:
 *   npx fatsecret-mcp
 *   node dist/index.js
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { ZodError } from "zod";

import { FatSecretClient } from "./fatsecret.js";
import { FOOD_TOOLS, handleSearchFoods, handleGetFood, handleSearchRecipes } from "./tools/food.js";
import {
  DIARY_TOOLS,
  handleGetFoodEntries,
  handleAddFoodEntry,
  handleEditFoodEntry,
  handleDeleteFoodEntry,
  handleGetWeightEntries,
  handleUpdateWeightEntry,
  handleDeleteWeightEntry,
} from "./tools/diary.js";
import { NUTRITION_TOOLS, handleGetDailyNutrition, handleGetMonthOfStatistics } from "./tools/nutrition.js";

// ─── Server setup ─────────────────────────────────────────────────────────────

const server = new Server(
  {
    name: "fatsecret-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Lazily initialise the API client so credential errors surface at call time,
// not at server startup (which would prevent the server process from starting).
let _client: FatSecretClient | null = null;

function getClient(): FatSecretClient {
  if (!_client) {
    _client = new FatSecretClient();
  }
  return _client;
}

// ─── Tool registry ────────────────────────────────────────────────────────────

const ALL_TOOLS = [...FOOD_TOOLS, ...DIARY_TOOLS, ...NUTRITION_TOOLS];

// ─── List tools handler ───────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: ALL_TOOLS };
});

// ─── Call tool handler ────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const client = getClient();
    let result: string;

    switch (name) {
      // ── Food tools (OAuth 2.0) ──────────────────────────────────────────────
      case "search_foods":
        result = await handleSearchFoods(client, args);
        break;

      case "get_food":
        result = await handleGetFood(client, args);
        break;

      case "search_recipes":
        result = await handleSearchRecipes(client, args);
        break;

      // ── Diary tools (OAuth 1.0) ─────────────────────────────────────────────
      case "get_food_entries":
        result = await handleGetFoodEntries(client, args);
        break;

      case "add_food_entry":
        result = await handleAddFoodEntry(client, args);
        break;

      case "edit_food_entry":
        result = await handleEditFoodEntry(client, args);
        break;

      case "delete_food_entry":
        result = await handleDeleteFoodEntry(client, args);
        break;

      case "get_weight_entries":
        result = await handleGetWeightEntries(client, args);
        break;

      case "update_weight_entry":
        result = await handleUpdateWeightEntry(client, args);
        break;

      case "delete_weight_entry":
        result = await handleDeleteWeightEntry(client, args);
        break;

      // ── Nutrition tools (OAuth 1.0) ─────────────────────────────────────────
      case "get_daily_nutrition":
        result = await handleGetDailyNutrition(client, args);
        break;

      case "get_month_of_statistics":
        result = await handleGetMonthOfStatistics(client, args);
        break;

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: "${name}". Available tools: ${ALL_TOOLS.map((t) => t.name).join(", ")}`
        );
    }

    return {
      content: [
        {
          type: "text",
          text: result,
        },
      ],
    };
  } catch (error) {
    // Surface Zod validation errors as clear user-facing messages
    if (error instanceof ZodError) {
      const issues = error.issues
        .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid tool arguments for "${name}":\n${issues}`
      );
    }

    // Re-throw MCP errors directly
    if (error instanceof McpError) {
      throw error;
    }

    // Wrap all other errors (network, API, auth) as internal errors
    const message = error instanceof Error ? error.message : String(error);
    throw new McpError(ErrorCode.InternalError, `Tool "${name}" failed: ${message}`);
  }
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await server.close();
  process.exit(0);
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with the MCP stdio protocol
  console.error("FatSecret MCP server running on stdio");
  console.error(
    `Loaded ${ALL_TOOLS.length} tools: ${ALL_TOOLS.map((t) => t.name).join(", ")}`
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
