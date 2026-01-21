import { db } from "./db";
import { users, picks, nhlTeamStatus, parlays, parlayLegs, type User, type InsertUser, type Pick, type InsertPick, type NhlTeamStatus, type Parlay, type InsertParlay, type ParlayLeg, type InsertParlayLeg } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";

// NHL team name mappings for normalization (maps various forms to canonical city name)
const NHL_TEAM_PATTERNS: Array<{ pattern: RegExp; city: string }> = [
  { pattern: /\b(ana|anaheim|ducks)\b/gi, city: 'ANA' },
  { pattern: /\b(ari|arizona|coyotes)\b/gi, city: 'ARI' },
  { pattern: /\b(bos|boston|bruins)\b/gi, city: 'BOS' },
  { pattern: /\b(buf|buffalo|sabres)\b/gi, city: 'BUF' },
  { pattern: /\b(cgy|calgary|flames)\b/gi, city: 'CGY' },
  { pattern: /\b(car|carolina|hurricanes)\b/gi, city: 'CAR' },
  { pattern: /\b(chi|chicago|blackhawks)\b/gi, city: 'CHI' },
  { pattern: /\b(col|colorado|avalanche)\b/gi, city: 'COL' },
  { pattern: /\b(cbj|columbus|blue\s*jackets)\b/gi, city: 'CBJ' },
  { pattern: /\b(dal|dallas|stars)\b/gi, city: 'DAL' },
  { pattern: /\b(det|detroit|red\s*wings)\b/gi, city: 'DET' },
  { pattern: /\b(edm|edmonton|oilers)\b/gi, city: 'EDM' },
  { pattern: /\b(fla|florida|panthers)\b/gi, city: 'FLA' },
  { pattern: /\b(la|lak|los\s*angeles|kings)\b/gi, city: 'LAK' },
  { pattern: /\b(min|minnesota|wild)\b/gi, city: 'MIN' },
  { pattern: /\b(mtl|montreal|canadiens)\b/gi, city: 'MTL' },
  { pattern: /\b(nsh|nashville|predators)\b/gi, city: 'NSH' },
  { pattern: /\b(njd|new\s*jersey|devils)\b/gi, city: 'NJD' },
  { pattern: /\b(nyi|ny\s*islanders|islanders)\b/gi, city: 'NYI' },
  { pattern: /\b(nyr|ny\s*rangers|rangers)\b/gi, city: 'NYR' },
  { pattern: /\b(ott|ottawa|senators)\b/gi, city: 'OTT' },
  { pattern: /\b(phi|philadelphia|flyers)\b/gi, city: 'PHI' },
  { pattern: /\b(pit|pittsburgh|penguins)\b/gi, city: 'PIT' },
  { pattern: /\b(sjs|sj|san\s*jose|sharks)\b/gi, city: 'SJS' },
  { pattern: /\b(sea|seattle|kraken)\b/gi, city: 'SEA' },
  { pattern: /\b(stl|st\.?\s*louis|blues)\b/gi, city: 'STL' },
  { pattern: /\b(tbl|tb|tampa\s*bay|lightning)\b/gi, city: 'TBL' },
  { pattern: /\b(tor|toronto|maple\s*leafs)\b/gi, city: 'TOR' },
  { pattern: /\b(uta|utah|mammoth)\b/gi, city: 'UTA' },
  { pattern: /\b(van|vancouver|canucks)\b/gi, city: 'VAN' },
  { pattern: /\b(vgk|vgs|vegas|golden\s*knights)\b/gi, city: 'VGK' },
  { pattern: /\b(wsh|washington|capitals)\b/gi, city: 'WSH' },
  { pattern: /\b(wpg|winnipeg|jets)\b/gi, city: 'WPG' },
];

// Extract team abbreviations from event string and return sorted pair
function extractTeams(event: string): string {
  const teams: string[] = [];
  for (const { pattern, city } of NHL_TEAM_PATTERNS) {
    if (pattern.test(event)) {
      if (!teams.includes(city)) {
        teams.push(city);
      }
      pattern.lastIndex = 0; // Reset regex state
    }
  }
  // Sort teams alphabetically to ensure consistent ordering regardless of @ vs vs format
  return teams.sort().join('-');
}

// Normalize event string for duplicate detection
function normalizeEvent(event: string): string {
  const teamPair = extractTeams(event);
  if (teamPair) {
    return teamPair; // e.g., "BOS-SEA" for any Boston vs Seattle game
  }
  // Fallback for non-NHL or unrecognized events
  return event.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Team performance stats from historical picks
export interface TeamPerformanceStats {
  teamCode: string;
  teamName: string;
  totalPicks: number;
  wins: number;
  losses: number;
  winRate: number;
  roi: number; // Return on investment percentage
  recentForm: string; // Last 5 results like "WWLWW"
  isHot: boolean; // 75%+ win rate with 2+ picks
  isCold: boolean; // 50% or less win rate with 2+ picks
}

// Confidence calibration - track historical win rate by confidence level
export interface ConfidenceCalibration {
  confidenceLevel: number;
  totalPicks: number;
  wins: number;
  losses: number;
  actualWinRate: number;  // Historical win rate for this confidence level
  expectedWinRate: number; // What we expected based on confidence
  calibrationFactor: number; // Ratio of actual to expected (>1 = underconfident, <1 = overconfident)
}

export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserStrategy(id: number, strategy: string): Promise<User>;
  updateUserBankroll(id: number, bankroll: number): Promise<User>;

  // Pick operations
  createPick(pick: InsertPick): Promise<Pick>;
  getPicks(userId: number): Promise<Pick[]>;

  // Team status operations
  getTeamStatus(teamCode: string): Promise<NhlTeamStatus | undefined>;
  getAllTeamStatuses(): Promise<NhlTeamStatus[]>;
  getBlacklistedTeams(): Promise<NhlTeamStatus[]>;
  updateTeamStatus(teamCode: string, teamName: string, result: 'won' | 'lost'): Promise<NhlTeamStatus>;
  
  // Performance analytics
  getTeamPerformanceStats(): Promise<TeamPerformanceStats[]>;
  getHotTeams(): Promise<TeamPerformanceStats[]>;
  getColdTeams(): Promise<TeamPerformanceStats[]>;
  getConfidenceCalibration(): Promise<ConfidenceCalibration[]>;
  
  // Parlay operations
  createParlay(parlay: InsertParlay, legs: InsertParlayLeg[]): Promise<{ parlay: Parlay; legs: ParlayLeg[] }>;
  getParlays(userId: number): Promise<Array<Parlay & { legs: ParlayLeg[] }>>;
  updateParlayStatus(parlayId: number, status: string): Promise<Parlay>;
  updateParlayLegStatus(legId: number, status: string): Promise<ParlayLeg>;
}

// Export team extraction function for use in routes
export function extractTeamCode(text: string): string | null {
  for (const { pattern, city } of NHL_TEAM_PATTERNS) {
    if (pattern.test(text)) {
      pattern.lastIndex = 0;
      return city;
    }
  }
  return null;
}

// Extract opponent team code from event text and prediction
// e.g., event "Wild @ Kraken", prediction "Kraken +1.5" -> opponent is "MIN" (Wild)
export function extractOpponentTeamCode(eventText: string, prediction: string): string | null {
  const backedTeam = extractTeamCode(prediction);
  if (!backedTeam) return null;
  
  // Find all teams mentioned in the event
  const foundTeams: string[] = [];
  for (const { pattern, city } of NHL_TEAM_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(eventText)) {
      foundTeams.push(city);
    }
  }
  
  // Return the team that's NOT the backed team
  for (const team of foundTeams) {
    if (team !== backedTeam) {
      return team;
    }
  }
  
  return null;
}

// Full team names for display
const TEAM_NAMES: Record<string, string> = {
  'ANA': 'Anaheim Ducks', 'ARI': 'Arizona Coyotes', 'BOS': 'Boston Bruins',
  'BUF': 'Buffalo Sabres', 'CGY': 'Calgary Flames', 'CAR': 'Carolina Hurricanes',
  'CHI': 'Chicago Blackhawks', 'COL': 'Colorado Avalanche', 'CBJ': 'Columbus Blue Jackets',
  'DAL': 'Dallas Stars', 'DET': 'Detroit Red Wings', 'EDM': 'Edmonton Oilers',
  'FLA': 'Florida Panthers', 'LAK': 'Los Angeles Kings', 'MIN': 'Minnesota Wild',
  'MTL': 'Montreal Canadiens', 'NSH': 'Nashville Predators', 'NJD': 'New Jersey Devils',
  'NYI': 'New York Islanders', 'NYR': 'New York Rangers', 'OTT': 'Ottawa Senators',
  'PHI': 'Philadelphia Flyers', 'PIT': 'Pittsburgh Penguins', 'SJS': 'San Jose Sharks',
  'SEA': 'Seattle Kraken', 'STL': 'St. Louis Blues', 'TBL': 'Tampa Bay Lightning',
  'TOR': 'Toronto Maple Leafs', 'UTA': 'Utah Hockey Club', 'VAN': 'Vancouver Canucks',
  'VGK': 'Vegas Golden Knights', 'WSH': 'Washington Capitals', 'WPG': 'Winnipeg Jets',
};

export function getTeamName(teamCode: string): string {
  return TEAM_NAMES[teamCode] || teamCode;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUserStrategy(id: number, strategy: string): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({ bettingStrategy: strategy })
      .where(eq(users.id, id))
      .returning();
    return updatedUser;
  }

  async updateUserBankroll(id: number, bankroll: number): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({ bankroll })
      .where(eq(users.id, id))
      .returning();
    return updatedUser;
  }

  async createPick(insertPick: InsertPick): Promise<Pick> {
    // Check for duplicates using normalized event names
    const normalizedNewEvent = normalizeEvent(insertPick.event);
    
    // Get all pending picks for this user and sport to check for duplicates
    const existingPicks = await db
      .select()
      .from(picks)
      .where(
        and(
          eq(picks.userId, insertPick.userId),
          eq(picks.sport, insertPick.sport)
        )
      );

    // Check if any existing PENDING pick matches when normalized
    const duplicate = existingPicks.find(p => 
      normalizeEvent(p.event) === normalizedNewEvent && p.status === 'pending'
    );

    if (duplicate) {
      console.log(`Duplicate detected: "${insertPick.event}" matches existing "${duplicate.event}"`);
      
      // Update confidence if new calibrated value is higher
      const newConf = insertPick.confidence || 5;
      const oldConf = duplicate.confidence || 5;
      if (newConf > oldConf) {
        console.log(`[Confidence Update] Upgrading confidence for ${duplicate.event}: ${oldConf} -> ${newConf}`);
        const [updated] = await db
          .update(picks)
          .set({ 
            confidence: newConf,
            stake: insertPick.stake,
            edge: insertPick.edge
          })
          .where(eq(picks.id, duplicate.id))
          .returning();
        return updated;
      }
      
      return duplicate;
    }

    const [pick] = await db.insert(picks).values(insertPick).returning();
    return pick;
  }

  async getPicks(userId: number): Promise<Pick[]> {
    return db
      .select()
      .from(picks)
      .where(eq(picks.userId, userId))
      .orderBy(desc(picks.createdAt));
  }

  async getTeamStatus(teamCode: string): Promise<NhlTeamStatus | undefined> {
    const [status] = await db.select().from(nhlTeamStatus).where(eq(nhlTeamStatus.teamCode, teamCode));
    return status;
  }

  async getAllTeamStatuses(): Promise<NhlTeamStatus[]> {
    return db.select().from(nhlTeamStatus).orderBy(desc(nhlTeamStatus.updatedAt));
  }

  async getBlacklistedTeams(): Promise<NhlTeamStatus[]> {
    return db.select().from(nhlTeamStatus).where(eq(nhlTeamStatus.status, 'blacklisted'));
  }

  async updateTeamStatus(teamCode: string, teamName: string, result: 'won' | 'lost'): Promise<NhlTeamStatus> {
    const existing = await this.getTeamStatus(teamCode);
    const now = new Date();
    
    if (!existing) {
      // Create new team status record
      const [created] = await db.insert(nhlTeamStatus).values({
        teamCode,
        teamName,
        lossStreak: result === 'lost' ? 1 : 0,
        winStreak: result === 'won' ? 1 : 0,
        status: 'clear',
        lastResultAt: now,
      }).returning();
      console.log(`[TeamFlag] Created ${teamCode}: ${result}`);
      return created;
    }
    
    // Update existing record
    let newLossStreak = result === 'lost' ? (existing.lossStreak || 0) + 1 : 0;
    let newWinStreak = result === 'won' ? (existing.winStreak || 0) + 1 : 0;
    
    // Start with existing status to preserve blacklist until cleared
    let newStatus: 'clear' | 'warn' | 'blacklisted' = existing.status as 'clear' | 'warn' | 'blacklisted' || 'clear';
    
    // Check for new blacklist/warn based on loss streak
    if (newLossStreak >= 3) {
      newStatus = 'blacklisted';
      console.log(`[TeamFlag] ${teamCode} BLACKLISTED (3 consecutive losses)`);
    } else if (newLossStreak >= 2) {
      newStatus = 'warn';
      console.log(`[TeamFlag] ${teamCode} WARNED (2 consecutive losses)`);
    } else if (result === 'won') {
      // Team won - check if we can clear blacklist (needs 2 consecutive wins)
      if (existing.status === 'blacklisted') {
        if (newWinStreak >= 2) {
          newStatus = 'clear';
          console.log(`[TeamFlag] ${teamCode} CLEARED from blacklist (2 consecutive wins)`);
        } else {
          // Stay blacklisted until 2 wins
          console.log(`[TeamFlag] ${teamCode} still blacklisted (${newWinStreak}/2 wins needed)`);
        }
      } else if (existing.status === 'warn') {
        // Single win clears warning status
        newStatus = 'clear';
        console.log(`[TeamFlag] ${teamCode} cleared from warn status`);
      }
    }
    
    const [updated] = await db.update(nhlTeamStatus)
      .set({
        lossStreak: newLossStreak,
        winStreak: newWinStreak,
        status: newStatus,
        lastResultAt: now,
        updatedAt: now,
      })
      .where(eq(nhlTeamStatus.teamCode, teamCode))
      .returning();
    
    return updated;
  }
  
  // Get team performance stats from historical picks
  async getTeamPerformanceStats(): Promise<TeamPerformanceStats[]> {
    // Get all completed NHL picks - order by createdAt ASC to process oldest first
    const allPicks = await db
      .select()
      .from(picks)
      .where(eq(picks.sport, 'NHL'));
    
    // Sort by createdAt ascending (oldest first) for correct recent form calculation
    allPicks.sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return aTime - bTime;
    });
    
    // Group by team and calculate stats
    const teamStats: Map<string, {
      wins: number;
      losses: number;
      stakes: number;
      profit: number;
      results: Array<'W' | 'L'>;
    }> = new Map();
    
    for (const pick of allPicks) {
      const status = pick.status?.toLowerCase();
      if (status !== 'won' && status !== 'lost' && status !== 'win' && status !== 'loss') continue;
      
      const teamCode = extractTeamCode(pick.prediction);
      if (!teamCode) continue;
      
      const isWin = status === 'won' || status === 'win';
      const stake = pick.stake || 0;
      
      // Calculate profit from odds
      let profit = 0;
      if (pick.odds) {
        const oddsNum = parseInt(pick.odds.replace(/[^\d-]/g, ''));
        if (isWin && !isNaN(oddsNum)) {
          if (oddsNum < 0) {
            profit = stake * (100 / Math.abs(oddsNum));
          } else {
            profit = stake * (oddsNum / 100);
          }
        } else if (!isWin) {
          profit = -stake;
        }
      } else if (!isWin) {
        profit = -stake;
      }
      
      if (!teamStats.has(teamCode)) {
        teamStats.set(teamCode, { wins: 0, losses: 0, stakes: 0, profit: 0, results: [] });
      }
      
      const stats = teamStats.get(teamCode)!;
      if (isWin) {
        stats.wins++;
        stats.results.push('W');
      } else {
        stats.losses++;
        stats.results.push('L');
      }
      stats.stakes += stake;
      stats.profit += profit;
    }
    
    // Convert to array
    const result: TeamPerformanceStats[] = [];
    for (const [teamCode, stats] of Array.from(teamStats.entries())) {
      const total = stats.wins + stats.losses;
      const winRate = total > 0 ? (stats.wins / total) * 100 : 0;
      const roi = stats.stakes > 0 ? (stats.profit / stats.stakes) * 100 : 0;
      // Get last 5 results (most recent at the end since we processed oldest first)
      const recentForm = stats.results.slice(-5).join('');
      
      result.push({
        teamCode,
        teamName: getTeamName(teamCode),
        totalPicks: total,
        wins: stats.wins,
        losses: stats.losses,
        winRate: Math.round(winRate * 10) / 10,
        roi: Math.round(roi * 10) / 10,
        recentForm,
        // HOT: 75%+ win rate with 2+ picks (proven track record)
        isHot: total >= 2 && winRate >= 75,
        // COLD: 0% win rate with 3+ picks (consistently losing) - stricter threshold
        isCold: total >= 3 && winRate === 0,
      });
    }
    
    // Sort by win rate descending
    result.sort((a, b) => b.winRate - a.winRate);
    return result;
  }
  
  async getHotTeams(): Promise<TeamPerformanceStats[]> {
    const stats = await this.getTeamPerformanceStats();
    return stats.filter(t => t.isHot);
  }
  
  async getColdTeams(): Promise<TeamPerformanceStats[]> {
    const stats = await this.getTeamPerformanceStats();
    return stats.filter(t => t.isCold);
  }
  
  async createParlay(insertParlay: InsertParlay, insertLegs: InsertParlayLeg[]): Promise<{ parlay: Parlay; legs: ParlayLeg[] }> {
    const [parlay] = await db.insert(parlays).values(insertParlay).returning();
    
    const legsWithParlayId = insertLegs.map(leg => ({
      ...leg,
      parlayId: parlay.id
    }));
    
    const legs = await db.insert(parlayLegs).values(legsWithParlayId).returning();
    
    return { parlay, legs };
  }
  
  async getParlays(userId: number): Promise<Array<Parlay & { legs: ParlayLeg[] }>> {
    const allParlays = await db
      .select()
      .from(parlays)
      .where(eq(parlays.userId, userId))
      .orderBy(desc(parlays.createdAt));
    
    const result: Array<Parlay & { legs: ParlayLeg[] }> = [];
    
    for (const parlay of allParlays) {
      const legs = await db
        .select()
        .from(parlayLegs)
        .where(eq(parlayLegs.parlayId, parlay.id));
      
      result.push({ ...parlay, legs });
    }
    
    return result;
  }
  
  async updateParlayStatus(parlayId: number, status: string): Promise<Parlay> {
    const [updated] = await db
      .update(parlays)
      .set({ status })
      .where(eq(parlays.id, parlayId))
      .returning();
    return updated;
  }
  
  async updateParlayLegStatus(legId: number, status: string): Promise<ParlayLeg> {
    const [updated] = await db
      .update(parlayLegs)
      .set({ status })
      .where(eq(parlayLegs.id, legId))
      .returning();
    return updated;
  }
  
  // Calculate confidence calibration from historical picks
  async getConfidenceCalibration(): Promise<ConfidenceCalibration[]> {
    const allPicks = await db
      .select()
      .from(picks)
      .where(eq(picks.sport, 'NHL'));
    
    // Group by confidence level
    const byConfidence: Map<number, { wins: number; losses: number }> = new Map();
    
    for (const pick of allPicks) {
      const status = pick.status?.toLowerCase();
      if (status !== 'won' && status !== 'lost' && status !== 'win' && status !== 'loss') continue;
      
      const conf = pick.confidence || 5;
      const existing = byConfidence.get(conf) || { wins: 0, losses: 0 };
      
      if (status === 'won' || status === 'win') {
        existing.wins++;
      } else {
        existing.losses++;
      }
      
      byConfidence.set(conf, existing);
    }
    
    // Map confidence to expected win rate (same as Kelly formula)
    // conf 5 = 52%, conf 6 = 55%, conf 7 = 58%, conf 8 = 61%, conf 9 = 64%, conf 10 = 67%
    const expectedWinRates: Record<number, number> = {
      1: 48, 2: 49, 3: 50, 4: 51, 5: 52, 6: 55, 7: 58, 8: 61, 9: 64, 10: 67
    };
    
    const result: ConfidenceCalibration[] = [];
    
    for (const [conf, stats] of Array.from(byConfidence.entries())) {
      const total = stats.wins + stats.losses;
      if (total < 2) continue; // Need minimum sample size
      
      const actualWinRate = (stats.wins / total) * 100;
      const expectedWinRate = expectedWinRates[conf] || 55;
      const calibrationFactor = actualWinRate / expectedWinRate;
      
      result.push({
        confidenceLevel: conf,
        totalPicks: total,
        wins: stats.wins,
        losses: stats.losses,
        actualWinRate: Math.round(actualWinRate * 10) / 10,
        expectedWinRate,
        calibrationFactor: Math.round(calibrationFactor * 100) / 100
      });
    }
    
    // Sort by confidence level
    result.sort((a, b) => a.confidenceLevel - b.confidenceLevel);
    return result;
  }
}

export const storage = new DatabaseStorage();
