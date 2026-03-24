/**
 * Diary tools: get_food_entries, add_food_entry
 *
 * These endpoints use OAuth 1.0 (3-legged) — user access tokens required.
 * Set FATSECRET_ACCESS_TOKEN and FATSECRET_ACCESS_TOKEN_SECRET in your environment.
 */

import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  FatSecretClient,
  FoodEntriesResult,
  FoodEntryAddResult,
  dateToDayInt,
  dayIntToDate,
  toArray,
} from "../fatsecret.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const GetFoodEntriesSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Date to retrieve diary entries for (YYYY-MM-DD, defaults to today)"),
  food_entry_id: z
    .string()
    .optional()
    .describe("Retrieve a specific diary entry by its ID"),
});

export const AddFoodEntrySchema = z.object({
  food_id: z
    .string()
    .or(z.number().transform(String))
    .describe("FatSecret food ID to log (from search_foods)"),
  serving_id: z
    .string()
    .or(z.number().transform(String))
    .describe("Serving ID to use (from get_food servings list)"),
  number_of_units: z
    .number()
    .positive()
    .describe("Number of servings consumed (e.g. 1.5 for 1.5 servings)"),
  meal: z
    .enum(["breakfast", "lunch", "dinner", "other"])
    .describe("Meal category for this entry"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Date to log the entry (YYYY-MM-DD, defaults to today)"),
  food_entry_name: z
    .string()
    .optional()
    .describe(
      "Custom display name for the diary entry (defaults to the food's name)"
    ),
});

// ─── Tool definitions ─────────────────────────────────────────────────────────

export const DIARY_TOOLS: Tool[] = [
  {
    name: "get_food_entries",
    description:
      "Get food diary entries for a specific date (or today by default). Returns all logged meals with nutrition totals. Requires OAuth 1.0 user credentials (FATSECRET_ACCESS_TOKEN + FATSECRET_ACCESS_TOKEN_SECRET).",
    inputSchema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description:
            "Date to retrieve diary entries for (YYYY-MM-DD). Defaults to today.",
        },
        food_entry_id: {
          type: "string",
          description: "Retrieve a specific diary entry by its ID",
        },
      },
      required: [],
    },
  },
  {
    name: "add_food_entry",
    description:
      "Add a food entry to the user's food diary. Use search_foods to find food_id and get_food to find the correct serving_id. Requires OAuth 1.0 user credentials.",
    inputSchema: {
      type: "object" as const,
      properties: {
        food_id: {
          type: "string",
          description: "FatSecret food ID (from search_foods)",
        },
        serving_id: {
          type: "string",
          description:
            "Serving size ID (from get_food). Use the serving_id field of the desired serving.",
        },
        number_of_units: {
          type: "number",
          description: "Number of servings consumed (e.g. 1 or 2.5)",
        },
        meal: {
          type: "string",
          enum: ["breakfast", "lunch", "dinner", "other"],
          description: "Which meal to log this food under",
        },
        date: {
          type: "string",
          description: "Date for the entry (YYYY-MM-DD). Defaults to today.",
        },
        food_entry_name: {
          type: "string",
          description:
            "Custom name for the diary entry (optional, defaults to food name)",
        },
      },
      required: ["food_id", "serving_id", "number_of_units", "meal"],
    },
  },
];

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function handleGetFoodEntries(
  client: FatSecretClient,
  args: unknown
): Promise<string> {
  const input = GetFoodEntriesSchema.parse(args);

  const dayInt = dateToDayInt(input.date);
  const displayDate = input.date || new Date().toISOString().split("T")[0];

  const params: Record<string, string> = {
    date: String(dayInt),
  };

  if (input.food_entry_id) {
    params.food_entry_id = input.food_entry_id;
  }

  const data = await client.diaryPost<FoodEntriesResult>(
    "food_entries.get.v2",
    params
  );

  if (!data.food_entries) {
    return `No diary entries found for ${displayDate}.`;
  }

  const entries = toArray(data.food_entries.food_entry);

  if (entries.length === 0) {
    return `No diary entries found for ${displayDate}.`;
  }

  // Group entries by meal
  const mealGroups: Record<string, typeof entries> = {};
  for (const entry of entries) {
    const meal = (entry.meal || "other").toLowerCase();
    if (!mealGroups[meal]) mealGroups[meal] = [];
    mealGroups[meal].push(entry);
  }

  // Compute daily totals
  let totalCals = 0;
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFat = 0;

  for (const entry of entries) {
    totalCals += parseFloat(entry.calories || "0");
    totalProtein += parseFloat(entry.protein || "0");
    totalCarbs += parseFloat(entry.carbohydrate || "0");
    totalFat += parseFloat(entry.fat || "0");
  }

  const lines: string[] = [
    `## Food Diary — ${displayDate}`,
    "",
  ];

  const mealOrder = ["breakfast", "lunch", "dinner", "other"];
  for (const meal of mealOrder) {
    const mealEntries = mealGroups[meal];
    if (!mealEntries || mealEntries.length === 0) continue;

    lines.push(`### ${meal.charAt(0).toUpperCase() + meal.slice(1)}`);

    let mealCals = 0;
    for (const entry of mealEntries) {
      const cals = parseFloat(entry.calories || "0");
      mealCals += cals;

      lines.push(`- **${entry.food_entry_description}** (ID: ${entry.food_entry_id})`);
      lines.push(
        `  ${entry.calories ?? "?"}kcal · Protein: ${entry.protein ?? "?"}g · ` +
          `Carbs: ${entry.carbohydrate ?? "?"}g · Fat: ${entry.fat ?? "?"}g`
      );
    }

    lines.push(`  *Meal total: ${mealCals.toFixed(0)}kcal*`);
    lines.push("");
  }

  lines.push("---");
  lines.push(`**Daily Total:** ${totalCals.toFixed(0)}kcal`);
  lines.push(
    `Protein: ${totalProtein.toFixed(1)}g · Carbs: ${totalCarbs.toFixed(1)}g · Fat: ${totalFat.toFixed(1)}g`
  );

  return lines.join("\n");
}

export async function handleAddFoodEntry(
  client: FatSecretClient,
  args: unknown
): Promise<string> {
  const input = AddFoodEntrySchema.parse(args);

  const dayInt = dateToDayInt(input.date);
  const displayDate = input.date || new Date().toISOString().split("T")[0];

  const params: Record<string, string> = {
    food_id: String(input.food_id),
    serving_id: String(input.serving_id),
    number_of_units: String(input.number_of_units),
    meal: input.meal,
    date_int: String(dayInt),
  };

  if (input.food_entry_name) {
    params.food_entry_name = input.food_entry_name;
  }

  const data = await client.diaryPost<FoodEntryAddResult>(
    "food_entry.add",
    params
  );

  const entry = data.food_entry;

  return [
    `✅ **Food entry added successfully!**`,
    "",
    `**Entry ID:** ${entry.food_entry_id}`,
    `**Date:** ${displayDate}`,
    `**Meal:** ${entry.meal}`,
    `**Description:** ${entry.food_entry_description}`,
    `**Servings:** ${entry.number_of_units}`,
    "",
    `**Nutrition:**`,
    `  Calories: ${entry.calories}kcal`,
    `  Protein: ${entry.protein}g`,
    `  Carbs: ${entry.carbohydrate}g`,
    `  Fat: ${entry.fat}g`,
  ].join("\n");
}
