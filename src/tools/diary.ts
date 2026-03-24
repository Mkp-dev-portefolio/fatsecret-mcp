/**
 * Diary tools: get_food_entries, add_food_entry, edit_food_entry,
 *              delete_food_entry, get_weight_entries, update_weight_entry,
 *              delete_weight_entry
 *
 * These endpoints use OAuth 1.0 (3-legged) — user access tokens required.
 * Set FATSECRET_ACCESS_TOKEN and FATSECRET_ACCESS_TOKEN_SECRET in your environment.
 *
 * NOTE: add_food_entry, edit_food_entry, delete_food_entry, update_weight_entry,
 * and delete_weight_entry require "Diary Read/Write" access on your FatSecret API key.
 * Contact FatSecret support to enable this on your account.
 */

import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  FatSecretClient,
  FoodEntriesResult,
  FoodEntryAddResult,
  FoodEntryEditResult,
  WeightEntriesResult,
  WeightUpdateResult,
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

export const EditFoodEntrySchema = z.object({
  food_entry_id: z
    .string()
    .or(z.number().transform(String))
    .describe("ID of the diary entry to edit (from get_food_entries)"),
  serving_id: z
    .string()
    .or(z.number().transform(String))
    .describe("New serving ID (from get_food)"),
  number_of_units: z
    .number()
    .positive()
    .describe("New number of servings consumed"),
  meal: z
    .enum(["breakfast", "lunch", "dinner", "other"])
    .optional()
    .describe("New meal category for this entry"),
  food_entry_name: z
    .string()
    .optional()
    .describe("New custom display name for the entry"),
});

export const DeleteFoodEntrySchema = z.object({
  food_entry_id: z
    .string()
    .or(z.number().transform(String))
    .describe("ID of the diary entry to delete (from get_food_entries)"),
});

export const GetWeightEntriesSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Date to retrieve weight entries for (YYYY-MM-DD, defaults to today)"),
});

export const UpdateWeightEntrySchema = z.object({
  weight_kg: z
    .number()
    .positive()
    .describe("Weight in kilograms"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Date for the weight entry (YYYY-MM-DD, defaults to today)"),
  comment: z
    .string()
    .optional()
    .describe("Optional comment for the weight entry"),
});

export const DeleteWeightEntrySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe("Date of the weight entry to delete (YYYY-MM-DD, defaults to today)"),
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
      "Add a food entry to the user's food diary. Use search_foods to find food_id and get_food to find the correct serving_id. Requires OAuth 1.0 user credentials AND Diary Read/Write API access (contact FatSecret support to enable).",
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
  {
    name: "edit_food_entry",
    description:
      "Edit an existing food diary entry (change serving size, meal, or number of units). Use get_food_entries to find the food_entry_id. Requires Diary Read/Write API access.",
    inputSchema: {
      type: "object" as const,
      properties: {
        food_entry_id: {
          type: "string",
          description: "ID of the diary entry to edit (from get_food_entries)",
        },
        serving_id: {
          type: "string",
          description: "New serving size ID (from get_food)",
        },
        number_of_units: {
          type: "number",
          description: "New number of servings consumed",
        },
        meal: {
          type: "string",
          enum: ["breakfast", "lunch", "dinner", "other"],
          description: "New meal category",
        },
        food_entry_name: {
          type: "string",
          description: "New custom display name (optional)",
        },
      },
      required: ["food_entry_id", "serving_id", "number_of_units"],
    },
  },
  {
    name: "delete_food_entry",
    description:
      "Delete a food diary entry by its ID. Use get_food_entries to find the food_entry_id first. Requires Diary Read/Write API access.",
    inputSchema: {
      type: "object" as const,
      properties: {
        food_entry_id: {
          type: "string",
          description: "ID of the diary entry to delete (from get_food_entries)",
        },
      },
      required: ["food_entry_id"],
    },
  },
  {
    name: "get_weight_entries",
    description:
      "Get body weight entries for a specific date. Returns weight in kg and BMI if available. Requires OAuth 1.0 user credentials.",
    inputSchema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description:
            "Date to retrieve weight entries for (YYYY-MM-DD). Defaults to today.",
        },
      },
      required: [],
    },
  },
  {
    name: "update_weight_entry",
    description:
      "Log or update a body weight entry for a specific date. Requires Diary Read/Write API access.",
    inputSchema: {
      type: "object" as const,
      properties: {
        weight_kg: {
          type: "number",
          description: "Weight in kilograms",
        },
        date: {
          type: "string",
          description:
            "Date for the weight entry (YYYY-MM-DD). Defaults to today.",
        },
        comment: {
          type: "string",
          description: "Optional comment for the weight entry",
        },
      },
      required: ["weight_kg"],
    },
  },
  {
    name: "delete_weight_entry",
    description:
      "Delete a body weight entry for a specific date. Requires Diary Read/Write API access.",
    inputSchema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description:
            "Date of the weight entry to delete (YYYY-MM-DD). Defaults to today.",
        },
      },
      required: [],
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
    meal: input.meal.charAt(0).toUpperCase() + input.meal.slice(1),
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

export async function handleEditFoodEntry(
  client: FatSecretClient,
  args: unknown
): Promise<string> {
  const input = EditFoodEntrySchema.parse(args);

  const params: Record<string, string> = {
    food_entry_id: String(input.food_entry_id),
    serving_id: String(input.serving_id),
    number_of_units: String(input.number_of_units),
  };

  if (input.meal) {
    params.meal = input.meal.charAt(0).toUpperCase() + input.meal.slice(1);
  }
  if (input.food_entry_name) {
    params.food_entry_name = input.food_entry_name;
  }

  const data = await client.diaryPost<FoodEntryEditResult>(
    "food_entry.edit",
    params
  );

  const entry = data.food_entry;

  return [
    `✅ **Food entry updated!**`,
    "",
    `**Entry ID:** ${entry.food_entry_id}`,
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

export async function handleDeleteFoodEntry(
  client: FatSecretClient,
  args: unknown
): Promise<string> {
  const input = DeleteFoodEntrySchema.parse(args);

  await client.diaryPost<Record<string, unknown>>("food_entry.delete", {
    food_entry_id: String(input.food_entry_id),
  });

  return `✅ Food diary entry **${input.food_entry_id}** deleted successfully.`;
}

export async function handleGetWeightEntries(
  client: FatSecretClient,
  args: unknown
): Promise<string> {
  const input = GetWeightEntriesSchema.parse(args);

  const dayInt = dateToDayInt(input.date);
  const displayDate = input.date || new Date().toISOString().split("T")[0];

  const data = await client.diaryPost<WeightEntriesResult>(
    "weight_entries.get",
    { date: String(dayInt) }
  );

  if (!data.weight_entries) {
    return `No weight entries found for ${displayDate}.`;
  }

  const entries = toArray(data.weight_entries.weight_entry);
  if (entries.length === 0) {
    return `No weight entries found for ${displayDate}.`;
  }

  const lines: string[] = [`## Weight Entries — ${displayDate}`, ""];
  for (const e of entries) {
    const date = dayIntToDate(parseInt(e.date_int, 10));
    lines.push(`**${date}**: ${e.weight_kg} kg${e.weight_lbs ? ` (${e.weight_lbs} lbs)` : ""}${e.bmi ? ` · BMI: ${e.bmi}` : ""}`);
    if (e.comment) lines.push(`  *${e.comment}*`);
  }

  return lines.join("\n");
}

export async function handleUpdateWeightEntry(
  client: FatSecretClient,
  args: unknown
): Promise<string> {
  const input = UpdateWeightEntrySchema.parse(args);

  const dayInt = dateToDayInt(input.date);
  const displayDate = input.date || new Date().toISOString().split("T")[0];

  const params: Record<string, string> = {
    date_int: String(dayInt),
    weight_kg: String(input.weight_kg),
  };

  if (input.comment) {
    params.comment = input.comment;
  }

  const data = await client.diaryPost<WeightUpdateResult>(
    "weight_entry.update",
    params
  );

  const e = data.weight_entry;

  return [
    `✅ **Weight entry saved!**`,
    "",
    `**Date:** ${displayDate}`,
    `**Weight:** ${e.weight_kg} kg${e.weight_lbs ? ` (${e.weight_lbs} lbs)` : ""}`,
    e.bmi ? `**BMI:** ${e.bmi}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function handleDeleteWeightEntry(
  client: FatSecretClient,
  args: unknown
): Promise<string> {
  const input = DeleteWeightEntrySchema.parse(args);

  const dayInt = dateToDayInt(input.date);
  const displayDate = input.date || new Date().toISOString().split("T")[0];

  await client.diaryPost<Record<string, unknown>>("weight_entry.delete", {
    date_int: String(dayInt),
  });

  return `✅ Weight entry for **${displayDate}** deleted successfully.`;
}
