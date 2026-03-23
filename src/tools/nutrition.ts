/**
 * Nutrition tools: get_daily_nutrition, get_month_of_statistics
 *
 * These endpoints aggregate diary data — they use OAuth 1.0 (3-legged).
 * Set FATSECRET_ACCESS_TOKEN and FATSECRET_ACCESS_TOKEN_SECRET in your environment.
 */

import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  FatSecretClient,
  FoodEntriesResult,
  MonthResult,
  dateToDayInt,
  dayIntToDate,
  toArray,
} from "../fatsecret.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const GetDailyNutritionSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe(
      "Date to get nutrition summary for (YYYY-MM-DD). Defaults to today."
    ),
});

export const GetMonthOfStatisticsSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional()
    .describe(
      "Any date within the month you want statistics for (YYYY-MM-DD). Defaults to current month."
    ),
});

// ─── Tool definitions ─────────────────────────────────────────────────────────

export const NUTRITION_TOOLS: Tool[] = [
  {
    name: "get_daily_nutrition",
    description:
      "Get a summary of total daily nutrition (calories, protein, carbohydrates, fat, and more) for a specific date by aggregating all diary entries. Requires OAuth 1.0 user credentials.",
    inputSchema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description:
            "Date to get nutrition summary for (YYYY-MM-DD). Defaults to today.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_month_of_statistics",
    description:
      "Get daily nutrition totals (calories, protein, carbs, fat) for every day in a given month that has diary entries. Useful for tracking trends and weekly/monthly analysis. Requires OAuth 1.0 user credentials.",
    inputSchema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description:
            "Any date within the target month (YYYY-MM-DD). Defaults to current month.",
        },
      },
      required: [],
    },
  },
];

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function handleGetDailyNutrition(
  client: FatSecretClient,
  args: unknown
): Promise<string> {
  const input = GetDailyNutritionSchema.parse(args);

  const dayInt = dateToDayInt(input.date);
  const displayDate = input.date || new Date().toISOString().split("T")[0];

  const data = await client.diaryPost<FoodEntriesResult>(
    "food_entries.get.v2",
    { date: String(dayInt) }
  );

  if (!data.food_entries) {
    return `No diary entries found for ${displayDate}. No nutrition data available.`;
  }

  const entries = toArray(data.food_entries.food_entry);

  if (entries.length === 0) {
    return `No diary entries found for ${displayDate}. No nutrition data available.`;
  }

  // Aggregate totals
  let totalCalories = 0;
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFat = 0;
  let totalFiber = 0;
  let totalSugar = 0;
  let totalSodium = 0;
  let totalSatFat = 0;

  // Per-meal breakdown
  const mealTotals: Record<
    string,
    { calories: number; protein: number; carbs: number; fat: number }
  > = {};

  for (const entry of entries) {
    const cals = parseFloat(entry.calories || "0");
    const protein = parseFloat(entry.protein || "0");
    const carbs = parseFloat(entry.carbohydrate || "0");
    const fat = parseFloat(entry.fat || "0");

    totalCalories += cals;
    totalProtein += protein;
    totalCarbs += carbs;
    totalFat += fat;
    totalFiber += parseFloat(entry.fiber || "0");
    totalSugar += parseFloat(entry.sugar || "0");
    totalSodium += parseFloat(entry.sodium || "0");
    totalSatFat += parseFloat(entry.saturated_fat || "0");

    const meal = entry.meal || "other";
    if (!mealTotals[meal]) {
      mealTotals[meal] = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    }
    mealTotals[meal].calories += cals;
    mealTotals[meal].protein += protein;
    mealTotals[meal].carbs += carbs;
    mealTotals[meal].fat += fat;
  }

  // Macronutrient percentages
  const totalMacroCalories =
    totalProtein * 4 + totalCarbs * 4 + totalFat * 9;
  const proteinPct =
    totalMacroCalories > 0
      ? ((totalProtein * 4) / totalMacroCalories) * 100
      : 0;
  const carbsPct =
    totalMacroCalories > 0
      ? ((totalCarbs * 4) / totalMacroCalories) * 100
      : 0;
  const fatPct =
    totalMacroCalories > 0
      ? ((totalFat * 9) / totalMacroCalories) * 100
      : 0;

  const lines: string[] = [
    `## Daily Nutrition Summary — ${displayDate}`,
    `*Based on ${entries.length} diary entr${entries.length === 1 ? "y" : "ies"}*`,
    "",
    `### Total Calories: **${totalCalories.toFixed(0)} kcal**`,
    "",
    "### Macronutrients",
    `| Nutrient | Amount | % of Calories |`,
    `|----------|--------|---------------|`,
    `| Protein  | ${totalProtein.toFixed(1)}g | ${proteinPct.toFixed(1)}% |`,
    `| Carbohydrates | ${totalCarbs.toFixed(1)}g | ${carbsPct.toFixed(1)}% |`,
    `| Fat      | ${totalFat.toFixed(1)}g | ${fatPct.toFixed(1)}% |`,
    "",
  ];

  if (totalFiber > 0 || totalSugar > 0 || totalSodium > 0 || totalSatFat > 0) {
    lines.push("### Additional Nutrients");
    if (totalFiber > 0) lines.push(`- Fiber: ${totalFiber.toFixed(1)}g`);
    if (totalSugar > 0) lines.push(`- Sugar: ${totalSugar.toFixed(1)}g`);
    if (totalSatFat > 0) lines.push(`- Saturated Fat: ${totalSatFat.toFixed(1)}g`);
    if (totalSodium > 0) lines.push(`- Sodium: ${totalSodium.toFixed(0)}mg`);
    lines.push("");
  }

  const mealOrder = ["breakfast", "lunch", "dinner", "other"];
  const hasMealData = Object.keys(mealTotals).length > 0;

  if (hasMealData) {
    lines.push("### Calories by Meal");
    for (const meal of mealOrder) {
      const mt = mealTotals[meal];
      if (!mt) continue;
      const mealLabel = meal.charAt(0).toUpperCase() + meal.slice(1);
      const pct = totalCalories > 0 ? ((mt.calories / totalCalories) * 100).toFixed(0) : "0";
      lines.push(
        `- **${mealLabel}:** ${mt.calories.toFixed(0)}kcal (${pct}%) · ` +
          `P: ${mt.protein.toFixed(1)}g · C: ${mt.carbs.toFixed(1)}g · F: ${mt.fat.toFixed(1)}g`
      );
    }
  }

  return lines.join("\n");
}

export async function handleGetMonthOfStatistics(
  client: FatSecretClient,
  args: unknown
): Promise<string> {
  const input = GetMonthOfStatisticsSchema.parse(args);

  const dayInt = dateToDayInt(input.date);
  const displayDate = input.date || new Date().toISOString().split("T")[0];
  const monthLabel = displayDate.substring(0, 7); // YYYY-MM

  const data = await client.diaryPost<MonthResult>(
    "food_entries.get_month.v2",
    { date: String(dayInt) }
  );

  const { month } = data;
  const fromDate = dayIntToDate(parseInt(month.from_date_int, 10));
  const toDate = dayIntToDate(parseInt(month.to_date_int, 10));

  if (!month.day) {
    return `No diary entries found for ${monthLabel} (${fromDate} – ${toDate}).`;
  }

  const days = toArray(month.day);

  if (days.length === 0) {
    return `No diary entries found for ${monthLabel} (${fromDate} – ${toDate}).`;
  }

  // Compute stats
  let totalCals = 0;
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFat = 0;
  let maxCals = 0;
  let minCals = Infinity;
  let maxDay = "";
  let minDay = "";

  for (const day of days) {
    const cals = parseFloat(day.calories || "0");
    totalCals += cals;
    totalProtein += parseFloat(day.protein || "0");
    totalCarbs += parseFloat(day.carbohydrate || "0");
    totalFat += parseFloat(day.fat || "0");

    const date = dayIntToDate(parseInt(day.date_int, 10));
    if (cals > maxCals) {
      maxCals = cals;
      maxDay = date;
    }
    if (cals < minCals) {
      minCals = cals;
      minDay = date;
    }
  }

  const avgCals = totalCals / days.length;
  const avgProtein = totalProtein / days.length;
  const avgCarbs = totalCarbs / days.length;
  const avgFat = totalFat / days.length;

  const lines: string[] = [
    `## Monthly Nutrition Statistics — ${monthLabel}`,
    `*Period: ${fromDate} – ${toDate} · ${days.length} days tracked*`,
    "",
    "### Averages (per logged day)",
    `| Metric | Daily Average |`,
    `|--------|---------------|`,
    `| Calories | ${avgCals.toFixed(0)} kcal |`,
    `| Protein | ${avgProtein.toFixed(1)}g |`,
    `| Carbs | ${avgCarbs.toFixed(1)}g |`,
    `| Fat | ${avgFat.toFixed(1)}g |`,
    "",
    "### Monthly Totals",
    `- Total Calories: ${totalCals.toFixed(0)} kcal`,
    `- Total Protein: ${totalProtein.toFixed(1)}g`,
    `- Total Carbs: ${totalCarbs.toFixed(1)}g`,
    `- Total Fat: ${totalFat.toFixed(1)}g`,
    "",
    "### Highlights",
    `- 🔺 Highest calorie day: **${maxDay}** (${maxCals.toFixed(0)} kcal)`,
    `- 🔻 Lowest calorie day: **${minDay}** (${minCals.toFixed(0)} kcal)`,
    "",
    "### Daily Breakdown",
    "| Date | Calories | Protein | Carbs | Fat |",
    "|------|----------|---------|-------|-----|",
  ];

  // Sort days chronologically
  const sortedDays = [...days].sort(
    (a, b) => parseInt(a.date_int) - parseInt(b.date_int)
  );

  for (const day of sortedDays) {
    const date = dayIntToDate(parseInt(day.date_int, 10));
    lines.push(
      `| ${date} | ${parseFloat(day.calories || "0").toFixed(0)} kcal | ` +
        `${parseFloat(day.protein || "0").toFixed(1)}g | ` +
        `${parseFloat(day.carbohydrate || "0").toFixed(1)}g | ` +
        `${parseFloat(day.fat || "0").toFixed(1)}g |`
    );
  }

  return lines.join("\n");
}
