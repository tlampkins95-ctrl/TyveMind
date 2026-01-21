import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === TABLE DEFINITIONS ===
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  bettingStrategy: text("betting_strategy").default(""), // User's betting strategy description
  bankroll: integer("bankroll").default(1000), // Starting bankroll
  createdAt: timestamp("created_at").defaultNow(),
});

export const picks = pgTable("picks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(), // Ideally references users.id, but kept simple for now
  sport: text("sport").notNull(),
  event: text("event").notNull(),
  prediction: text("prediction").notNull(),
  reasoning: text("reasoning").notNull(),
  confidence: integer("confidence").notNull(), // 1-10
  status: text("status").default("pending"), // pending, won, lost, void
  edge: text("edge"), // Calculated value over odds
  odds: text("odds"), // Current market odds
  scheduledTime: text("scheduled_time"), // Central Time display text
  scheduledAt: timestamp("scheduled_at"), // UTC timestamp for accurate Today/Upcoming sorting
  stake: integer("stake"), // Recommended bet amount at time of creation
  createdAt: timestamp("created_at").defaultNow(),
});

// Parlays - combines multiple picks into parlay bets
export const parlays = pgTable("parlays", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name"), // Optional name for the parlay
  combinedOdds: text("combined_odds"), // American odds string (e.g., "+450")
  combinedDecimalOdds: text("combined_decimal_odds"), // Decimal odds for calculations
  stake: integer("stake"), // Actual bet amount
  suggestedStake: integer("suggested_stake"), // Kelly-based recommendation
  potentialPayout: integer("potential_payout"), // Calculated payout
  status: text("status").default("pending"), // pending, won, lost, partial
  createdAt: timestamp("created_at").defaultNow(),
});

// Parlay Legs - links picks to parlays
export const parlayLegs = pgTable("parlay_legs", {
  id: serial("id").primaryKey(),
  parlayId: integer("parlay_id").notNull(), // References parlays.id
  pickId: integer("pick_id"), // References picks.id (optional for manual legs)
  sport: text("sport").notNull(),
  event: text("event").notNull(),
  prediction: text("prediction").notNull(),
  odds: text("odds").notNull(), // American odds for this leg
  decimalOdds: text("decimal_odds"), // Decimal odds for calculations
  confidence: integer("confidence"), // 1-10
  status: text("status").default("pending"), // pending, won, lost
});

// NHL Team Status - tracks consecutive wins/losses for team flagging
export const nhlTeamStatus = pgTable("nhl_team_status", {
  id: serial("id").primaryKey(),
  teamCode: text("team_code").notNull().unique(), // e.g., "ANA", "PHI", "CAR"
  teamName: text("team_name").notNull(), // e.g., "Anaheim Ducks"
  lossStreak: integer("loss_streak").default(0), // Consecutive losses
  winStreak: integer("win_streak").default(0), // Consecutive wins
  status: text("status").default("clear"), // "clear" | "warn" | "blacklisted"
  lastResultAt: timestamp("last_result_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// === BASE SCHEMAS ===
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertPickSchema = createInsertSchema(picks).omit({ id: true, createdAt: true });
export const insertParlaySchema = createInsertSchema(parlays).omit({ id: true, createdAt: true });
export const insertParlayLegSchema = createInsertSchema(parlayLegs).omit({ id: true });
export const insertNhlTeamStatusSchema = createInsertSchema(nhlTeamStatus).omit({ id: true, updatedAt: true });

// === EXPLICIT API CONTRACT TYPES ===
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Pick = typeof picks.$inferSelect;
export type InsertPick = z.infer<typeof insertPickSchema>;

export type Parlay = typeof parlays.$inferSelect;
export type InsertParlay = z.infer<typeof insertParlaySchema>;

export type ParlayLeg = typeof parlayLegs.$inferSelect;
export type InsertParlayLeg = z.infer<typeof insertParlayLegSchema>;

export type NhlTeamStatus = typeof nhlTeamStatus.$inferSelect;
export type InsertNhlTeamStatus = z.infer<typeof insertNhlTeamStatusSchema>;

export type CreateUserRequest = InsertUser;
export type UpdateStrategyRequest = { strategy: string };

export type GeneratePicksRequest = {
  sport?: string; // Optional filter
  context?: string; // Optional extra context like "games today"
};

export type PickResponse = Pick;
export type PicksListResponse = Pick[];

export * from "./models/chat";
export { sessions, authUsers } from "./models/auth";
