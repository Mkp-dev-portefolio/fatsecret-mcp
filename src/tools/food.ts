/**
 * Food tools: search_foods, get_food, search_recipes
 *
 * Uses 2-legged OAuth 1.0 via server.api — no IP whitelist required.
 */

import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  FatSecretClient,
  FoodSearchResult,
  FoodDetail,
  RecipeSearchResult,
  toArray,
} from "../fatsecret.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const SearchFoodsSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("Food name or keyword to search for (e.g. 'banana', 'chicken breast')"),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("Number of results to return (1–50, default 10)"),
  page_number: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Zero-based page offset for pagination (default 0)"),
  food_type: z
    .enum(["generic", "brand", "all"])
    .default("all")
    .describe("Filter by food type: 'generic', 'brand', or 'all'"),
  region: z
    .string()
    .length(2)
    .optional()
    .describe("ISO 3166-1 alpha-2 region code to filter results (e.g. 'US', 'GB')"),
});

export const GetFoodSchema = z.object({
  food_id: z
    .string()
    .or(z.number().transform(String))
    .describe("FatSecret food ID (from search results)"),
  flag_default_serving: z
    .boolean()
    .default(true)
    .describe("Flag the default serving size in the response"),
});

export const SearchRecipesSchema = z.object({
  query: z
    .string()
    .describe(
      "Recipe search expression (e.g. 'lemon chicken'). Leave empty to browse all."
    )
    .optional(),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("Number of results to return (1–50, default 10)"),
  page_number: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Zero-based page offset for pagination"),
  calories_max: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Maximum calories per serving"),
  calories_min: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Minimum calories per serving"),
  sort_by: z
    .enum([
      "newest",
      "oldest",
      "caloriesPerServingAscending",
      "caloriesPerServingDescending",
    ])
    .optional()
    .describe("Sort order for results"),
  must_have_images: z
    .boolean()
    .default(false)
    .describe("Only return recipes that have images"),
});

// ─── Tool definitions ─────────────────────────────────────────────────────────

export const FOOD_TOOLS: Tool[] = [
  {
    name: "search_foods",
    description:
      "Search the FatSecret food database by name or keyword. Returns a paginated list of foods with basic nutrition info (calories, protein, carbs, fat) per serving. Use this to find food IDs for use with get_food.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Food name or keyword to search for (e.g. 'banana', 'chicken breast')",
        },
        max_results: {
          type: "number",
          description: "Number of results to return (1–50, default 10)",
          default: 10,
        },
        page_number: {
          type: "number",
          description: "Zero-based page offset for pagination (default 0)",
          default: 0,
        },
        food_type: {
          type: "string",
          enum: ["generic", "brand", "all"],
          description: "Filter by food type",
          default: "all",
        },
        region: {
          type: "string",
          description: "ISO 3166-1 alpha-2 region code (e.g. 'US', 'GB')",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_food",
    description:
      "Get detailed nutrition information for a specific food by its FatSecret food ID. Returns all serving sizes and complete macronutrient + micronutrient data (calories, protein, carbs, fat, fiber, sodium, vitamins, etc.).",
    inputSchema: {
      type: "object" as const,
      properties: {
        food_id: {
          type: "string",
          description: "FatSecret food ID (obtained from search_foods)",
        },
        flag_default_serving: {
          type: "boolean",
          description: "Highlight the default/recommended serving size",
          default: true,
        },
      },
      required: ["food_id"],
    },
  },
  {
    name: "search_recipes",
    description:
      "Search FatSecret's recipe database. Returns recipes with nutrition info, ingredients, and images. Supports filtering by calorie range, prep time, and sorting options.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Recipe name or keyword (e.g. 'lemon chicken', 'pasta')",
        },
        max_results: {
          type: "number",
          description: "Number of results (1–50, default 10)",
          default: 10,
        },
        page_number: {
          type: "number",
          description: "Zero-based page offset",
          default: 0,
        },
        calories_max: {
          type: "number",
          description: "Maximum calories per serving",
        },
        calories_min: {
          type: "number",
          description: "Minimum calories per serving",
        },
        sort_by: {
          type: "string",
          enum: [
            "newest",
            "oldest",
            "caloriesPerServingAscending",
            "caloriesPerServingDescending",
          ],
          description: "Sort order",
        },
        must_have_images: {
          type: "boolean",
          description: "Only return recipes with images",
          default: false,
        },
      },
      required: [],
    },
  },
];

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function handleSearchFoods(
  client: FatSecretClient,
  args: unknown
): Promise<string> {
  const input = SearchFoodsSchema.parse(args);

  const params: Record<string, string> = {
    search_expression: input.query,
    max_results: String(input.max_results),
    page_number: String(input.page_number),
    flag_default_serving: "true",
  };

  if (input.food_type !== "all") {
    params.food_type = input.food_type;
  }
  if (input.region) {
    params.region = input.region;
  }

  const data = await client.publicPost<FoodSearchResult>(
    "foods.search",
    params
  );

  const { foods } = data;
  const total = parseInt(foods.total_results ?? "0", 10);
  const page = parseInt(foods.page_number ?? "0", 10);
  const maxR = parseInt(foods.max_results ?? "0", 10);

  if (total === 0 || !foods.food) {
    return `No foods found matching "${input.query}".`;
  }

  const foodList = toArray(foods.food);
  const lines: string[] = [
    `**Food Search: "${input.query}"**`,
    `Found ${total} results · Page ${page + 1} · Showing ${foodList.length}`,
    "",
  ];

  for (const food of foodList) {
    lines.push(`**${food.food_name}**${food.brand_name ? ` (${food.brand_name})` : ""}`);
    lines.push(`  ID: ${food.food_id} · Type: ${food.food_type}`);
    if (food.food_description) {
      lines.push(`  ${food.food_description}`);
    }
    lines.push(`  URL: ${food.food_url}`);
    lines.push("");
  }

  const hasMore = maxR > 0 && (page + 1) * maxR < total;
  if (hasMore) {
    lines.push(
      `→ More results available. Use page_number: ${page + 1} for next page.`
    );
  }

  return lines.join("\n");
}

export async function handleGetFood(
  client: FatSecretClient,
  args: unknown
): Promise<string> {
  const input = GetFoodSchema.parse(args);

  const params: Record<string, string> = {
    food_id: String(input.food_id),
    flag_default_serving: input.flag_default_serving ? "true" : "false",
  };

  const data = await client.publicPost<FoodDetail>("food.get", params);
  const { food } = data;

  const lines: string[] = [
    `## ${food.food_name}`,
    `**ID:** ${food.food_id} · **Type:** ${food.food_type}`,
  ];

  if (food.brand_name) {
    lines.push(`**Brand:** ${food.brand_name}`);
  }
  lines.push(`**URL:** ${food.food_url}`);

  if (food.food_sub_categories) {
    const cats = toArray(
      food.food_sub_categories.food_sub_category as string | string[]
    );
    if (cats.length > 0) lines.push(`**Categories:** ${cats.join(", ")}`);
  }

  lines.push("");
  lines.push("### Serving Sizes");

  const servings = toArray(food.servings.serving);
  for (const s of servings) {
    const isDefault = s.is_default === "1";
    lines.push(
      `\n**${s.serving_description}**${isDefault ? " ⭐ (default)" : ""}`
    );
    if (s.metric_serving_amount && s.metric_serving_unit) {
      lines.push(`  Metric: ${s.metric_serving_amount}${s.metric_serving_unit}`);
    }

    const macros = [
      `Calories: ${s.calories ?? "N/A"}kcal`,
      `Protein: ${s.protein ?? "N/A"}g`,
      `Carbs: ${s.carbohydrate ?? "N/A"}g`,
      `Fat: ${s.fat ?? "N/A"}g`,
    ].join(" · ");
    lines.push(`  ${macros}`);

    const extras: string[] = [];
    if (s.saturated_fat) extras.push(`Sat. Fat: ${s.saturated_fat}g`);
    if (s.trans_fat) extras.push(`Trans Fat: ${s.trans_fat}g`);
    if (s.cholesterol) extras.push(`Cholesterol: ${s.cholesterol}mg`);
    if (s.sodium) extras.push(`Sodium: ${s.sodium}mg`);
    if (s.potassium) extras.push(`Potassium: ${s.potassium}mg`);
    if (s.fiber) extras.push(`Fiber: ${s.fiber}g`);
    if (s.sugar) extras.push(`Sugar: ${s.sugar}g`);
    if (extras.length > 0) lines.push(`  ${extras.join(" · ")}`);

    const micros: string[] = [];
    if (s.vitamin_a) micros.push(`Vit A: ${s.vitamin_a}%`);
    if (s.vitamin_c) micros.push(`Vit C: ${s.vitamin_c}%`);
    if (s.vitamin_d) micros.push(`Vit D: ${s.vitamin_d}%`);
    if (s.calcium) micros.push(`Calcium: ${s.calcium}%`);
    if (s.iron) micros.push(`Iron: ${s.iron}%`);
    if (micros.length > 0) lines.push(`  ${micros.join(" · ")}`);
  }

  return lines.join("\n");
}

export async function handleSearchRecipes(
  client: FatSecretClient,
  args: unknown
): Promise<string> {
  const input = SearchRecipesSchema.parse(args);

  const params: Record<string, string> = {
    max_results: String(input.max_results),
    page_number: String(input.page_number),
  };

  if (input.query) params.search_expression = input.query;
  if (input.calories_max) params["calories.to"] = String(input.calories_max);
  if (input.calories_min) params["calories.from"] = String(input.calories_min);
  if (input.sort_by) params.sort_by = input.sort_by;
  if (input.must_have_images) params.must_have_images = "true";

  const data = await client.publicPost<RecipeSearchResult>(
    "recipes.search",
    params
  );

  const { recipes } = data;
  const total = parseInt(recipes.total_results ?? "0", 10);
  const page = parseInt(recipes.page_number ?? "0", 10);

  if (total === 0 || !recipes.recipe) {
    const queryStr = input.query ? `"${input.query}"` : "your criteria";
    return `No recipes found matching ${queryStr}.`;
  }

  const recipeList = toArray(recipes.recipe);
  const queryStr = input.query ? `"${input.query}"` : "all";
  const lines: string[] = [
    `**Recipe Search: ${queryStr}**`,
    `Found ${total} results · Page ${page + 1} · Showing ${recipeList.length}`,
    "",
  ];

  for (const recipe of recipeList) {
    lines.push(`**${recipe.recipe_name}** (ID: ${recipe.recipe_id})`);
    if (recipe.recipe_description) {
      lines.push(`  ${recipe.recipe_description}`);
    }

    const n = recipe.recipe_nutrition;
    lines.push(
      `  Per serving: ${n.calories}kcal · Protein: ${n.protein}g · ` +
        `Carbs: ${n.carbohydrate}g · Fat: ${n.fat}g`
    );

    if (recipe.recipe_types) {
      const types = toArray(recipe.recipe_types.recipe_type as string | string[]);
      if (types.length > 0) lines.push(`  Type: ${types.join(", ")}`);
    }

    if (recipe.recipe_ingredients) {
      const ingredients = toArray(
        recipe.recipe_ingredients.ingredient as string | string[]
      );
      if (ingredients.length > 0) {
        const preview = ingredients.slice(0, 5).join(", ");
        const more = ingredients.length > 5 ? ` +${ingredients.length - 5} more` : "";
        lines.push(`  Ingredients: ${preview}${more}`);
      }
    }

    if (recipe.recipe_image) {
      lines.push(`  Image: ${recipe.recipe_image}`);
    }

    lines.push("");
  }

  const hasMore = (page + 1) * parseInt(recipes.max_results, 10) < total;
  if (hasMore) {
    lines.push(
      `→ More results available. Use page_number: ${page + 1} for next page.`
    );
  }

  return lines.join("\n");
}
