import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage, extractTeamCode, extractOpponentTeamCode, getTeamName } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import OpenAI from "openai";
import { registerChatRoutes } from "./replit_integrations/chat";
import { registerImageRoutes } from "./replit_integrations/image";
import { setupAuth, isAuthenticated, registerAuthRoutes } from "./replit_integrations/auth";
import { db } from "./db";
import { picks } from "@shared/schema";
import { eq } from "drizzle-orm";
import { fetchAllSportsData, fetchKambiNHLOdds, fetchKambiTennisOdds, filterFavorableTennisOdds, fetchTennisWinStreaks, refreshTennisWinStreaks, fetchNHLTeamWinStreaks, fetchNHLMatchupDetails, fetchCompletedNHLGames, fetchNHLSchedule, fetchNHLScheduleForValidation, fetchESPNTennis, fetchNHLTeamStrength, getTeamStrengthContext, fetchNHLInjuries, getInjuryContext, fetchNHLRestData, calculateRestAdvantage, fetchStartingGoalies, fetchNHLTeamStats, trackLineMovement, analyzeMatchupEdge, analyzeTravelFatigue, fetchScoringTrends, type KambiTennisOdds, type TeamRestData, type NHLTeamStats, type GoalieStart, type LineMovement, type ScoringTrend } from "./sportsData";
import { analyzeMatchup, analyzeMatches, type TennisMatchAnalysis } from "./tennisData";
import { fetchPlayerStats, fetchH2H, type TennisExplorerPlayer, type TennisExplorerH2H } from "./tennisExplorer";

// PERMANENT BAN LIST - Teams that should NEVER be selected for picks
const PERMANENTLY_BANNED_TEAMS: Record<string, string> = {
  'NYR': 'Rangers',
  'NJD': 'Devils',
};

// WEAK TEAMS - Bottom-tier teams to avoid UNLESS on a win streak
// These teams have poor records but can be picked if they're hot
const WEAK_TEAMS_CAUTION: Record<string, string> = {
  'ANA': 'Ducks',      // Rebuilding, but allow if on streak
  'SJS': 'Sharks',     // Bottom-tier team, but allow if on streak
  'CHI': 'Blackhawks', // Rebuilding, but allow if on streak
};

// Team name/abbreviation aliases for NHL validation
const nhlTeamAliases: Record<string, string[]> = {
  'rangers': ['new york', 'nyr', 'ny rangers'],
  'islanders': ['new york', 'nyi', 'ny islanders'],
  'kings': ['los angeles', 'lak', 'la kings'],
  'sharks': ['san jose', 'sjs'],
  'lightning': ['tampa bay', 'tbl', 'tampa'],
  'blues': ['st louis', 'stl', 'st. louis'],
  'blue jackets': ['columbus', 'cbj'],
  'golden knights': ['vegas', 'vgk', 'las vegas'],
  'kraken': ['seattle', 'sea'],
  'hurricanes': ['carolina', 'car'],
  'devils': ['new jersey', 'njd'],
  'penguins': ['pittsburgh', 'pit', 'pitt'],
  'capitals': ['washington', 'wsh', 'caps'],
  'flyers': ['philadelphia', 'phi', 'philly'],
  'blackhawks': ['chicago', 'chi'],
  'red wings': ['detroit', 'det'],
  'bruins': ['boston', 'bos'],
  'maple leafs': ['toronto', 'tor'],
  'canadiens': ['montreal', 'mtl'],
  'senators': ['ottawa', 'ott'],
  'sabres': ['buffalo', 'buf'],
  'panthers': ['florida', 'fla'],
  'ducks': ['anaheim', 'ana'],
  'avalanche': ['colorado', 'col'],
  'stars': ['dallas', 'dal'],
  'wild': ['minnesota', 'min'],
  'predators': ['nashville', 'nsh'],
  'jets': ['winnipeg', 'wpg'],
  'flames': ['calgary', 'cgy'],
  'oilers': ['edmonton', 'edm'],
  'canucks': ['vancouver', 'van'],
  'coyotes': ['arizona', 'ari'],
  'mammoth': ['utah', 'uta', 'utah hc', 'hockey club'],
};

// Map team names to abbreviations for rest data lookup
// NOTE: Mascots are more reliable than city names for shared-city teams
const teamNameToAbbrev: Record<string, string> = {
  // NY teams - ONLY use specific identifiers, never bare "new york"
  'rangers': 'NYR', 'new york rangers': 'NYR', 'ny rangers': 'NYR', 'nyr': 'NYR',
  'islanders': 'NYI', 'new york islanders': 'NYI', 'ny islanders': 'NYI', 'nyi': 'NYI',
  // LA teams - ONLY use specific identifiers, never bare "los angeles"  
  'kings': 'LAK', 'los angeles kings': 'LAK', 'la kings': 'LAK', 'lak': 'LAK',
  // Single-team cities (safe to use city names)
  'sharks': 'SJS', 'san jose': 'SJS', 'san jose sharks': 'SJS', 'sjs': 'SJS',
  'lightning': 'TBL', 'tampa bay': 'TBL', 'tampa bay lightning': 'TBL', 'tampa': 'TBL', 'tbl': 'TBL',
  'blues': 'STL', 'st louis': 'STL', 'st. louis': 'STL', 'st louis blues': 'STL', 'stl': 'STL',
  'blue jackets': 'CBJ', 'columbus': 'CBJ', 'columbus blue jackets': 'CBJ', 'cbj': 'CBJ',
  'golden knights': 'VGK', 'vegas': 'VGK', 'vegas golden knights': 'VGK', 'las vegas': 'VGK', 'vgk': 'VGK',
  'kraken': 'SEA', 'seattle': 'SEA', 'seattle kraken': 'SEA', 'sea': 'SEA',
  'hurricanes': 'CAR', 'carolina': 'CAR', 'carolina hurricanes': 'CAR', 'car': 'CAR',
  'devils': 'NJD', 'new jersey': 'NJD', 'new jersey devils': 'NJD', 'njd': 'NJD',
  'penguins': 'PIT', 'pittsburgh': 'PIT', 'pittsburgh penguins': 'PIT', 'pit': 'PIT',
  'capitals': 'WSH', 'washington': 'WSH', 'washington capitals': 'WSH', 'caps': 'WSH', 'wsh': 'WSH',
  'flyers': 'PHI', 'philadelphia': 'PHI', 'philadelphia flyers': 'PHI', 'phi': 'PHI',
  'blackhawks': 'CHI', 'chicago': 'CHI', 'chicago blackhawks': 'CHI', 'chi': 'CHI',
  'red wings': 'DET', 'detroit': 'DET', 'detroit red wings': 'DET', 'det': 'DET',
  'bruins': 'BOS', 'boston': 'BOS', 'boston bruins': 'BOS', 'bos': 'BOS',
  'maple leafs': 'TOR', 'toronto': 'TOR', 'toronto maple leafs': 'TOR', 'tor': 'TOR',
  'canadiens': 'MTL', 'montreal': 'MTL', 'montreal canadiens': 'MTL', 'mtl': 'MTL',
  'senators': 'OTT', 'ottawa': 'OTT', 'ottawa senators': 'OTT', 'ott': 'OTT',
  'sabres': 'BUF', 'buffalo': 'BUF', 'buffalo sabres': 'BUF', 'buf': 'BUF',
  'panthers': 'FLA', 'florida': 'FLA', 'florida panthers': 'FLA', 'fla': 'FLA',
  'ducks': 'ANA', 'anaheim': 'ANA', 'anaheim ducks': 'ANA', 'ana': 'ANA',
  'avalanche': 'COL', 'colorado': 'COL', 'colorado avalanche': 'COL', 'col': 'COL',
  'stars': 'DAL', 'dallas': 'DAL', 'dallas stars': 'DAL', 'dal': 'DAL',
  'wild': 'MIN', 'minnesota': 'MIN', 'minnesota wild': 'MIN', 'min': 'MIN',
  'predators': 'NSH', 'nashville': 'NSH', 'nashville predators': 'NSH', 'nsh': 'NSH',
  'jets': 'WPG', 'winnipeg': 'WPG', 'winnipeg jets': 'WPG', 'wpg': 'WPG',
  'flames': 'CGY', 'calgary': 'CGY', 'calgary flames': 'CGY', 'cgy': 'CGY',
  'oilers': 'EDM', 'edmonton': 'EDM', 'edmonton oilers': 'EDM', 'edm': 'EDM',
  'canucks': 'VAN', 'vancouver': 'VAN', 'vancouver canucks': 'VAN', 'van': 'VAN',
  'coyotes': 'ARI', 'arizona': 'ARI', 'arizona coyotes': 'ARI', 'ari': 'ARI',
  'utah': 'UTA', 'utah hockey club': 'UTA', 'utah hc': 'UTA', 'uta': 'UTA',
};

// Ambiguous city names that map to multiple teams - skip these
const AMBIGUOUS_CITIES = ['new york', 'los angeles', 'la', 'ny'];

// Get team abbreviation from team name
function getTeamAbbrev(teamName: string): string | null {
  const normalized = teamName.toLowerCase().trim();
  
  // Skip ambiguous city-only names
  if (AMBIGUOUS_CITIES.includes(normalized)) {
    return null;
  }
  
  // Direct lookup first (most reliable)
  if (teamNameToAbbrev[normalized]) {
    return teamNameToAbbrev[normalized];
  }
  
  // Check if it's already a 3-letter abbreviation
  if (/^[A-Z]{3}$/i.test(teamName) && teamName.length === 3) {
    return teamName.toUpperCase();
  }
  
  // Check if any mascot name is contained (prefer mascots over cities)
  const mascots = ['rangers', 'islanders', 'kings', 'sharks', 'lightning', 'blues', 
    'blue jackets', 'golden knights', 'kraken', 'hurricanes', 'devils', 'penguins',
    'capitals', 'flyers', 'blackhawks', 'red wings', 'bruins', 'maple leafs',
    'canadiens', 'senators', 'sabres', 'panthers', 'ducks', 'avalanche', 
    'stars', 'wild', 'predators', 'jets', 'flames', 'oilers', 'canucks', 'coyotes'];
  
  for (const mascot of mascots) {
    if (normalized.includes(mascot)) {
      return teamNameToAbbrev[mascot] || null;
    }
  }
  
  // Check for unambiguous city names (excluding shared cities)
  for (const [key, abbrev] of Object.entries(teamNameToAbbrev)) {
    if (key.length >= 4 && !AMBIGUOUS_CITIES.some(c => key.includes(c))) {
      if (normalized.includes(key)) {
        return abbrev;
      }
    }
  }
  
  return null;
}

// Validate that an AI-generated pick matches a real scheduled game
// STRICT VALIDATION: Rejects picks when schedule can't be verified
// Returns startTimeUTC for accurate Today/Upcoming classification
async function validatePickAgainstSchedule(sport: string, eventText: string): Promise<{ valid: boolean; reason: string; startTimeUTC?: string; scheduledTime?: string }> {
  const normalizedEvent = eventText.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  
  // Extract UNIQUE team mascot from text - returns null if ambiguous
  const extractTeamMascot = (text: string): string | null => {
    const normalizedText = text.toLowerCase();
    for (const [mascot, aliases] of Object.entries(nhlTeamAliases)) {
      // Check mascot directly
      if (normalizedText.includes(mascot)) {
        return mascot;
      }
      // Check specific aliases (but NOT just "new york" which is ambiguous)
      for (const alias of aliases) {
        // Skip ambiguous city-only aliases for teams that share cities
        if (alias === 'new york' || alias === 'los angeles') continue;
        if (normalizedText.includes(alias)) {
          return mascot;
        }
      }
    }
    return null;
  };
  
  // Extract both teams from "Away @ Home" or "Away vs Home" format
  const extractMatchupTeams = (text: string): [string | null, string | null] => {
    const normalized = text.toLowerCase();
    // Split by @ or vs
    const parts = normalized.split(/\s+[@vs]+\s+/);
    if (parts.length >= 2) {
      return [extractTeamMascot(parts[0]), extractTeamMascot(parts[1])];
    }
    // Fallback: try to find any two teams
    const foundTeams: string[] = [];
    for (const [mascot, aliases] of Object.entries(nhlTeamAliases)) {
      if (normalized.includes(mascot)) {
        foundTeams.push(mascot);
        continue;
      }
      for (const alias of aliases) {
        if (alias === 'new york' || alias === 'los angeles') continue;
        if (normalized.includes(alias)) {
          foundTeams.push(mascot);
          break;
        }
      }
    }
    return [foundTeams[0] || null, foundTeams[1] || null];
  };
  
  if (sport === 'NHL') {
    try {
      // Fetch BOTH today AND tomorrow's schedule for complete validation
      const schedule = await fetchNHLScheduleForValidation();
      
      if (schedule.length === 0) {
        console.log(`[Validation] REJECTED: No NHL games found in schedule - cannot validate`);
        return { valid: false, reason: 'Unable to fetch NHL schedule for validation' };
      }
      
      const [pickTeam1, pickTeam2] = extractMatchupTeams(eventText);
      
      if (!pickTeam1 || !pickTeam2) {
        console.log(`[Validation] REJECTED: Could not extract 2 teams from: "${eventText}" (got: ${pickTeam1}, ${pickTeam2})`);
        return { valid: false, reason: `Could not identify two teams in pick` };
      }
      
      // Check if this EXACT matchup exists in today OR tomorrow's schedule
      for (const game of schedule) {
        const gameHome = extractTeamMascot(game.homeTeam || '');
        const gameAway = extractTeamMascot(game.awayTeam || '');
        
        if (!gameHome || !gameAway) continue;
        
        // Match: pick teams must match game's home AND away (in either order for flexibility)
        const matchesExact = 
          (pickTeam1 === gameAway && pickTeam2 === gameHome) ||
          (pickTeam1 === gameHome && pickTeam2 === gameAway);
          
        if (matchesExact) {
          console.log(`[Validation] VALID NHL pick: "${eventText}" matches "${game.awayTeam} @ ${game.homeTeam}" on ${game.date}`);
          return { 
            valid: true, 
            reason: `Matches scheduled game on ${game.date}`,
            startTimeUTC: game.startTimeUTC,
            scheduledTime: `${game.date} - ${game.time}`
          };
        }
      }
      
      console.log(`[Validation] REJECTED: "${eventText}" - no matching game in NHL schedule`);
      console.log(`[Validation] Pick teams: ${pickTeam1} vs ${pickTeam2}`);
      console.log(`[Validation] Available matchups: ${schedule.map(g => `${extractTeamMascot(g.awayTeam || '')} @ ${extractTeamMascot(g.homeTeam || '')}`).join(', ')}`);
      return { valid: false, reason: `No matching NHL game found. Teams: ${pickTeam1} vs ${pickTeam2}` };
      
    } catch (error) {
      // STRICT: Reject picks when schedule cannot be verified
      console.error('[Validation] REJECTED: NHL schedule check failed:', error);
      return { valid: false, reason: 'Schedule verification failed - rejecting pick for safety' };
    }
  }
  
  if (sport === 'Tennis') {
    try {
      // Fetch both ESPN schedule for validation AND Kambi odds for startTime
      const [schedule, kambiOdds] = await Promise.all([
        fetchESPNTennis(),
        fetchKambiTennisOdds()
      ]);
      
      if (schedule.length === 0) {
        console.log(`[Validation] REJECTED: No Tennis matches found in schedule - cannot validate`);
        return { valid: false, reason: 'Unable to fetch Tennis schedule for validation' };
      }
      
      // For tennis, check if both player names appear in any scheduled match
      for (const match of schedule) {
        const homePlayer = (match.homeTeam || '').toLowerCase();
        const awayPlayer = (match.awayTeam || '').toLowerCase();
        
        // Extract last names for comparison (tennis picks often use last names only)
        const homeLastName = homePlayer.split(' ').pop() || '';
        const awayLastName = awayPlayer.split(' ').pop() || '';
        
        // Check if both players mentioned in pick are in this match
        const pickHasHome = normalizedEvent.includes(homeLastName) || normalizedEvent.includes(homePlayer);
        const pickHasAway = normalizedEvent.includes(awayLastName) || normalizedEvent.includes(awayPlayer);
        
        if (pickHasHome && pickHasAway) {
          // Try to find matching Kambi odds to get startTime
          let startTimeUTC: string | undefined;
          let scheduledTime: string | undefined;
          
          for (const odds of kambiOdds) {
            const oddsP1 = odds.player1.toLowerCase();
            const oddsP2 = odds.player2.toLowerCase();
            const oddsP1Last = oddsP1.split(' ').pop() || '';
            const oddsP2Last = oddsP2.split(' ').pop() || '';
            
            // Match by player last names
            const matchesKambi = 
              (normalizedEvent.includes(oddsP1Last) && normalizedEvent.includes(oddsP2Last)) ||
              (normalizedEvent.includes(oddsP1) || normalizedEvent.includes(oddsP2));
            
            if (matchesKambi && odds.startTime) {
              startTimeUTC = odds.startTime;
              const startDate = new Date(odds.startTime);
              scheduledTime = `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })} CT`;
              break;
            }
          }
          
          // FALLBACK: If no Kambi match found, use ESPN's actual match time from startTimeUTC
          if (!startTimeUTC) {
            // ESPN SportMatch now includes startTimeUTC from competition.date
            if (match.startTimeUTC) {
              startTimeUTC = match.startTimeUTC;
              const matchDate = new Date(match.startTimeUTC);
              const now = new Date();
              const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
              const matchDateOnly = new Date(matchDate.getFullYear(), matchDate.getMonth(), matchDate.getDate());
              
              const isToday = matchDateOnly.getTime() === today.getTime();
              const dateLabel = isToday ? 'Today' : matchDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              const timeLabel = matchDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
              scheduledTime = `${dateLabel} - ${timeLabel} CT`;
            } else {
              // Final fallback if no startTimeUTC - use match.time display string
              const now = new Date();
              const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
              const noonToday = new Date(today);
              noonToday.setHours(18, 0, 0, 0); // Noon CT = 18:00 UTC
              startTimeUTC = noonToday.toISOString();
              scheduledTime = match.time ? `Today - ${match.time}` : 'Today - Time TBD';
            }
            console.log(`[Validation] Using ESPN fallback scheduledAt for tennis pick: ${startTimeUTC}`);
          }
          
          console.log(`[Validation] VALID Tennis pick: "${eventText}" matches "${homePlayer} vs ${awayPlayer}" at ${scheduledTime}`);
          return { 
            valid: true, 
            reason: 'Matches scheduled match',
            startTimeUTC,
            scheduledTime
          };
        }
      }
      
      // STRICT: Reject picks that don't match any scheduled match
      console.log(`[Validation] REJECTED: "${eventText}" - no matching Tennis match in schedule`);
      console.log(`[Validation] Available matches: ${schedule.slice(0, 10).map(m => `${m.homeTeam} vs ${m.awayTeam}`).join(', ')}...`);
      return { valid: false, reason: 'No matching Tennis match found in schedule' };
      
    } catch (error) {
      // STRICT: Reject picks when schedule cannot be verified
      console.error('[Validation] REJECTED: Tennis schedule check failed:', error);
      return { valid: false, reason: 'Schedule verification failed - rejecting pick for safety' };
    }
  }
  
  // For other sports, reject by default (we only support NHL and Tennis)
  console.log(`[Validation] REJECTED: Unsupported sport "${sport}"`);
  return { valid: false, reason: `Sport "${sport}" is not validated` };
}

// OpenAI client initialization
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Setup authentication FIRST
  await setupAuth(app);
  registerAuthRoutes(app);

  // Register integration routes
  registerChatRoutes(app);
  registerImageRoutes(app);

  // Helper to ensure a demo user exists for MVP
  async function ensureDemoUser() {
    let user = await storage.getUserByUsername("demo_user");
    if (!user) {
      try {
        user = await storage.createUser({
          username: "demo_user",
          bettingStrategy: "Focus on WTA, ATP, and NHL. NHL: Look for +1.5 puckline spreads with a minimum of -200 odds (e.g., -250 is allowed, -150 is NOT) (Source: Potawatomi Sportsbook). Tennis: Use espn.com to find matches, provide specific players on win streaks with a clear edge (Source: TennisExplorer/ESPN).",
          bankroll: 1000,
        });
      } catch (error) {
        // Handle race condition where user might be created by another request
        user = await storage.getUserByUsername("demo_user");
        if (!user) {
           throw error;
        }
      }
    }
    return user;
  }

  // --- User Routes ---
  
  // Public route returns user without strategy (for bankroll display)
  app.get(api.users.get.path, async (req, res) => {
    const user = await ensureDemoUser();
    // Check if user is authenticated - if so, return full data including strategy
    if (req.isAuthenticated && req.isAuthenticated()) {
      res.json(user);
    } else {
      // For public access, hide the strategy
      const { bettingStrategy, ...publicUser } = user;
      res.json(publicUser);
    }
  });

  // Protected: Only authenticated users can update strategy
  app.post(api.users.updateStrategy.path, isAuthenticated, async (req, res) => {
    try {
      const { strategy } = api.users.updateStrategy.input.parse(req.body);
      const user = await ensureDemoUser();
      const updatedUser = await storage.updateUserStrategy(user.id, strategy);
      res.json(updatedUser);
    } catch (error) {
       if (error instanceof z.ZodError) {
        res.status(400).json({ message: error.errors[0].message });
      } else {
        res.status(500).json({ message: "Internal Server Error" });
      }
    }
  });

  // --- Pick Routes ---
  
  app.delete("/api/picks/clear", async (_req, res) => {
    const user = await ensureDemoUser();
    // In DatabaseStorage, we need to add a clearPicks method or do it here
    await db.delete(picks).where(eq(picks.userId, user.id));
    res.json({ message: "Picks cleared" });
  });

  app.get(api.picks.list.path, async (_req, res) => {
    const user = await ensureDemoUser();
    const userPicks = await storage.getPicks(user.id);
    res.json(userPicks);
  });

  // Calculate bet size based on confidence (1-3% of bankroll)
  function calculateBetSize(bankroll: number, confidence: number): number {
    const basePercent = 0.01; // 1% base
    const confidenceMultiplier = (confidence - 5) * 0.005; // +0.5% per confidence above 5
    const percent = Math.max(0.01, Math.min(0.03, basePercent + confidenceMultiplier));
    return Math.round(bankroll * percent);
  }

  // Calculate profit from American odds
  function calculateProfit(stake: number, americanOdds: number): number {
    if (americanOdds < 0) {
      return stake * (100 / Math.abs(americanOdds));
    } else {
      return stake * (americanOdds / 100);
    }
  }

  // Update pick status (won/lost) and adjust bankroll - PROTECTED: owner only
  app.patch("/api/picks/:id/status", isAuthenticated, async (req: any, res) => {
    try {
      const pickId = parseInt(req.params.id);
      const { status } = req.body;
      
      if (!['won', 'lost', 'pending'].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      
      // Get the pick details
      const [pick] = await db.select().from(picks).where(eq(picks.id, pickId));
      if (!pick) {
        return res.status(404).json({ message: "Pick not found" });
      }
      
      // Get user's current bankroll
      const user = await ensureDemoUser();
      let newBankroll = user.bankroll || 1000;
      const odds = parseInt(pick.odds?.replace(/[^\d-]/g, '') || '0');
      // Use stored stake if available, otherwise calculate (for legacy picks)
      const betSize = pick.stake || calculateBetSize(newBankroll, pick.confidence);
      
      // Adjust bankroll based on result
      if (status === 'won' && pick.status !== 'won') {
        const profit = calculateProfit(betSize, odds);
        newBankroll = Math.round(newBankroll + profit);
      } else if (status === 'lost' && pick.status !== 'lost') {
        newBankroll = Math.round(newBankroll - betSize);
      }
      // Push = no change
      
      // Update pick status
      await db.update(picks).set({ status }).where(eq(picks.id, pickId));
      
      // Update user bankroll
      await storage.updateUserBankroll(user.id, newBankroll);
      
      // Update team flag for NHL picks
      if (pick.sport === 'NHL' && (status === 'won' || status === 'lost')) {
        const teamCode = extractTeamCode(pick.prediction);
        if (teamCode) {
          await storage.updateTeamStatus(teamCode, getTeamName(teamCode), status as 'won' | 'lost');
        }
      }
      
      res.json({ message: "Status updated", status, betSize, newBankroll });
    } catch (error) {
      console.error("Error updating pick status:", error);
      res.status(500).json({ message: "Failed to update pick status" });
    }
  });

  // Get NHL team flags (warn/blacklisted/permanently banned teams)
  app.get("/api/teams/flags", async (_req, res) => {
    try {
      const allFlags = await storage.getAllTeamStatuses();
      const blacklisted = allFlags.filter(t => t.status === 'blacklisted');
      const warned = allFlags.filter(t => t.status === 'warn');
      const permanentlyBanned = Object.entries(PERMANENTLY_BANNED_TEAMS).map(([code, name]) => ({
        teamCode: code,
        teamName: name,
        status: 'permanently_banned' as const,
      }));
      const weakTeams = Object.entries(WEAK_TEAMS_CAUTION).map(([code, name]) => ({
        teamCode: code,
        teamName: name,
        status: 'weak_team' as const,
      }));
      res.json({ blacklisted, warned, permanentlyBanned, weakTeams, all: allFlags });
    } catch (error) {
      console.error("Error fetching team flags:", error);
      res.status(500).json({ message: "Failed to fetch team flags" });
    }
  });
  
  // Team performance analytics from historical picks
  app.get("/api/teams/performance", async (_req, res) => {
    try {
      const stats = await storage.getTeamPerformanceStats();
      const hotTeams = stats.filter(t => t.isHot);
      const coldTeams = stats.filter(t => t.isCold);
      
      res.json({
        all: stats,
        hotTeams,
        coldTeams,
        summary: {
          totalTeamsTracked: stats.length,
          hotTeamsCount: hotTeams.length,
          coldTeamsCount: coldTeams.length,
        }
      });
    } catch (error) {
      console.error("Error fetching team performance:", error);
      res.status(500).json({ message: "Failed to fetch team performance" });
    }
  });

  // Live sports data from ESPN and NHL APIs
  app.get("/api/sports/schedule", async (_req, res) => {
    try {
      const data = await fetchAllSportsData();
      res.json(data);
    } catch (error) {
      console.error("Error fetching sports schedule:", error);
      res.status(500).json({ message: "Failed to fetch sports schedule" });
    }
  });

  // Tennis win streaks from TennisExplorer
  app.get("/api/sports/win-streaks", async (_req, res) => {
    try {
      const streaks = await fetchTennisWinStreaks();
      res.json(streaks);
    } catch (error) {
      console.error("Error fetching tennis win streaks:", error);
      res.status(500).json({ message: "Failed to fetch win streaks" });
    }
  });

  // NHL team win streaks
  app.get("/api/sports/nhl-streaks", async (_req, res) => {
    try {
      const streaks = await fetchNHLTeamWinStreaks();
      res.json(streaks);
    } catch (error) {
      console.error("Error fetching NHL team streaks:", error);
      res.status(500).json({ message: "Failed to fetch NHL team streaks" });
    }
  });
  
  // NHL injuries from Hockey Reference
  app.get("/api/sports/nhl-injuries", async (_req, res) => {
    try {
      const injuries = await fetchNHLInjuries();
      // Group by team
      const byTeam: Record<string, typeof injuries> = {};
      for (const inj of injuries) {
        if (!byTeam[inj.teamAbbrev]) byTeam[inj.teamAbbrev] = [];
        byTeam[inj.teamAbbrev].push(inj);
      }
      res.json({
        total: injuries.length,
        byTeam,
        injuries: injuries.slice(0, 50), // Return first 50
      });
    } catch (error) {
      console.error("Error fetching NHL injuries:", error);
      res.status(500).json({ message: "Failed to fetch NHL injuries" });
    }
  });

  // NHL Rest/Fatigue Data - shows days since last game for each team
  app.get("/api/sports/nhl-rest", async (_req, res) => {
    try {
      const restData = await fetchNHLRestData();
      const schedule = await fetchNHLSchedule();
      
      // Calculate rest advantage for today's matchups
      const matchups: any[] = [];
      for (const game of schedule) {
        // Extract team codes from game
        const homeCode = getTeamAbbrev(game.homeTeam);
        const awayCode = getTeamAbbrev(game.awayTeam);
        
        if (homeCode && awayCode) {
          const advantage = calculateRestAdvantage(homeCode, awayCode, restData);
          matchups.push({
            event: game.event,
            homeTeamName: game.homeTeam,
            awayTeamName: game.awayTeam,
            time: game.time,
            homeTeamRest: advantage.homeTeam,
            awayTeamRest: advantage.awayTeam,
            advantage: advantage.advantage,
            advantageReason: advantage.advantageReason,
            fatigueWarning: advantage.fatigueWarning
          });
        }
      }
      
      // Convert Map to array for JSON
      const allTeams: any[] = [];
      restData.forEach((data, code) => {
        allTeams.push(data);
      });
      
      res.json({
        todayMatchups: matchups,
        allTeams: allTeams.sort((a, b) => a.daysSinceLastGame - b.daysSinceLastGame),
        backToBackTeams: allTeams.filter(t => t.isBackToBack).map(t => t.teamCode),
        restedTeams: allTeams.filter(t => t.isRested).map(t => t.teamCode)
      });
    } catch (error) {
      console.error("Error fetching NHL rest data:", error);
      res.status(500).json({ message: "Failed to fetch NHL rest data" });
    }
  });

  // NHL Starting Goalies - scraped from Daily Faceoff
  app.get("/api/sports/nhl-goalies", async (_req, res) => {
    try {
      const goalies = await fetchStartingGoalies();
      res.json({
        count: goalies.length,
        goalies,
        confirmed: goalies.filter(g => g.confirmed),
        projected: goalies.filter(g => !g.confirmed)
      });
    } catch (error) {
      console.error("Error fetching starting goalies:", error);
      res.status(500).json({ message: "Failed to fetch starting goalies" });
    }
  });

  // NHL Team Stats - home/away splits, special teams, scoring
  app.get("/api/sports/nhl-stats", async (_req, res) => {
    try {
      const stats = await fetchNHLTeamStats();
      const statsArray: NHLTeamStats[] = [];
      stats.forEach((s) => statsArray.push(s));
      
      // Sort by points
      statsArray.sort((a, b) => b.points - a.points);
      
      // Identify top special teams
      const topPP = [...statsArray].sort((a, b) => b.powerPlayPct - a.powerPlayPct).slice(0, 5);
      const topPK = [...statsArray].sort((a, b) => b.penaltyKillPct - a.penaltyKillPct).slice(0, 5);
      const bestHome = [...statsArray].sort((a, b) => {
        const aWinPct = a.homeWins / (a.homeWins + a.homeLosses + a.homeOtLosses);
        const bWinPct = b.homeWins / (b.homeWins + b.homeLosses + b.homeOtLosses);
        return bWinPct - aWinPct;
      }).slice(0, 5);
      const bestRoad = [...statsArray].sort((a, b) => {
        const aWinPct = a.awayWins / (a.awayWins + a.awayLosses + a.awayOtLosses);
        const bWinPct = b.awayWins / (b.awayWins + b.awayLosses + b.awayOtLosses);
        return bWinPct - aWinPct;
      }).slice(0, 5);
      
      res.json({
        teams: statsArray,
        leaders: {
          powerPlay: topPP.map(t => ({ team: t.teamCode, pct: t.powerPlayPct })),
          penaltyKill: topPK.map(t => ({ team: t.teamCode, pct: t.penaltyKillPct })),
          homeRecord: bestHome.map(t => ({ team: t.teamCode, record: `${t.homeWins}-${t.homeLosses}-${t.homeOtLosses}` })),
          roadRecord: bestRoad.map(t => ({ team: t.teamCode, record: `${t.awayWins}-${t.awayLosses}-${t.awayOtLosses}` }))
        }
      });
    } catch (error) {
      console.error("Error fetching NHL team stats:", error);
      res.status(500).json({ message: "Failed to fetch NHL team stats" });
    }
  });

  // NHL Comprehensive Edge Analysis for a matchup
  app.get("/api/sports/nhl-edge/:homeTeam/:awayTeam", async (req, res) => {
    try {
      const { homeTeam, awayTeam } = req.params;
      const homeCode = getTeamAbbrev(homeTeam) || homeTeam.toUpperCase();
      const awayCode = getTeamAbbrev(awayTeam) || awayTeam.toUpperCase();
      
      const [kambiOdds, restData] = await Promise.all([
        fetchKambiNHLOdds(),
        fetchNHLRestData()
      ]);
      
      const analysis = await analyzeMatchupEdge(homeCode, awayCode, kambiOdds, restData);
      res.json(analysis);
    } catch (error) {
      console.error("Error analyzing matchup edge:", error);
      res.status(500).json({ message: "Failed to analyze matchup edge" });
    }
  });

  // NHL Scoring Trends
  app.get("/api/sports/nhl-trends", async (_req, res) => {
    try {
      const stats = await fetchNHLTeamStats();
      const teamCodes = Array.from(stats.keys());
      const trends = await fetchScoringTrends(teamCodes);
      
      const trendsArray: ScoringTrend[] = [];
      trends.forEach((t) => trendsArray.push(t));
      
      // Identify hot offense and strong defense
      const hotOffense = trendsArray.filter(t => t.offenseTrend === 'hot');
      const coldOffense = trendsArray.filter(t => t.offenseTrend === 'cold');
      const strongDefense = trendsArray.filter(t => t.defenseTrend === 'strong');
      const weakDefense = trendsArray.filter(t => t.defenseTrend === 'weak');
      
      res.json({
        trends: trendsArray,
        hotOffense: hotOffense.map(t => t.teamCode),
        coldOffense: coldOffense.map(t => t.teamCode),
        strongDefense: strongDefense.map(t => t.teamCode),
        weakDefense: weakDefense.map(t => t.teamCode)
      });
    } catch (error) {
      console.error("Error fetching scoring trends:", error);
      res.status(500).json({ message: "Failed to fetch scoring trends" });
    }
  });

  // NHL Line Movement Tracking
  app.get("/api/sports/nhl-line-movement", async (_req, res) => {
    try {
      const kambiOdds = await fetchKambiNHLOdds();
      const movements = await trackLineMovement(kambiOdds);
      
      const significantMoves = movements.filter(m => m.significantMovement);
      
      res.json({
        movements,
        significantMoves,
        sharpAction: significantMoves.map(m => ({
          event: m.event,
          direction: m.movementDirection,
          movement: m.homeMovement
        }))
      });
    } catch (error) {
      console.error("Error tracking line movement:", error);
      res.status(500).json({ message: "Failed to track line movement" });
    }
  });

  // Kambi/Potawatomi real-time NHL odds
  app.get("/api/odds/nhl", async (_req, res) => {
    try {
      const odds = await fetchKambiNHLOdds();
      res.json(odds);
    } catch (error) {
      console.error("Error fetching Kambi odds:", error);
      res.status(500).json({ message: "Failed to fetch odds" });
    }
  });

  // Kambi/Potawatomi real-time Tennis odds (WTA + ATP)
  app.get("/api/odds/tennis", async (_req, res) => {
    try {
      const allOdds = await fetchKambiTennisOdds();
      // Also return filtered favorable odds (-200 to -300 range)
      const favorableOdds = filterFavorableTennisOdds(allOdds);
      res.json({ 
        all: allOdds, 
        favorable: favorableOdds,
        summary: `${allOdds.length} matches, ${favorableOdds.length} with favorable odds (-200 to -300)`
      });
    } catch (error) {
      console.error("Error fetching Kambi tennis odds:", error);
      res.status(500).json({ message: "Failed to fetch tennis odds" });
    }
  });

  // NHL matchup details (H2H, last 5 games, streaks)
  app.get("/api/nhl/matchup/:homeAbbrev/:awayAbbrev", async (req, res) => {
    try {
      const { homeAbbrev, awayAbbrev } = req.params;
      const matchup = await fetchNHLMatchupDetails(homeAbbrev, awayAbbrev);
      if (!matchup) {
        return res.status(404).json({ message: "Matchup data not found" });
      }
      res.json(matchup);
    } catch (error) {
      console.error("Error fetching NHL matchup:", error);
      res.status(500).json({ message: "Failed to fetch matchup details" });
    }
  });

  // NHL Moneyline Analysis: Teams on win streaks with their upcoming games and odds
  app.get("/api/nhl/moneyline-analysis", async (_req, res) => {
    try {
      // Fetch all data in parallel
      const [streaks, odds, scheduleData] = await Promise.all([
        fetchNHLTeamWinStreaks(),
        fetchKambiNHLOdds(),
        fetchAllSportsData()
      ]);
      
      const nhlSchedule = scheduleData.nhl || [];
      
      // For each team on a win streak, find their upcoming game and odds
      const analysis = streaks.map(streak => {
        // Find upcoming game for this team
        const upcomingGame = nhlSchedule.find(game => {
          const teamLower = streak.name.toLowerCase();
          const homeLower = game.homeTeam?.toLowerCase() || '';
          const awayLower = game.awayTeam?.toLowerCase() || '';
          return homeLower.includes(teamLower) || awayLower.includes(teamLower) ||
                 teamLower.includes(homeLower) || teamLower.includes(awayLower);
        });
        
        // Find Kambi odds for this game
        let gameOdds = null;
        let isHome = false;
        if (upcomingGame) {
          const abbrev = streak.abbreviation.toUpperCase();
          const streakNameLower = streak.name.toLowerCase();
          
          // Try multiple matching strategies:
          // 1. Full name match (e.g., "Tampa Bay Lightning")
          // 2. Abbreviation match (e.g., "TB", "TBL")
          // 3. City/team name partial match (e.g., "Lightning", "Tampa")
          const nameParts = streakNameLower.split(' ');
          const cityName = nameParts.slice(0, -1).join(' '); // e.g., "tampa bay"
          const teamNickname = nameParts[nameParts.length - 1]; // e.g., "lightning"
          
          gameOdds = odds.find(o => {
            const eventLower = o.event.toLowerCase();
            const homeLower = o.homeTeam?.toLowerCase() || '';
            const awayLower = o.awayTeam?.toLowerCase() || '';
            
            // Check full name
            if (eventLower.includes(streakNameLower) || homeLower.includes(streakNameLower) || awayLower.includes(streakNameLower)) {
              return true;
            }
            // Check abbreviation (Kambi uses "TB Lightning" format)
            if (eventLower.includes(abbrev.toLowerCase()) || homeLower.includes(abbrev.toLowerCase()) || awayLower.includes(abbrev.toLowerCase())) {
              return true;
            }
            // Check team nickname (e.g., "lightning")
            if (eventLower.includes(teamNickname) || homeLower.includes(teamNickname) || awayLower.includes(teamNickname)) {
              return true;
            }
            return false;
          });
          
          if (gameOdds) {
            const homeLower = gameOdds.homeTeam?.toLowerCase() || '';
            isHome = homeLower.includes(streakNameLower) || 
                     homeLower.includes(abbrev.toLowerCase()) ||
                     homeLower.includes(teamNickname);
          }
        }
        
        // Calculate implied probability from moneyline
        let impliedProb = null;
        let moneylineOdds = null;
        if (gameOdds?.moneyline) {
          moneylineOdds = isHome ? gameOdds.moneyline.homeOdds : gameOdds.moneyline.awayOdds;
          if (moneylineOdds) {
            const oddsNum = parseInt(moneylineOdds);
            if (oddsNum < 0) {
              impliedProb = Math.abs(oddsNum) / (Math.abs(oddsNum) + 100) * 100;
            } else {
              impliedProb = 100 / (oddsNum + 100) * 100;
            }
          }
        }
        
        return {
          team: streak.name,
          abbreviation: streak.abbreviation,
          logo: streak.logo,
          winStreak: streak.winStreak,
          record: streak.record,
          hasUpcomingGame: !!upcomingGame,
          upcomingGame: upcomingGame ? {
            event: upcomingGame.event,
            opponent: isHome ? upcomingGame.awayTeam : upcomingGame.homeTeam,
            isHome,
            time: upcomingGame.time,
            status: upcomingGame.status,
          } : null,
          moneyline: moneylineOdds,
          impliedProbability: impliedProb ? `${impliedProb.toFixed(1)}%` : null,
          recommendation: streak.winStreak >= 4 && moneylineOdds && parseInt(moneylineOdds) >= -200 
            ? 'Strong ML candidate' 
            : streak.winStreak >= 3 && moneylineOdds && parseInt(moneylineOdds) >= -150
            ? 'Consider ML bet'
            : null
        };
      });
      
      res.json({
        streakTeams: analysis.filter(a => a.hasUpcomingGame),
        teamsWithoutGames: analysis.filter(a => !a.hasUpcomingGame),
        summary: `${streaks.length} teams on 3+ win streaks, ${analysis.filter(a => a.hasUpcomingGame).length} with games today`
      });
    } catch (error) {
      console.error("Error fetching NHL moneyline analysis:", error);
      res.status(500).json({ message: "Failed to fetch NHL moneyline analysis" });
    }
  });

  // Create NHL Moneyline Pick from hot streak team
  app.post("/api/nhl/moneyline-pick", async (req, res) => {
    try {
      const { team, abbreviation, opponent, isHome, odds, winStreak, record, event } = req.body;
      
      // Validate required fields
      if (!team || !abbreviation || !opponent || !odds) {
        return res.status(400).json({ message: "Missing required fields: team, abbreviation, opponent, odds" });
      }
      
      // Check permanent ban list
      const abbrevUpper = abbreviation.toUpperCase();
      if (PERMANENTLY_BANNED_TEAMS[abbrevUpper]) {
        return res.status(400).json({ 
          message: `${team} (${abbrevUpper}) is on the permanent ban list and cannot be selected for picks.` 
        });
      }
      
      // Validate odds are in acceptable range (not worse than -350)
      const oddsNum = parseInt(odds);
      if (isNaN(oddsNum)) {
        return res.status(400).json({ message: "Invalid odds format" });
      }
      if (oddsNum < -350) {
        return res.status(400).json({ 
          message: `Odds ${odds} are too heavy (worse than -350). Looking for value picks only.` 
        });
      }
      
      const user = await ensureDemoUser();
      const bankroll = user.bankroll || 1000;
      
      // Calculate confidence based on streak length (capped 6-8)
      // 3W streak = conf 6, 4W = conf 7, 5W+ = conf 8
      const streakNum = parseInt(winStreak) || 3;
      const confidence = Math.min(8, Math.max(6, streakNum + 3));
      
      // Calculate stake: aligned with existing sizing (1-3% of bankroll)
      // conf 6 = 1%, conf 7 = 2%, conf 8 = 3%
      const stakePercent = confidence <= 6 ? 0.01 : confidence === 7 ? 0.02 : 0.03;
      const stake = Math.round(bankroll * stakePercent);
      
      // Build prediction string
      const prediction = `${abbreviation} ${team} ML`;
      
      // Build event string
      const eventString = event || (isHome ? `${opponent} @ ${team}` : `${team} @ ${opponent}`);
      
      // Build reasoning
      const reasoning = `${team} on ${winStreak}-game win streak (${record}). Moneyline ${odds} offers solid value for a hot team. Streak momentum favors continued success.`;
      
      // Create the pick
      const savedPick = await storage.createPick({
        userId: user.id,
        sport: 'NHL',
        event: eventString,
        prediction,
        odds,
        confidence,
        stake,
        reasoning,
        status: 'pending',
      });
      
      console.log(`[ML Pick] Created moneyline pick: ${team} ML ${odds}, stake $${stake}, conf ${confidence}`);
      
      res.json({ 
        success: true, 
        pick: savedPick,
        message: `Added ${team} ML pick at ${odds}`
      });
    } catch (error) {
      console.error("Error creating moneyline pick:", error);
      res.status(500).json({ message: "Failed to create moneyline pick" });
    }
  });

  // Tennis player stats from TennisExplorer (last 10 matches)
  app.get("/api/tennis/player/:name", async (req, res) => {
    try {
      // Express already decodes URL parameters, no need for decodeURIComponent
      const playerName = req.params.name;
      console.log(`[Tennis API] Fetching stats for: ${playerName}`);
      
      const playerStats = await fetchPlayerStats(playerName);
      if (!playerStats) {
        return res.status(404).json({ message: "Player not found" });
      }
      
      res.json(playerStats);
    } catch (error) {
      console.error("Error fetching tennis player stats:", error);
      res.status(500).json({ message: "Failed to fetch player stats" });
    }
  });

  // Tennis H2H from TennisExplorer
  app.get("/api/tennis/h2h/:player1/:player2", async (req, res) => {
    try {
      // Express already decodes URL parameters, no need for decodeURIComponent
      const player1 = req.params.player1;
      const player2 = req.params.player2;
      console.log(`[Tennis API] Fetching H2H: ${player1} vs ${player2}`);
      
      const h2hData = await fetchH2H(player1, player2);
      if (!h2hData) {
        return res.status(404).json({ message: "H2H data not found" });
      }
      
      res.json(h2hData);
    } catch (error) {
      console.error("Error fetching tennis H2H:", error);
      res.status(500).json({ message: "Failed to fetch H2H data" });
    }
  });

  // Tennis matchup details (combines both players + H2H)
  app.get("/api/tennis/matchup", async (req, res) => {
    try {
      const player1 = req.query.player1 as string;
      const player2 = req.query.player2 as string;
      const league = req.query.league as string | undefined;
      
      if (!player1 || !player2) {
        return res.status(400).json({ message: "Both player1 and player2 are required" });
      }
      
      console.log(`[Tennis API] Fetching matchup: ${player1} vs ${player2} (league: ${league || 'any'})`);
      
      const [player1Stats, player2Stats, h2hData] = await Promise.all([
        fetchPlayerStats(player1, league),
        fetchPlayerStats(player2, league),
        fetchH2H(player1, player2, league)
      ]);
      
      res.json({
        player1: player1Stats,
        player2: player2Stats,
        h2h: h2hData
      });
    } catch (error) {
      console.error("Error fetching tennis matchup:", error);
      res.status(500).json({ message: "Failed to fetch matchup data" });
    }
  });

  // Check pick outcomes based on final NHL scores
  app.get("/api/picks/check-outcomes", async (_req, res) => {
    try {
      const user = await ensureDemoUser();
      const userPicks = await storage.getPicks(user.id);
      const pendingPicks = userPicks.filter(p => p.status === 'pending' && p.sport?.toLowerCase() === 'nhl');
      
      if (pendingPicks.length === 0) {
        return res.json({ outcomes: [], message: "No pending NHL picks to check" });
      }
      
      // Fetch current NHL schedule with scores
      const liveData = await fetchAllSportsData();
      const nhlGames = liveData.nhl || [];
      
      // Team name normalization
      const teamAliases: Record<string, string[]> = {
        'new york': ['rangers', 'nyr', 'ny rangers'],
        'los angeles': ['kings', 'lak', 'la kings', 'la'],
        'minnesota': ['wild', 'min'],
        'detroit': ['red wings', 'det'],
        'ottawa': ['senators', 'ott'],
        'anaheim': ['ducks', 'ana'],
        'washington': ['capitals', 'wsh'],
        'utah': ['mammoth', 'uta', 'utah hc'],
        'carolina': ['hurricanes', 'car'],
        'new jersey': ['devils', 'njd', 'nj'],
        'florida': ['panthers', 'fla'],
        'colorado': ['avalanche', 'col'],
        'pittsburgh': ['penguins', 'pit'],
        'dallas': ['stars', 'dal'],
        'montreal': ['canadiens', 'mtl'],
        'seattle': ['kraken', 'sea'],
        'calgary': ['flames', 'cgy'],
        'vancouver': ['canucks', 'van'],
        'edmonton': ['oilers', 'edm'],
        'winnipeg': ['jets', 'wpg'],
        'toronto': ['maple leafs', 'tor'],
        'boston': ['bruins', 'bos'],
        'buffalo': ['sabres', 'buf'],
        'philadelphia': ['flyers', 'phi'],
        'vegas': ['golden knights', 'vgk'],
        'st louis': ['blues', 'stl'],
        'chicago': ['blackhawks', 'chi'],
        'nashville': ['predators', 'nsh'],
        'tampa bay': ['lightning', 'tbl'],
        'columbus': ['blue jackets', 'cbj'],
        'san jose': ['sharks', 'sjs'],
        'arizona': ['coyotes', 'ari'],
      };
      
      // Normalize text: lowercase, remove punctuation, collapse whitespace
      const normalize = (text: string): string => {
        return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
      };
      
      // Helper to check if text matches a team by city, mascot, or full name
      const matchesTeam = (text: string, fullTeamName: string): boolean => {
        const normText = normalize(text);
        const normTeam = normalize(fullTeamName);
        
        // First check direct match
        if (normText.includes(normTeam)) return true;
        
        // Check all aliases - iterate through all teams to find matches
        for (const [city, aliases] of Object.entries(teamAliases)) {
          const normCity = normalize(city);
          // If the fullTeamName contains the city (e.g., "new york" is in "new york rangers")
          if (normTeam.includes(normCity) || aliases.some(a => normTeam.includes(normalize(a)))) {
            // Check if the text matches any of this team's identifiers
            if (normText.includes(normCity) || aliases.some(a => normText.includes(normalize(a)))) {
              return true;
            }
          }
        }
        return false;
      };
      
      // Helper to check if prediction mentions a specific team
      const predictionMentionsTeam = (prediction: string, teamName: string): boolean => {
        const normPred = normalize(prediction);
        const normTeam = normalize(teamName);
        
        if (normPred.includes(normTeam)) return true;
        for (const [city, aliases] of Object.entries(teamAliases)) {
          const normCity = normalize(city);
          if (normTeam.includes(normCity) || aliases.some(a => normTeam.includes(normalize(a)))) {
            if (normPred.includes(normCity) || aliases.some(a => normPred.includes(normalize(a)))) {
              return true;
            }
          }
        }
        return false;
      };
      
      const outcomes: { pickId: number; event: string; score: string; suggestedStatus: string; betTeam: string }[] = [];
      
      for (const pick of pendingPicks) {
        const event = pick.event?.toLowerCase() || '';
        const prediction = pick.prediction?.toLowerCase() || '';
        
        // Find matching game
        for (const game of nhlGames) {
          if (game.status !== 'Final') continue;
          
          const homeTeam = game.homeTeam?.toLowerCase() || '';
          const awayTeam = game.awayTeam?.toLowerCase() || '';
          
          // Check if event matches this game (check both home and away)
          const homeMatch = matchesTeam(event, homeTeam);
          const awayMatch = matchesTeam(event, awayTeam);
          
          if (homeMatch && awayMatch) {
            // Parse score (format: "3-2" where away-home)
            const score = game.score || '';
            const [awayScoreStr, homeScoreStr] = score.split('-');
            const awayScore = parseInt(awayScoreStr) || 0;
            const homeScore = parseInt(homeScoreStr) || 0;
            
            // Determine which team was bet on from prediction
            let betTeam = '';
            let betOnHome = false;
            
            // Check if prediction mentions +1.5 and determine which team
            if (prediction.includes('+1.5')) {
              // Check if prediction mentions home or away team
              if (predictionMentionsTeam(prediction, homeTeam)) {
                betTeam = homeTeam;
                betOnHome = true;
              } else if (predictionMentionsTeam(prediction, awayTeam)) {
                betTeam = awayTeam;
                betOnHome = false;
              }
            }
            
            // Calculate if bet won based on +1.5 puckline
            // +1.5 means the team can lose by 1 goal and still cover
            let teamWonBet = false;
            if (betTeam) {
              if (betOnHome) {
                // Bet on home +1.5: win if home wins OR loses by exactly 1
                teamWonBet = homeScore >= awayScore - 1;
              } else {
                // Bet on away +1.5: win if away wins OR loses by exactly 1
                teamWonBet = awayScore >= homeScore - 1;
              }
            }
            
            outcomes.push({
              pickId: pick.id,
              event: pick.event || '',
              score: score,
              suggestedStatus: betTeam ? (teamWonBet ? 'won' : 'lost') : 'pending',
              betTeam: betTeam
            });
            break;
          }
        }
      }
      
      res.json({ outcomes: outcomes.filter(o => o.suggestedStatus !== 'pending') });
    } catch (error) {
      console.error("Error checking pick outcomes:", error);
      res.status(500).json({ message: "Failed to check outcomes" });
    }
  });

  // Auto-apply pick outcomes (authenticated only)
  app.post("/api/picks/apply-outcomes", isAuthenticated, async (req: any, res) => {
    try {
      const { outcomes } = req.body;
      
      if (!Array.isArray(outcomes)) {
        return res.status(400).json({ message: "Outcomes must be an array" });
      }
      
      const user = await ensureDemoUser();
      let newBankroll = user.bankroll || 1000;
      const results: { pickId: number; status: string; bankrollChange: number }[] = [];
      
      for (const outcome of outcomes) {
        const { pickId, status } = outcome;
        if (!['won', 'lost'].includes(status)) continue;
        
        const [pick] = await db.select().from(picks).where(eq(picks.id, pickId));
        if (!pick || pick.status !== 'pending') continue;
        
        const odds = parseInt(pick.odds?.replace(/[^\d-]/g, '') || '0');
        const betSize = pick.stake || calculateBetSize(newBankroll, pick.confidence);
        
        let bankrollChange = 0;
        if (status === 'won') {
          bankrollChange = calculateProfit(betSize, odds);
          newBankroll = Math.round(newBankroll + bankrollChange);
        } else {
          bankrollChange = -betSize;
          newBankroll = Math.round(newBankroll - betSize);
        }
        
        await db.update(picks).set({ status }).where(eq(picks.id, pickId));
        results.push({ pickId, status, bankrollChange });
      }
      
      await storage.updateUserBankroll(user.id, newBankroll);
      res.json({ results, newBankroll });
    } catch (error) {
      console.error("Error applying outcomes:", error);
      res.status(500).json({ message: "Failed to apply outcomes" });
    }
  });

  // Manual catch-up endpoint - processes all pending picks against 7-day game history
  // Use this to recover from missed auto-polls or server restarts
  app.post("/api/picks/catch-up", isAuthenticated, async (req: any, res) => {
    try {
      console.log("[Catch-Up] Manual catch-up triggered...");
      
      const user = await ensureDemoUser();
      const allPicks = await storage.getPicks(user.id);
      const pendingPicks = allPicks.filter((p: any) => p.status === 'pending');
      
      // Separate NHL and stale picks
      const pendingNHL = pendingPicks.filter((p: any) => p.sport === 'NHL');
      const now = new Date();
      const STALE_THRESHOLD_HOURS = 48;
      
      // Identify stale picks (pending for more than 48 hours)
      const stalePicks = pendingPicks.filter((p: any) => {
        if (!p.createdAt) return false;
        const createdAt = new Date(p.createdAt);
        const ageHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
        return ageHours > STALE_THRESHOLD_HOURS;
      });
      
      // Fetch 7 days of completed NHL games
      const finalGames = await fetchCompletedNHLGames(7);
      console.log(`[Catch-Up] Found ${finalGames.length} completed games over 7 days`);
      
      const normalize = (text: string): string => {
        return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
      };
      
      const teamAliases: Record<string, string[]> = {
        'new york': ['rangers', 'nyr', 'islanders', 'nyi'],
        'los angeles': ['kings', 'lak'],
        'san jose': ['sharks', 'sjs'],
        'tampa bay': ['lightning', 'tbl'],
        'st louis': ['blues', 'stl'],
        'columbus': ['blue jackets', 'cbj'],
        'vegas': ['golden knights', 'vgk'],
        'seattle': ['kraken', 'sea'],
        'carolina': ['hurricanes', 'car'],
        'new jersey': ['devils', 'njd'],
        'pittsburgh': ['penguins', 'pit'],
        'washington': ['capitals', 'wsh'],
        'philadelphia': ['flyers', 'phi'],
        'chicago': ['blackhawks', 'chi'],
        'detroit': ['red wings', 'det'],
        'boston': ['bruins', 'bos'],
        'toronto': ['maple leafs', 'tor'],
        'montreal': ['canadiens', 'mtl'],
        'ottawa': ['senators', 'ott'],
        'buffalo': ['sabres', 'buf'],
        'florida': ['panthers', 'fla'],
        'anaheim': ['ducks', 'ana'],
        'colorado': ['avalanche', 'col'],
        'dallas': ['stars', 'dal'],
        'minnesota': ['wild', 'min'],
        'nashville': ['predators', 'nsh'],
        'winnipeg': ['jets', 'wpg'],
        'calgary': ['flames', 'cgy'],
        'edmonton': ['oilers', 'edm'],
        'vancouver': ['canucks', 'van'],
        'utah': ['hockey club', 'uta', 'utah hc'],
      };
      
      const matchesTeam = (text: string, teamName: string): boolean => {
        const normText = normalize(text);
        const normTeam = normalize(teamName);
        if (normText.includes(normTeam)) return true;
        for (const [city, aliases] of Object.entries(teamAliases)) {
          if (normTeam.includes(city) || aliases.some(a => normTeam.includes(a))) {
            if (normText.includes(city) || aliases.some(a => normText.includes(a))) {
              return true;
            }
          }
        }
        return false;
      };
      
      const outcomes: { pickId: number; event: string; score: string; status: string }[] = [];
      
      for (const pick of pendingNHL) {
        const prediction = (pick.prediction || '').toLowerCase();
        if (!prediction.includes('+1.5') && !prediction.includes('ml')) continue;
        
        const pickEvent = pick.event || '';
        const pickCreatedAt = pick.createdAt ? new Date(pick.createdAt) : null;
        
        // SAFETY: Skip picks without valid creation timestamps - prevents false matches
        if (!pickCreatedAt) {
          console.log(`[Catch-Up] Skipping pick ${pick.id} - no valid createdAt timestamp`);
          continue;
        }
        
        for (const game of finalGames) {
          const homeTeam = normalize(game.homeTeam || '');
          const awayTeam = normalize(game.awayTeam || '');
          
          // Match game date to pick creation (game must be after pick was created)
          if (game.date && pickCreatedAt) {
            const gameDate = new Date(game.date);
            gameDate.setHours(23, 59, 59, 999);
            const adjustedPickTime = new Date(pickCreatedAt.getTime() - 6 * 60 * 60 * 1000);
            if (gameDate < adjustedPickTime) continue;
          }
          
          // Both teams must match the pick's event
          const eventMatchesHome = matchesTeam(pickEvent, homeTeam);
          const eventMatchesAway = matchesTeam(pickEvent, awayTeam);
          if (!eventMatchesHome || !eventMatchesAway) continue;
          
          // Parse score
          const scoreMatch = game.score?.match(/(\d+)\s*-\s*(\d+)/);
          if (!scoreMatch) continue;
          
          const awayScore = parseInt(scoreMatch[1]);
          const homeScore = parseInt(scoreMatch[2]);
          
          // Determine bet team
          let betOnHome = false;
          let betTeam = '';
          
          if (matchesTeam(prediction, homeTeam)) {
            betTeam = homeTeam;
            betOnHome = true;
          } else if (matchesTeam(prediction, awayTeam)) {
            betTeam = awayTeam;
            betOnHome = false;
          }
          
          if (!betTeam) continue;
          
          // Calculate outcome
          let status = '';
          if (prediction.includes('+1.5')) {
            // Puckline: team can lose by 1 and still cover
            const teamWon = betOnHome 
              ? (homeScore + 1.5) > awayScore
              : (awayScore + 1.5) > homeScore;
            status = teamWon ? 'won' : 'lost';
          } else if (prediction.includes('ml')) {
            // Moneyline: must win outright
            const teamWon = betOnHome 
              ? homeScore > awayScore
              : awayScore > homeScore;
            status = teamWon ? 'won' : 'lost';
          }
          
          if (status) {
            outcomes.push({
              pickId: pick.id,
              event: pick.event || '',
              score: game.score || '',
              status
            });
            console.log(`[Catch-Up] Match: Pick ${pick.id} "${pickEvent}" -> ${game.event} (${game.score}) = ${status}`);
          }
          break;
        }
      }
      
      // Apply outcomes
      let newBankroll = user.bankroll || 1000;
      const applied: typeof outcomes = [];
      
      for (const outcome of outcomes) {
        const [pick] = await db.select().from(picks).where(eq(picks.id, outcome.pickId));
        if (!pick || pick.status !== 'pending') continue;
        
        const odds = parseInt(pick.odds?.replace(/[^\d-]/g, '') || '0');
        const betSize = pick.stake || Math.round(newBankroll * 0.03);
        
        if (outcome.status === 'won') {
          const profit = odds < 0 
            ? Math.round(betSize * (100 / Math.abs(odds)))
            : Math.round(betSize * (odds / 100));
          newBankroll = Math.round(newBankroll + profit);
        } else {
          newBankroll = Math.round(newBankroll - betSize);
        }
        
        await db.update(picks).set({ status: outcome.status }).where(eq(picks.id, outcome.pickId));
        applied.push(outcome);
        
        // Update team flag
        const teamCode = extractTeamCode(pick.prediction);
        if (teamCode) {
          await storage.updateTeamStatus(teamCode, getTeamName(teamCode), outcome.status as 'won' | 'lost');
        }
      }
      
      if (applied.length > 0) {
        await storage.updateUserBankroll(user.id, newBankroll);
      }
      
      console.log(`[Catch-Up] Applied ${applied.length} outcomes, new bankroll: $${newBankroll}`);
      
      res.json({
        message: `Processed ${pendingNHL.length} pending NHL picks`,
        appliedOutcomes: applied.length,
        stalePicks: stalePicks.map(p => ({
          id: p.id,
          event: p.event,
          ageHours: p.createdAt ? Math.round((now.getTime() - new Date(p.createdAt).getTime()) / (1000 * 60 * 60)) : 0
        })),
        newBankroll: applied.length > 0 ? newBankroll : undefined
      });
    } catch (error) {
      console.error("[Catch-Up] Error:", error);
      res.status(500).json({ message: "Failed to run catch-up" });
    }
  });

  // Get stale pending picks (older than 48 hours)
  app.get("/api/picks/stale", isAuthenticated, async (req: any, res) => {
    try {
      const user = await ensureDemoUser();
      const allPicks = await storage.getPicks(user.id);
      const now = new Date();
      const STALE_THRESHOLD_HOURS = 48;
      
      const stalePicks = allPicks
        .filter((p: any) => p.status === 'pending')
        .filter((p: any) => {
          if (!p.createdAt) return false;
          const createdAt = new Date(p.createdAt);
          const ageHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
          return ageHours > STALE_THRESHOLD_HOURS;
        })
        .map((p: any) => ({
          id: p.id,
          event: p.event,
          prediction: p.prediction,
          sport: p.sport,
          createdAt: p.createdAt,
          ageHours: p.createdAt ? Math.round((now.getTime() - new Date(p.createdAt).getTime()) / (1000 * 60 * 60)) : 0
        }));
      
      res.json({
        count: stalePicks.length,
        stalePicks,
        message: stalePicks.length > 0 
          ? `Found ${stalePicks.length} stale picks needing manual review`
          : "No stale picks found"
      });
    } catch (error) {
      console.error("Error fetching stale picks:", error);
      res.status(500).json({ message: "Failed to fetch stale picks" });
    }
  });

  // ================== PARLAY ROUTES ==================
  
  // Utility functions for odds conversion
  function americanToDecimal(americanOdds: number): number {
    if (americanOdds > 0) {
      return 1 + (americanOdds / 100);
    } else {
      return 1 + (100 / Math.abs(americanOdds));
    }
  }
  
  function decimalToAmerican(decimalOdds: number): number {
    if (decimalOdds >= 2) {
      return Math.round((decimalOdds - 1) * 100);
    } else {
      return Math.round(-100 / (decimalOdds - 1));
    }
  }
  
  // Calculate suggested stake using simplified Kelly criterion
  function calculateKellyStake(
    bankroll: number,
    combinedDecimalOdds: number,
    avgConfidence: number
  ): number {
    // Map confidence (1-10) to win probability (0.50 to 0.75)
    const winProbability = 0.45 + (avgConfidence / 10) * 0.30;
    
    // Kelly formula: f = (bp - q) / b
    // where b = decimal odds - 1, p = win prob, q = 1 - p
    const b = combinedDecimalOdds - 1;
    const p = winProbability;
    const q = 1 - p;
    
    const kellyFraction = (b * p - q) / b;
    
    // Use 50% Kelly (half-Kelly) for safety, cap at 5% of bankroll
    const halfKelly = Math.max(0, kellyFraction / 2);
    const maxBet = bankroll * 0.05;
    
    const suggestedStake = Math.min(bankroll * halfKelly, maxBet);
    return Math.round(suggestedStake);
  }
  
  // Calculate parlay odds and suggested stake
  app.post("/api/parlays/calculate", async (req: any, res) => {
    try {
      const { legs } = req.body;
      
      if (!Array.isArray(legs) || legs.length < 2) {
        return res.status(400).json({ message: "Parlay requires at least 2 legs" });
      }
      
      const user = await ensureDemoUser();
      const bankroll = user.bankroll || 1000;
      
      // Parse odds from each leg and convert to decimal
      let combinedDecimalOdds = 1;
      let totalConfidence = 0;
      let validLegs = 0;
      
      for (const leg of legs) {
        const oddsStr = leg.odds?.toString() || '0';
        // Handle both positive (+140) and negative (-227) odds
        // Remove everything except digits, minus sign, and plus sign, then parse
        const cleanedOdds = oddsStr.replace(/[^\d+-]/g, '');
        const americanOdds = parseInt(cleanedOdds, 10);
        
        if (!isNaN(americanOdds) && americanOdds !== 0) {
          const decimal = americanToDecimal(americanOdds);
          combinedDecimalOdds *= decimal;
          validLegs++;
        }
        
        if (leg.confidence) {
          totalConfidence += leg.confidence;
        }
      }
      
      const avgConfidence = validLegs > 0 ? totalConfidence / validLegs : 5;
      const combinedAmericanOdds = decimalToAmerican(combinedDecimalOdds);
      const suggestedStake = calculateKellyStake(bankroll, combinedDecimalOdds, avgConfidence);
      
      // Calculate potential payout
      const potentialPayout = Math.round(suggestedStake * combinedDecimalOdds);
      const profit = potentialPayout - suggestedStake;
      
      res.json({
        combinedOdds: combinedAmericanOdds > 0 ? `+${combinedAmericanOdds}` : `${combinedAmericanOdds}`,
        combinedDecimalOdds: combinedDecimalOdds.toFixed(3),
        suggestedStake,
        potentialPayout,
        profit,
        bankroll,
        avgConfidence: Math.round(avgConfidence * 10) / 10,
        legCount: legs.length,
        breakdown: legs.map((leg: any) => {
          const cleanedOdds = leg.odds?.toString().replace(/[^\d+-]/g, '') || '0';
          const americanOdds = parseInt(cleanedOdds, 10);
          return {
            event: leg.event,
            prediction: leg.prediction,
            odds: leg.odds,
            decimalOdds: !isNaN(americanOdds) && americanOdds !== 0 ? americanToDecimal(americanOdds).toFixed(3) : '1.000',
            confidence: leg.confidence || 5
          };
        })
      });
    } catch (error) {
      console.error("Error calculating parlay:", error);
      res.status(500).json({ message: "Failed to calculate parlay" });
    }
  });
  
  // Create a new parlay
  app.post("/api/parlays", async (req: any, res) => {
    try {
      const { name, legs, stake } = req.body;
      
      if (!Array.isArray(legs) || legs.length < 2) {
        return res.status(400).json({ message: "Parlay requires at least 2 legs" });
      }
      
      const user = await ensureDemoUser();
      
      // Calculate combined odds
      let combinedDecimalOdds = 1;
      const processedLegs = legs.map((leg: any) => {
        const cleanedOdds = leg.odds?.toString().replace(/[^\d+-]/g, '') || '0';
        const americanOdds = parseInt(cleanedOdds, 10);
        const decimal = !isNaN(americanOdds) && americanOdds !== 0 ? americanToDecimal(americanOdds) : 1;
        combinedDecimalOdds *= decimal;
        
        return {
          parlayId: 0, // Will be set after parlay creation
          pickId: leg.pickId || null,
          sport: leg.sport,
          event: leg.event,
          prediction: leg.prediction,
          odds: leg.odds,
          decimalOdds: decimal.toFixed(3),
          confidence: leg.confidence || 5,
          status: 'pending'
        };
      });
      
      const combinedAmericanOdds = decimalToAmerican(combinedDecimalOdds);
      const actualStake = stake || calculateKellyStake(user.bankroll || 1000, combinedDecimalOdds, 6);
      const potentialPayout = Math.round(actualStake * combinedDecimalOdds);
      
      const parlayData = {
        userId: user.id,
        name: name || `${legs.length}-Leg Parlay`,
        combinedOdds: combinedAmericanOdds > 0 ? `+${combinedAmericanOdds}` : `${combinedAmericanOdds}`,
        combinedDecimalOdds: combinedDecimalOdds.toFixed(3),
        stake: actualStake,
        suggestedStake: calculateKellyStake(user.bankroll || 1000, combinedDecimalOdds, 6),
        potentialPayout,
        status: 'pending'
      };
      
      const result = await storage.createParlay(parlayData, processedLegs);
      
      res.json({
        message: `Created ${legs.length}-leg parlay`,
        parlay: result.parlay,
        legs: result.legs
      });
    } catch (error) {
      console.error("Error creating parlay:", error);
      res.status(500).json({ message: "Failed to create parlay" });
    }
  });
  
  // Get all parlays for user
  app.get("/api/parlays", async (req: any, res) => {
    try {
      const user = await ensureDemoUser();
      const parlays = await storage.getParlays(user.id);
      res.json(parlays);
    } catch (error) {
      console.error("Error fetching parlays:", error);
      res.status(500).json({ message: "Failed to fetch parlays" });
    }
  });
  
  // Update parlay status
  app.post("/api/parlays/:id/status", async (req: any, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      
      if (!['pending', 'won', 'lost', 'partial'].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      
      const updated = await storage.updateParlayStatus(parseInt(id), status);
      res.json(updated);
    } catch (error) {
      console.error("Error updating parlay status:", error);
      res.status(500).json({ message: "Failed to update parlay status" });
    }
  });

  app.post(api.picks.generate.path, async (req, res) => {
    try {
      const { sport, context } = api.picks.generate.input.parse(req.body);
      const user = await ensureDemoUser();

      // Fetch live data from ESPN/NHL APIs and Kambi odds
      let liveScheduleContext = "";
      
      // Pre-declare edge factor data at higher scope for pick processing
      let teamStatsData: Map<string, NHLTeamStats> = new Map();
      let scoringTrendsData: Map<string, ScoringTrend> = new Map();
      try {
        const [liveData, kambiOdds, kambiTennisOdds, nhlStreaks, teamPerformance, teamStrength, nhlInjuries] = await Promise.all([
          fetchAllSportsData(),
          fetchKambiNHLOdds(),
          fetchKambiTennisOdds(),
          fetchNHLTeamWinStreaks(),
          storage.getTeamPerformanceStats(),
          fetchNHLTeamStrength(),
          fetchNHLInjuries()
        ]);
        
        // Add NHL team strength analysis to context
        const strengthContext = getTeamStrengthContext(teamStrength);
        if (strengthContext) {
          liveScheduleContext += "\n\n" + strengthContext;
        }
        
        // Add NHL injury report for today's games
        const teamsPlayingToday = kambiOdds.flatMap(o => [o.homeTeam, o.awayTeam].filter(Boolean))
          .map(name => {
            // Convert team names to abbreviations for injury lookup
            const abbrevMap: Record<string, string> = {
              'ducks': 'ANA', 'bruins': 'BOS', 'sabres': 'BUF', 'flames': 'CGY',
              'hurricanes': 'CAR', 'blackhawks': 'CHI', 'avalanche': 'COL', 'blue jackets': 'CBJ',
              'stars': 'DAL', 'red wings': 'DET', 'oilers': 'EDM', 'panthers': 'FLA',
              'kings': 'LAK', 'wild': 'MIN', 'canadiens': 'MTL', 'predators': 'NSH',
              'devils': 'NJD', 'islanders': 'NYI', 'rangers': 'NYR', 'senators': 'OTT',
              'flyers': 'PHI', 'penguins': 'PIT', 'sharks': 'SJS', 'kraken': 'SEA',
              'blues': 'STL', 'lightning': 'TBL', 'maple leafs': 'TOR', 'utah': 'UTA',
              'canucks': 'VAN', 'golden knights': 'VGK', 'capitals': 'WSH', 'jets': 'WPG'
            };
            const nameLower = (name || '').toLowerCase();
            for (const [key, abbr] of Object.entries(abbrevMap)) {
              if (nameLower.includes(key)) return abbr;
            }
            return '';
          }).filter(Boolean);
        
        const injuryContext = getInjuryContext(nhlInjuries, teamsPlayingToday);
        if (injuryContext) {
          liveScheduleContext += "\n\n" + injuryContext;
        }
        
        // Add NHL Rest/Fatigue context
        const restDataForPrompt = await fetchNHLRestData();
        const backToBackTeams: string[] = [];
        const restedTeams: string[] = [];
        
        // Check all teams playing today for rest status
        for (const teamCode of teamsPlayingToday) {
          const data = restDataForPrompt.get(teamCode);
          if (data) {
            if (data.isBackToBack) backToBackTeams.push(`${teamCode} (played yesterday)`);
            if (data.isRested) restedTeams.push(`${teamCode} (${data.daysSinceLastGame} days rest)`);
          } else {
            // Team not in rest data = hasn't played in 10+ days = well-rested
            restedTeams.push(`${teamCode} (10+ days rest)`);
          }
        }
        
        if (backToBackTeams.length > 0 || restedTeams.length > 0) {
          liveScheduleContext += "\n\nNHL REST/FATIGUE ANALYSIS:";
          if (backToBackTeams.length > 0) {
            liveScheduleContext += "\nFATIGUED (Back-to-Back - AVOID picking these at high confidence): " + backToBackTeams.join(", ");
          }
          if (restedTeams.length > 0) {
            liveScheduleContext += "\nWELL-RESTED (3+ days off - slight advantage): " + restedTeams.join(", ");
          }
          liveScheduleContext += "\n[RULE: Do NOT pick a fatigued (back-to-back) team with confidence > 7. If both teams fatigued, prefer the home team.]";
        }
        
        // NEW EDGE FACTORS: Goalies, Team Stats, Scoring Trends
        const [startingGoalies, fetchedTeamStats, fetchedScoringTrends] = await Promise.all([
          fetchStartingGoalies(),
          fetchNHLTeamStats(),
          fetchScoringTrends(teamsPlayingToday)
        ]);
        // Assign to higher-scope variables for pick processing
        teamStatsData = fetchedTeamStats;
        scoringTrendsData = fetchedScoringTrends;
        
        // Add starting goalie information (HUGE factor in NHL betting)
        if (startingGoalies.length > 0) {
          const relevantGoalies = startingGoalies.filter(g => teamsPlayingToday.includes(g.teamCode));
          if (relevantGoalies.length > 0) {
            liveScheduleContext += "\n\nSTARTING GOALIES (Critical factor - backup goalies = higher risk):";
            liveScheduleContext += "\n" + relevantGoalies.map(g => 
              `- ${g.teamCode}: ${g.goalieName} (${g.confirmed ? 'CONFIRMED' : 'Projected'})`
            ).join("\n");
            liveScheduleContext += "\n[RULE: If a backup goalie is starting, cap confidence at 7 for that team]";
          }
        }
        
        // Add team stats: Home/Away splits and Special Teams
        if (teamStatsData.size > 0) {
          const relevantStats: string[] = [];
          const specialTeamsEdges: string[] = [];
          
          for (const teamCode of teamsPlayingToday) {
            const stats = teamStatsData.get(teamCode);
            if (stats) {
              // Home/Away splits
              const homeWinPct = stats.homeWins / (stats.homeWins + stats.homeLosses + stats.homeOtLosses);
              const awayWinPct = stats.awayWins / (stats.awayWins + stats.awayLosses + stats.awayOtLosses);
              
              if (homeWinPct > 0.6) {
                relevantStats.push(`${teamCode}: Strong at home (${stats.homeWins}-${stats.homeLosses}-${stats.homeOtLosses}, ${Math.round(homeWinPct * 100)}%)`);
              }
              if (awayWinPct > 0.55) {
                relevantStats.push(`${teamCode}: Strong on road (${stats.awayWins}-${stats.awayLosses}-${stats.awayOtLosses}, ${Math.round(awayWinPct * 100)}%)`);
              }
              if (awayWinPct < 0.35) {
                relevantStats.push(`${teamCode}: WEAK on road (${stats.awayWins}-${stats.awayLosses}-${stats.awayOtLosses}, ${Math.round(awayWinPct * 100)}%)`);
              }
              
              // Special teams
              if (stats.powerPlayPct > 25) {
                specialTeamsEdges.push(`${teamCode}: Elite PP (${stats.powerPlayPct}%)`);
              }
              if (stats.penaltyKillPct > 83) {
                specialTeamsEdges.push(`${teamCode}: Elite PK (${stats.penaltyKillPct}%)`);
              }
              if (stats.penaltyKillPct < 75) {
                specialTeamsEdges.push(`${teamCode}: WEAK PK (${stats.penaltyKillPct}%) - vulnerable`);
              }
            }
          }
          
          if (relevantStats.length > 0) {
            liveScheduleContext += "\n\nHOME/AWAY PERFORMANCE SPLITS:";
            liveScheduleContext += "\n" + relevantStats.join("\n");
          }
          
          if (specialTeamsEdges.length > 0) {
            liveScheduleContext += "\n\nSPECIAL TEAMS EDGES:";
            liveScheduleContext += "\n" + specialTeamsEdges.join("\n");
            liveScheduleContext += "\n[RULE: Teams with elite PP (25%+) against weak PK (<75%) = confidence boost +1]";
          }
        }
        
        // Add scoring trends
        if (scoringTrendsData.size > 0) {
          const trendNotes: string[] = [];
          
          scoringTrendsData.forEach((trend, teamCode) => {
            if (trend.offenseTrend === 'hot') {
              trendNotes.push(`${teamCode}: Hot offense (${trend.avgGoalsFor.toFixed(1)} GF/G)`);
            }
            if (trend.offenseTrend === 'cold') {
              trendNotes.push(`${teamCode}: Cold offense (${trend.avgGoalsFor.toFixed(1)} GF/G) - scoring struggles`);
            }
            if (trend.defenseTrend === 'weak') {
              trendNotes.push(`${teamCode}: Leaky defense (${trend.avgGoalsAgainst.toFixed(1)} GA/G)`);
            }
          });
          
          if (trendNotes.length > 0) {
            liveScheduleContext += "\n\nSCORING TRENDS (Offense/Defense Form):";
            liveScheduleContext += "\n" + trendNotes.join("\n");
          }
        }
        
        // Track line movement for sharp money indicators
        const lineMovements = await trackLineMovement(kambiOdds);
        const significantMoves = lineMovements.filter(m => m.significantMovement);
        if (significantMoves.length > 0) {
          liveScheduleContext += "\n\nLINE MOVEMENT (Sharp Money Indicators):";
          liveScheduleContext += "\n" + significantMoves.map(m => 
            `- ${m.event}: Money moving toward ${m.movementDirection} (${m.homeMovement! > 0 ? '+' : ''}${m.homeMovement} pts)`
          ).join("\n");
          liveScheduleContext += "\n[RULE: Significant line movement often indicates professional betting action]";
        }
        
        // Add HOT TEAMS (proven winners from historical picks) to context
        const hotTeams = teamPerformance.filter(t => t.isHot);
        const coldTeams = teamPerformance.filter(t => t.isCold);
        
        if (hotTeams.length > 0) {
          liveScheduleContext += "\n\nHOT TEAMS - PROVEN BET WINNERS (OUR PICK HISTORY, NOT NHL GAME STREAKS):\n" +
            "NOTE: These are teams we have successfully bet on recently. The 'Pick Results' show our betting W/L, NOT actual NHL game streaks.\n" +
            hotTeams.map(t => `- ${t.teamCode} ${t.teamName}: ${t.wins}-${t.losses} betting record (${t.winRate}% win rate, ${t.roi}% ROI) | Pick Results: ${t.recentForm}`).join("\n");
        }
        
        if (coldTeams.length > 0) {
          liveScheduleContext += "\n\nCOLD TEAMS - AVOID (POOR BETTING HISTORY):\n" +
            "NOTE: These are teams our picks have lost on. NOT actual NHL losing streaks.\n" +
            coldTeams.map(t => `- ${t.teamCode} ${t.teamName}: ${t.wins}-${t.losses} betting record (${t.winRate}% win rate) | Pick Results: ${t.recentForm}`).join("\n");
        }
        
        // Kambi/Potawatomi real odds for NHL
        if (kambiOdds.length > 0) {
          liveScheduleContext += "\n\nKAMBI/POTAWATOMI NHL ODDS (LIVE FROM API):\n" + 
            kambiOdds.map(o => {
              let line = `- ${o.event}`;
              if (o.puckLine) {
                line += ` | Puckline: ${o.awayTeam} ${o.puckLine.away} (${o.puckLine.awayOdds}), ${o.homeTeam} ${o.puckLine.home} (${o.puckLine.homeOdds})`;
              }
              if (o.moneyline) {
                line += ` | ML: ${o.awayTeam} (${o.moneyline.awayOdds}), ${o.homeTeam} (${o.moneyline.homeOdds})`;
              }
              line += ` [${o.status}]`;
              return line;
            }).join("\n");
        }
        
        // Add NHL win streak data for moneyline analysis
        if (nhlStreaks.length > 0) {
          // Filter out permanently banned teams
          const eligibleStreaks = nhlStreaks.filter(s => !PERMANENTLY_BANNED_TEAMS[s.abbreviation]);
          
          // For each streak team, find their moneyline odds from Kambi
          const streakWithOdds = eligibleStreaks.map(streak => {
            const gameOdds = kambiOdds.find(o => {
              const eventLower = o.event.toLowerCase();
              const streakNameLower = streak.name.toLowerCase();
              return eventLower.includes(streakNameLower) || 
                     o.homeTeam?.toLowerCase().includes(streakNameLower) ||
                     o.awayTeam?.toLowerCase().includes(streakNameLower);
            });
            
            let mlOdds = null;
            let isHome = false;
            if (gameOdds?.moneyline) {
              isHome = gameOdds.homeTeam?.toLowerCase().includes(streak.name.toLowerCase()) || false;
              mlOdds = isHome ? gameOdds.moneyline.homeOdds : gameOdds.moneyline.awayOdds;
            }
            
            // Calculate implied probability from ML odds
            let impliedProb = null;
            if (mlOdds) {
              const oddsNum = parseInt(mlOdds);
              if (oddsNum < 0) {
                impliedProb = Math.abs(oddsNum) / (Math.abs(oddsNum) + 100) * 100;
              } else {
                impliedProb = 100 / (oddsNum + 100) * 100;
              }
            }
            
            // Calculate win streak probability proxy (rough estimate based on streak length)
            // 3W streak ~ 60% continuation, 4W ~ 65%, 5W+ ~ 70%
            const streakProb = streak.winStreak >= 5 ? 70 : streak.winStreak >= 4 ? 65 : 60;
            
            // Calculate edge vs implied odds
            const edge = impliedProb ? streakProb - impliedProb : null;
            
            return {
              ...streak,
              mlOdds,
              isHome,
              impliedProb,
              streakProb,
              edge,
              event: gameOdds?.event
            };
          }).filter(s => s.mlOdds && s.edge !== null);
          
          if (streakWithOdds.length > 0) {
            liveScheduleContext += "\n\nNHL MONEYLINE CANDIDATES - TEAMS ON WIN STREAKS WITH EDGE:\n" +
              streakWithOdds.map(s => {
                const edgeStr = s.edge! >= 5 ? 'STRONG' : s.edge! >= 0 ? 'MODERATE' : 'NEGATIVE';
                return `- ${s.abbreviation} ${s.name} (${s.record}) | ${s.winStreak}W STREAK | ML: ${s.mlOdds} (${s.impliedProb!.toFixed(1)}% implied) | Streak Prob: ~${s.streakProb}% | Edge: ${s.edge!.toFixed(1)}% [${edgeStr}] | ${s.isHome ? 'HOME' : 'AWAY'} | Event: ${s.event || 'TBD'}`;
              }).join("\n");
          }
        }
        
        // Add Kambi tennis odds (prioritize matches with -200 to -300 odds)
        const favorableTennis = filterFavorableTennisOdds(kambiTennisOdds);
        if (favorableTennis.length > 0) {
          liveScheduleContext += "\n\nKAMBI/POTAWATOMI TENNIS ODDS - FAVORABLE MATCHES (-200 to -300 range):\n" +
            favorableTennis.map(m => {
              const p1Odds = parseInt(m.player1Odds);
              const p2Odds = parseInt(m.player2Odds);
              const favorite = p1Odds < p2Odds ? m.player1 : m.player2;
              const favOdds = p1Odds < p2Odds ? m.player1Odds : m.player2Odds;
              return `- ${m.league}: ${m.player1} (${m.player1Odds}) vs ${m.player2} (${m.player2Odds}) | ${m.tournament} | Favorite: ${favorite} ${favOdds} [${m.status}]`;
            }).join("\n");
        } else if (kambiTennisOdds.length > 0) {
          liveScheduleContext += `\n\nKAMBI TENNIS: ${kambiTennisOdds.length} matches available but none in -200 to -300 range. Skip tennis picks for now.`;
        }
        
        // Filter to only upcoming tennis matches (not Final)
        const upcomingTennis = liveData.tennis.filter(g => g.status !== 'Final');
        
        // Analyze tennis matches using ESPN historical data (only if we have favorable Kambi odds)
        if (upcomingTennis.length > 0 && favorableTennis.length > 0) {
          // Helper to find matching Kambi odds for a player (improved matching)
          const findOddsForPlayer = (playerName: string): number | undefined => {
            const nameParts = playerName.toLowerCase().split(/[\s,]+/).filter(p => p.length > 2);
            const lastName = nameParts[nameParts.length - 1] || '';
            
            for (const kambi of favorableTennis) {
              const kambi1Parts = kambi.player1.toLowerCase().split(/[\s,]+/).filter(p => p.length > 2);
              const kambi2Parts = kambi.player2.toLowerCase().split(/[\s,]+/).filter(p => p.length > 2);
              const kambi1Last = kambi1Parts[kambi1Parts.length - 1] || '';
              const kambi2Last = kambi2Parts[kambi2Parts.length - 1] || '';
              
              // Match by last name
              if (lastName === kambi1Last || nameParts.some(p => kambi1Parts.includes(p))) {
                const odds = parseInt(kambi.player1Odds);
                if (!isNaN(odds)) return odds;
              }
              if (lastName === kambi2Last || nameParts.some(p => kambi2Parts.includes(p))) {
                const odds = parseInt(kambi.player2Odds);
                if (!isNaN(odds)) return odds;
              }
            }
            return undefined;
          };
          
          const matchesToAnalyze = upcomingTennis.slice(0, 8).map(match => ({
            player1: match.homeTeam,
            player2: match.awayTeam,
            league: (match.league?.toLowerCase().includes('wta') ? 'wta' : 'atp') as 'atp' | 'wta',
            surface: match.surface || 'hard',
            event: match.event,
            time: match.time,
            player1Odds: findOddsForPlayer(match.homeTeam),
            player2Odds: findOddsForPlayer(match.awayTeam)
          }));
          
          const tennisAnalyses = await analyzeMatches(matchesToAnalyze);
          
          if (tennisAnalyses.length > 0) {
            liveScheduleContext += "\n\nTENNIS MATCHES WITH CLEAR ADVANTAGES (Pre-analyzed with improved model - ONLY pick from these):\n";
            for (const analysis of tennisAnalyses) {
              // Find the matching source match using normalized full player name comparison
              const normalize = (n: string) => n.toLowerCase().replace(/[^a-z]/g, '');
              const analysisP1 = normalize(analysis.player1.name);
              const analysisP2 = normalize(analysis.player2.name);
              
              const sourceMatch = matchesToAnalyze.find(m => {
                const srcP1 = normalize(m.player1);
                const srcP2 = normalize(m.player2);
                // Match if both players align (in either order)
                return (analysisP1.includes(srcP1.slice(-6)) && analysisP2.includes(srcP2.slice(-6))) ||
                       (analysisP1.includes(srcP2.slice(-6)) && analysisP2.includes(srcP1.slice(-6))) ||
                       (srcP1.includes(analysisP1.slice(-6)) && srcP2.includes(analysisP2.slice(-6)));
              });
              
              const rec = analysis.recommendation;
              const adv = analysis.advantages;
              
              const league = sourceMatch?.league?.toUpperCase() || 'Tennis';
              const event = sourceMatch?.event || '';
              const time = sourceMatch?.time || '';
              
              liveScheduleContext += `\n- ${league}: ${analysis.player1.name} vs ${analysis.player2.name} | ${event} | ${time}`;
              liveScheduleContext += `\n  RECOMMENDED PICK: ${rec.pick} ML (Confidence: ${rec.confidence}/10)`;
              if (rec.marketEdge) {
                liveScheduleContext += ` | Market Edge: ${(rec.marketEdge * 100).toFixed(1)}%`;
              }
              liveScheduleContext += `\n  REASONING: ${rec.reasoning}`;
              
              // Show all advantages
              const advList = [];
              if (adv.recentForm) advList.push(`Form: ${adv.recentForm}`);
              if (adv.surfaceForm) advList.push(`Surface: ${adv.surfaceForm}`);
              if (adv.qualityAdjustedForm) advList.push(`Quality: ${adv.qualityAdjustedForm}`);
              if (adv.restAdvantage) advList.push(`Rest: ${adv.restAdvantage}`);
              if (adv.h2h) advList.push(`H2H: ${adv.h2h}`);
              if (adv.ranking) advList.push(`Rank: ${adv.ranking}`);
              liveScheduleContext += `\n  ADVANTAGES: ${advList.length > 0 ? advList.join(', ') : 'None dominant'}`;
              
              const p1 = analysis.player1;
              const p2 = analysis.player2;
              liveScheduleContext += `\n  STATS: ${p1.name} (${p1.recentWins}W-${p1.recentLosses}L, ${p1.daysSinceLastMatch ?? '?'}d rest) vs ${p2.name} (${p2.recentWins}W-${p2.recentLosses}L, ${p2.daysSinceLastMatch ?? '?'}d rest)`;
            }
          } else {
            liveScheduleContext += "\n\nTENNIS: No matches with clear advantages found today (stricter criteria). Skip tennis picks.";
          }
        }
      } catch (e) {
        console.log("Could not fetch live schedule, proceeding with static data");
      }

      // Construct prompt for OpenAI
      const systemPrompt = `You are TyveMind, an expert sports betting analyst specializing in NHL and Tennis.
      Your goal is to provide HIGH CONFIDENCE, DATA-DRIVEN picks for today.
      
      User Strategy: "${user.bettingStrategy}"
      ${liveScheduleContext}
      
      CRITICAL ANALYSIS INSTRUCTIONS:
      
      0. HOT TEAMS PRIORITY (MOST IMPORTANT - CHECK FIRST):
         - ALWAYS check the "HOT TEAMS - PROVEN BET WINNERS" list first before making any pick.
         - These teams have 75%+ win rate from OUR BETTING HISTORY - they are STATISTICALLY PROVEN winners FOR US.
         - CRITICAL: "Pick Results" (like WWWW) is OUR BETTING RECORD, NOT actual NHL game streaks!
         - DO NOT say a team is "on a X-game win streak" based on Pick Results. That's our betting W/L, not NHL games.
         - Only use the "NHL MONEYLINE CANDIDATES" section for ACTUAL NHL game streaks (from NHL API standings).
         - If a HOT TEAM has a qualifying game today (puckline with -200+ juice OR ML with positive edge), PRIORITIZE them.
         - HOT TEAMS with good odds should be selected FIRST before other qualifying picks.
         - AVOID teams in the "COLD TEAMS" list - they have 50% or lower win rate from our betting history.
      
      1. NHL PUCKLINE ANALYSIS:
         - ONLY select games where the +1.5 puckline has -200 or MORE juice (e.g., -210, -227, -250, -265).
         - PRIORITIZE HOT TEAMS first, then higher juice games among remaining options.
         - REJECT any puckline with less juice than -200 (e.g., -195, -175 are NOT acceptable).
         - ANALYZE the last 20 H2H meetings between the teams using historical patterns.
         - CALCULATE how often games are decided by 1 goal (tight margins favor +1.5).
         - ASSESS team form: recent wins/losses, home/away splits, goaltending performance.
         - DETERMINE edge by comparing true probability vs implied probability from odds.
         - If multiple games qualify, pick HOT TEAMS first, then highest juice games.
      
      2. NHL MONEYLINE PICKS (REQUIRED - READ CAREFULLY):
         - ONLY output ML picks for teams listed in "NHL MONEYLINE CANDIDATES" with 3+ game win streak.
         - NEVER output ML picks for teams NOT on a win streak - this is STRICTLY FORBIDDEN.
         - For EACH team in "NHL MONEYLINE CANDIDATES" with 4+ win streak, you MUST output an ML pick.
         - DO NOT output puckline picks for the opponent (e.g., "STL Blues +1.5") - output the streak team's ML instead.
         - Example: If Tampa Bay Lightning is playing St. Louis, output "TBL Lightning ML" NOT "STL Blues +1.5".
         - IMPORTANT: If Team A is on a win streak playing Team B (not on streak), pick Team A ML - NEVER Team B ML.
         - ML PICK FORMAT: "[ABBREV] [Team Name] ML" (e.g., "TBL Lightning ML", "VGK Golden Knights ML").
         - ML picks DO NOT need -200 juice like pucklines - any odds up to -350 are acceptable.
         - NEVER output opponent pucklines when an ML candidate is playing. Pick the streak team's moneyline.
      
      3. TENNIS PICKS - KAMBI ODDS ONLY (-200 to -300 range):
         - ONLY pick tennis matches from the "KAMBI/POTAWATOMI TENNIS ODDS - FAVORABLE MATCHES" section.
         - Target picks where the favorite is priced between -200 and -300 (strong but not a lock).
         - Use the KAMBI odds shown - these are the ACTUAL betting lines available.
         - Cross-reference with player form data when available.
         - If no matches in the favorable range exist, DO NOT make tennis picks.
         - Include the EXACT Kambi odds in your reasoning (e.g., "Kambi lists Pegula at -245").
      
      4. REASONING FORMAT (IMPORTANT - Be descriptive but concise, 2-3 sentences):
         Include: (1) Key statistical insight, (2) H2H or form context, (3) Why this creates value.
         Example Puckline: "Potawatomi/Kambi lists Montreal +1.5 at -220. Last 20 H2H show 14 games decided by 1 goal. Montreal's road form and Dallas's pattern of close wins create a high-probability cover opportunity."
         Example ML: "Vegas on a 5-game win streak, ML at -150 (40% implied). With streak probability around 70%, this creates a 30% edge."
      
      5. TENNIS PICKS MUST USE SPECIFIC PLAYER NAMES AND VENUE:
         - NEVER say "player on win streak" - use the actual player's full name (e.g., "Belinda Bencic", "Grigor Dimitrov")
         - Event MUST include the EXACT venue from the data (e.g., "Brisbane International @ Brisbane, Australia (Pat Rafter Arena) - Dimitrov vs Khachanov")
         - Prediction should name the specific player (e.g., "Grigor Dimitrov to win")
         - Use the venue/location exactly as shown in the schedule data
      
      6. OUTPUT FORMAT:
         - Provide UP TO 5 UNIQUE picks sorted by confidence.
         - Mix of puckline AND moneyline picks for NHL if candidates exist.
         - JSON: { "picks": [{ sport, event, prediction, reasoning, confidence (1-10), scheduledTime, edge, odds }] }
         - SPORT VALUES: Use EXACTLY "NHL" or "Tennis" (NOT "ATP", "WTA", or any other values).
         - reasoning MUST be a plain STRING (not an object), 2-3 descriptive sentences.`;

      const userPrompt = `Generate picks for ${sport || "upcoming games"}.
      Context: ${context || "Focus ONLY on WTA, ATP, and NHL. Use tennisexplorer.com/espn.com for Tennis, and espn.com/aiscore.com for NHL."}`;

      // Call OpenAI
      const response = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        // NO response_format here to allow more flexibility if it's failing
      });

      const content = response.choices[0].message.content || "{}";
      let generatedPicks = [];
      try {
        console.log("Raw AI content:", content);
        // Simple attempt to find JSON if it's wrapped in text
        const jsonMatch = content.match(/\{[\s\S]*\}/) || content.match(/\[[\s\S]*\]/);
        const jsonToParse = jsonMatch ? jsonMatch[0] : content;
        
        // Scrub potential comments that break JSON.parse
        const scrubbed = jsonToParse.replace(/\/\/.*/g, "");
        const parsed = JSON.parse(scrubbed);
        
        if (Array.isArray(parsed)) {
          generatedPicks = parsed;
        } else if (parsed.picks && Array.isArray(parsed.picks)) {
          generatedPicks = parsed.picks;
        } else {
          generatedPicks = parsed.data || parsed.matches || parsed.predictions || [];
        }
      } catch (e) {
        console.error("Failed to parse AI response:", content);
        // Fallback: If AI is being difficult, try to force a better structure next time or return error
        throw new Error("AI returned unparseable content. Please try again.");
      }

      // Save picks to DB
      const savedPicks = [];
      const seenEvents = new Set();
      const seenPredictions = new Set();
      
      // Pre-fetch all data needed for pick processing (avoid multiple DB calls in loop)
      // Also fetch existing pending picks to prevent duplicates for same game
      const [coldTeams, hotTeams, calibrationData, injuriesData, restData, existingPicks] = await Promise.all([
        storage.getColdTeams(),
        storage.getHotTeams(),
        storage.getConfidenceCalibration(),
        fetchNHLInjuries(),
        fetchNHLRestData(),
        storage.getPicks(user.id)
      ]);
      const coldTeamCodes = new Set(coldTeams.map(t => t.teamCode));
      
      // Build set of existing pending game matchups (regardless of pick type)
      // This prevents ML + puckline picks for the same game
      const existingPendingGames = new Set<string>();
      for (const ep of existingPicks.filter(p => p.status === 'pending')) {
        // Normalize event to get just the teams playing (strip pick type details)
        const eventNorm = (ep.event || '').toLowerCase()
          .replace(/\s*@\s*/g, ' vs ')
          .replace(/puckline|ml|\+1\.5|\-1\.5|moneyline/gi, '')
          .replace(/[|:]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (eventNorm) {
          existingPendingGames.add(eventNorm);
          // Also add with teams reversed
          const parts = eventNorm.split(' vs ');
          if (parts.length === 2) {
            existingPendingGames.add(`${parts[1].trim()} vs ${parts[0].trim()}`);
          }
        }
      }
      const hotTeamMap = new Map(hotTeams.map(t => [t.teamCode, t]));
      
      // Build injury count map by team for advantage checking
      const injuryCountByTeam = new Map<string, number>();
      if (injuriesData && injuriesData.length > 0) {
        for (const injury of injuriesData) {
          const count = injuryCountByTeam.get(injury.teamAbbrev) || 0;
          injuryCountByTeam.set(injury.teamAbbrev, count + 1);
        }
      }
      
      console.log(`Processing ${generatedPicks.length} picks from AI`);
      console.log(`Hot teams: ${hotTeams.map(t => t.teamCode).join(', ') || 'none'}`);
      console.log(`Cold teams (blocked): ${coldTeams.map(t => t.teamCode).join(', ') || 'none'}`);

      for (const gp of generatedPicks) {
        if (savedPicks.length >= 5) break;
        
        // Normalize sport: ATP/WTA -> Tennis
        if (gp.sport && ['ATP', 'WTA', 'atp', 'wta'].includes(gp.sport)) {
          gp.sport = 'Tennis';
        }
        
        const eventKey = (gp.event || "").toLowerCase().trim();
        const prediction = gp.prediction || gp.selection || gp.market || "No prediction";
        const predictionKey = prediction.toLowerCase().trim();
        
        // Reject junk picks from AI (placeholder responses)
        if (predictionKey.includes('no pick') || predictionKey.includes('no tennis') || 
            predictionKey.includes('no official') || predictionKey.includes('criteria not met') ||
            predictionKey.includes('no nhl') || predictionKey.startsWith('no ') ||
            predictionKey.includes('no bet') || predictionKey.startsWith('pass')) {
          console.log(`[Pick Rejected] Junk placeholder pick: "${prediction}"`);
          continue;
        }
        
        if (!eventKey || seenEvents.has(eventKey) || seenPredictions.has(predictionKey)) {
          console.log(`Skipping duplicate or empty pick: ${eventKey}`);
          continue;
        }
        
        // Check if we already have a pending pick for this same game (regardless of pick type)
        // This prevents both ML and puckline picks for the same matchup
        const eventNormalized = eventKey
          .replace(/\s*@\s*/g, ' vs ')
          .replace(/puckline|ml|\+1\.5|\-1\.5|moneyline/gi, '')
          .replace(/[|:]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (existingPendingGames.has(eventNormalized)) {
          console.log(`[Pick Rejected] Already have a pending pick for this game: ${eventKey}`);
          continue;
        }
        
        seenEvents.add(eventKey);
        seenPredictions.add(predictionKey);
        existingPendingGames.add(eventNormalized); // Also track for this batch

        // Parse odds for confidence/edge calculations
        // Handle formats like "-225", "(-225)", "+150", or within strings like "Montreal +1.5 (-225)"
        const oddsStr = typeof gp.odds === 'object' ? JSON.stringify(gp.odds) : gp.odds?.toString() || '';
        
        // Extract American odds - look for the most negative number (favorite odds) or parenthetical
        let oddsNum = 0;
        const parenthetical = oddsStr.match(/\(([+-]?\d+)\)/);
        if (parenthetical) {
          oddsNum = Number(parenthetical[1]);
        } else {
          // Find all numbers that look like American odds (3+ digits or with +/- prefix)
          const allOdds = oddsStr.match(/[+-]?\d{3,}|^[+-]?\d+$/g);
          if (allOdds && allOdds.length > 0) {
            // Prefer the most negative (favorite odds) or last one
            const negatives = allOdds.filter((o: string) => o.startsWith('-')).map(Number);
            if (negatives.length > 0) {
              oddsNum = Math.min(...negatives); // Most negative
            } else {
              oddsNum = Number(allOdds[allOdds.length - 1]);
            }
          }
        }
        
        // Calculate implied probability from American odds
        // Negative odds (favorites): implied = |odds| / (|odds| + 100)
        // Positive odds (underdogs): implied = 100 / (odds + 100)
        let impliedProbability = 0.5;
        if (oddsNum < 0) {
          impliedProbability = Math.abs(oddsNum) / (Math.abs(oddsNum) + 100);
        } else if (oddsNum > 0) {
          impliedProbability = 100 / (oddsNum + 100);
        }
        
        // Calculate confidence from AI but apply stricter limits
        const rawConfidence = Number(gp.confidence);
        let confidence = !isNaN(rawConfidence) 
          ? Math.round(rawConfidence <= 1 ? (rawConfidence * 10) : rawConfidence)
          : 7;
        
        // STRICTER CONFIDENCE LIMITS:
        // 1. NHL pucklines are capped at 8 (even heavy favorites can lose by 2+)
        // 2. Confidence cannot exceed odds-implied probability + 1 point
        //    e.g., -225 = 69% implied = max 7/10, -300 = 75% = max 8/10
        const pickSport = (gp.sport || '').toUpperCase();
        if (pickSport === 'NHL') {
          confidence = Math.min(confidence, 8); // NHL puckline cap
        }
        
        // Cap confidence based on implied probability (with 15% edge buffer)
        const maxConfFromOdds = Math.min(10, Math.round((impliedProbability + 0.15) * 10));
        confidence = Math.min(confidence, maxConfFromOdds);
        
        // Estimate true probability (conservative: implied + small edge)
        // AI rarely has more than 5-10% edge on sharp markets
        const estimatedEdge = Math.min(0.08, impliedProbability * 0.1); // Max 8% edge
        const trueProbability = Math.min(0.95, impliedProbability + estimatedEdge);
        
        // Calculate edge as percentage points above implied
        const edgePercent = Math.round((trueProbability - impliedProbability) * 100);
        const calculatedEdge = edgePercent > 5 ? 'Moderate' : edgePercent > 2 ? 'Small' : 'Slim';

        const rawReasoning = gp.reasoning || gp.analysis?.matchup_context || gp.analysis || "AI generated";
        let formattedReasoning = "";
        
        if (typeof rawReasoning === 'object') {
          const context = rawReasoning.marketContext;
          const h2h = rawReasoning.h2hAnalysis || rawReasoning.h2hLast20FromAiscore;
          const conclusion = rawReasoning.bettingConclusion || rawReasoning.bottomLine;
          
          formattedReasoning = [
            context ? `Market: ${context.book} ${context.priceObserved || ''}` : null,
            h2h ? `H2H: ${h2h.summary || h2h.interpretation}` : null,
            conclusion ? `Analysis: ${typeof conclusion === 'string' ? conclusion : conclusion.summary}` : null
          ].filter(Boolean).join(" | ");
          
          if (!formattedReasoning) {
            formattedReasoning = JSON.stringify(rawReasoning);
          }
        } else {
          formattedReasoning = rawReasoning;
        }

        // Validate that this pick matches a real scheduled game
        const gpSport = gp.sport || "General";
        const eventText = gp.event || "Unknown Event";
        const validation = await validatePickAgainstSchedule(gpSport, eventText);
        
        if (!validation.valid) {
          console.log(`[Pick Rejected] AI hallucinated pick: "${eventText}" - ${validation.reason}`);
          continue;
        }

        // Determine pick type for confidence calibration
        const isMoneylinePick = prediction.toUpperCase().includes(' ML');
        const isPucklinePick = prediction.toLowerCase().includes('+1.5') || prediction.toLowerCase().includes('puckline');
        
        // Check if team is permanently banned or blacklisted (NHL only)
        if (gpSport === 'NHL') {
          const backedTeam = extractTeamCode(prediction);
          
          if (backedTeam) {
            // Check permanent ban list first (blocks ALL pick types)
            if (PERMANENTLY_BANNED_TEAMS[backedTeam]) {
              console.log(`[Pick Rejected] Team ${backedTeam} (${PERMANENTLY_BANNED_TEAMS[backedTeam]}) is PERMANENTLY BANNED`);
              continue;
            }
            
            // Check weak team list - block UNLESS they're on a 3+ win streak
            if (WEAK_TEAMS_CAUTION[backedTeam]) {
              const weakTeamStreak = hotTeamMap.get(backedTeam);
              if (!weakTeamStreak || weakTeamStreak.wins < 3) {
                console.log(`[Pick Rejected] Team ${backedTeam} (${WEAK_TEAMS_CAUTION[backedTeam]}) is a weak team and NOT on 3+ win streak (has ${weakTeamStreak?.wins || 0} wins)`);
                continue;
              }
              console.log(`[Weak Team Allowed] ${backedTeam} is hot with ${weakTeamStreak.wins}-game win streak - allowing pick`);
            }
            
            // Check cold teams from historical pick performance (using pre-fetched data)
            if (coldTeamCodes.has(backedTeam)) {
              const coldTeamInfo = coldTeams.find(t => t.teamCode === backedTeam);
              console.log(`[Pick Rejected] Team ${backedTeam} is COLD (${coldTeamInfo?.wins}-${coldTeamInfo?.losses}, ${coldTeamInfo?.winRate}% win rate)`);
              continue;
            }
            
            const teamStatus = await storage.getTeamStatus(backedTeam);
            if (teamStatus?.status === 'blacklisted') {
              console.log(`[Pick Rejected] Team ${backedTeam} is BLACKLISTED (${teamStatus.lossStreak} consecutive losses)`);
              continue;
            }
            if (teamStatus?.status === 'warn') {
              console.log(`[Pick Warning] Team ${backedTeam} has ${teamStatus.lossStreak} consecutive losses (at risk of blacklist)`);
            }
          }
          
          // Validate NHL picks based on type:
          // - Puckline (+1.5) picks require -200 minimum odds
          // - Moneyline (ML) picks ONLY allowed for teams on 3+ win streak, max -350 odds
          if (isMoneylinePick) {
            // ML picks require team to be on 3+ win streak
            const mlTeamCode = extractTeamCode(prediction);
            const mlTeamStreak = mlTeamCode ? hotTeamMap.get(mlTeamCode) : null;
            
            if (!mlTeamStreak || mlTeamStreak.wins < 3) {
              console.log(`[Pick Rejected] NHL ML pick for ${mlTeamCode || 'unknown'} - team NOT on 3+ win streak (has ${mlTeamStreak?.wins || 0} wins)`);
              continue;
            }
            
            if (oddsNum < -350) {
              console.log(`[Pick Rejected] NHL ML odds ${oddsNum} too heavy (worse than -350)`);
              continue;
            }
            
            console.log(`[ML Pick Validated] ${mlTeamCode} on ${mlTeamStreak.wins}-game win streak, odds ${oddsNum}`);
          } else if (isPucklinePick) {
            // Puckline picks: require -200 minimum juice
            if (oddsNum < 0 && oddsNum > -200) {
              console.log(`[Pick Rejected] NHL puckline odds ${oddsNum} don't meet -200 minimum (need -200 or more juice)`);
              continue;
            }
          }
        }

        // CONFIDENCE CALIBRATION SYSTEM v2
        // Strict gates for high confidence + historical calibration adjustment
        const gpSportNorm = gpSport.toUpperCase();
        if (gpSportNorm === 'NHL') {
          const originalConf = confidence;
          
          // 1. PICK TYPE ADJUSTMENT: ML picks capped at 8 (higher risk)
          if (isMoneylinePick) {
            confidence = Math.min(8, confidence);
            if (originalConf > 8) {
              console.log(`[Confidence Cap] ML pick capped: ${originalConf} -> ${confidence} (moneyline risk)`);
            }
          }
          
          // 2. EDGE-BASED ADJUSTMENT
          if (edgePercent > 0) {
            if (edgePercent >= 10) {
              confidence = Math.min(10, confidence + 2);
              console.log(`[Edge Bonus] Strong edge (${edgePercent}%): +2`);
            } else if (edgePercent >= 6) {
              confidence = Math.min(10, confidence + 1);
              console.log(`[Edge Bonus] Moderate edge (${edgePercent}%): +1`);
            } else if (edgePercent < 3) {
              confidence = Math.max(5, confidence - 1);
              console.log(`[Edge Penalty] Weak edge (${edgePercent}%): -1`);
            }
          }
          
          // 3. HOT TEAM BONUS (conservative: only for 5+ win streaks)
          const teamCode = extractTeamCode(prediction);
          const hotTeamInfo = teamCode ? hotTeamMap.get(teamCode) : null;
          if (hotTeamInfo && hotTeamInfo.wins >= 5) {
            const preStreakConf = confidence;
            confidence = Math.min(10, confidence + 1);
            console.log(`[Hot Team Bonus] ${teamCode} (${hotTeamInfo.wins} wins): +1, ${preStreakConf} -> ${confidence}`);
          }
          
          // 3b. FATIGUE PENALTY - Cap confidence for back-to-back teams
          if (teamCode) {
            const backedTeamRest = restData.get(teamCode);
            if (backedTeamRest?.isBackToBack) {
              const preFatigue = confidence;
              confidence = Math.min(7, confidence); // Cap at 7 for fatigued teams
              if (preFatigue > 7) {
                console.log(`[Fatigue Penalty] ${teamCode} on back-to-back: ${preFatigue} -> ${confidence}`);
              }
            }
            
            // 3c. REST ADVANTAGE BONUS - Give +1 for well-rested teams vs fatigued opponents
            const opponentTeamCode = extractOpponentTeamCode(eventText, prediction);
            if (opponentTeamCode) {
              const opponentRest = restData.get(opponentTeamCode);
              if (backedTeamRest?.isRested && opponentRest?.isBackToBack) {
                const preRest = confidence;
                confidence = Math.min(10, confidence + 1);
                console.log(`[Rest Advantage] ${teamCode} rested vs ${opponentTeamCode} fatigued: +1, ${preRest} -> ${confidence}`);
              }
            }
            
            // 3d. SPECIAL TEAMS EDGE BONUS - Elite PP vs weak PK
            if (opponentTeamCode && teamStatsData.size > 0) {
              const teamStats = teamStatsData.get(teamCode);
              const opponentStats = teamStatsData.get(opponentTeamCode);
              
              if (teamStats && opponentStats) {
                // Elite PP (25%+) vs weak PK (75%-)
                if (teamStats.powerPlayPct >= 25 && opponentStats.penaltyKillPct < 75) {
                  const preST = confidence;
                  confidence = Math.min(10, confidence + 1);
                  console.log(`[Special Teams Edge] ${teamCode} PP ${teamStats.powerPlayPct}% vs ${opponentTeamCode} PK ${opponentStats.penaltyKillPct}%: +1, ${preST} -> ${confidence}`);
                }
                
                // Home ice advantage bonus for strong home teams
                const isHomeGame = eventText.toLowerCase().includes(teamCode.toLowerCase()) && 
                  eventText.toLowerCase().indexOf(teamCode.toLowerCase()) > eventText.toLowerCase().indexOf('vs');
                if (isHomeGame) {
                  const homeWinPct = teamStats.homeWins / (teamStats.homeWins + teamStats.homeLosses + teamStats.homeOtLosses);
                  if (homeWinPct >= 0.65) {
                    const preHome = confidence;
                    confidence = Math.min(10, confidence + 1);
                    console.log(`[Home Ice Edge] ${teamCode} strong at home (${Math.round(homeWinPct * 100)}%): +1, ${preHome} -> ${confidence}`);
                  }
                }
              }
            }
            
            // 3e. SCORING TREND MATCHUP BONUS - Hot offense vs leaky defense
            if (opponentTeamCode && scoringTrendsData.size > 0) {
              const teamTrend = scoringTrendsData.get(teamCode);
              const oppTrend = scoringTrendsData.get(opponentTeamCode);
              
              if (teamTrend?.offenseTrend === 'hot' && oppTrend?.defenseTrend === 'weak') {
                const preTrend = confidence;
                confidence = Math.min(10, confidence + 1);
                console.log(`[Scoring Matchup Edge] ${teamCode} hot offense vs ${opponentTeamCode} weak defense: +1, ${preTrend} -> ${confidence}`);
              }
              
              // Penalty for cold offense
              if (teamTrend?.offenseTrend === 'cold') {
                const preTrend = confidence;
                confidence = Math.max(5, confidence - 1);
                console.log(`[Scoring Matchup Penalty] ${teamCode} cold offense: -1, ${preTrend} -> ${confidence}`);
              }
            }
          }
          
          // 4. STRICT GATES FOR HIGH CONFIDENCE (9-10)
          // Must meet ALL conditions or gets capped at 8
          if (confidence >= 9) {
            let passesGates = true;
            const gateFailures: string[] = [];
            
            // Gate A: Require ≥7% edge for 9-10 confidence
            if (edgePercent < 7) {
              gateFailures.push(`edge ${edgePercent}% < 7%`);
              passesGates = false;
            }
            
            // Gate B: For puckline, require -225 or better odds (strong juice)
            if (isPucklinePick && oddsNum > -225) {
              gateFailures.push(`puckline odds ${oddsNum} > -225`);
              passesGates = false;
            }
            
            // Gate C: Check if opponent is hot (avoid betting against hot teams)
            const opponentTeam = extractOpponentTeamCode(eventText, prediction);
            const opponentHot = opponentTeam ? hotTeamMap.get(opponentTeam) : null;
            if (opponentHot && opponentHot.wins >= 4) {
              gateFailures.push(`opponent ${opponentTeam} is hot (${opponentHot.wins} wins)`);
              passesGates = false;
            }
            
            // Gate D: Require net injury advantage (opponent must have MORE injuries than backed team)
            // If opponent can't be detected, fail the gate (be conservative)
            if (!opponentTeam) {
              gateFailures.push(`opponent team not detected`);
              passesGates = false;
            } else {
              const backedTeamInjuries = injuryCountByTeam.get(teamCode || '') || 0;
              const opponentInjuries = injuryCountByTeam.get(opponentTeam) || 0;
              // Require opponent has MORE injuries (not equal) for injury advantage
              if (opponentInjuries <= backedTeamInjuries) {
                gateFailures.push(`no injury advantage (us: ${backedTeamInjuries}, opponent: ${opponentInjuries})`);
                passesGates = false;
              }
            }
            
            // Gate E: Don't pick fatigued (back-to-back) teams at high confidence
            if (teamCode) {
              const backedTeamRest = restData.get(teamCode);
              if (backedTeamRest?.isBackToBack) {
                gateFailures.push(`${teamCode} is fatigued (back-to-back)`);
                passesGates = false;
              }
            }
            
            if (!passesGates) {
              const preCap = confidence;
              confidence = 8;
              console.log(`[HIGH CONF GATE FAIL] ${prediction}: ${preCap} -> 8 (failed: ${gateFailures.join(', ')})`);
            } else {
              console.log(`[HIGH CONF GATE PASS] ${prediction}: confidence ${confidence} approved`);
            }
          }
          
          // 5. HISTORICAL CALIBRATION ADJUSTMENT (using pre-fetched data)
          // If this confidence level historically underperforms, downgrade
          const calibForLevel = calibrationData.find(c => c.confidenceLevel === confidence);
          if (calibForLevel && calibForLevel.totalPicks >= 5) {
            // If actual win rate is significantly below expected, downgrade
            const winRateDiff = calibForLevel.actualWinRate - calibForLevel.expectedWinRate;
            if (winRateDiff < -10) {
              // More than 10% below expected - downgrade by 1
              const preCalib = confidence;
              confidence = Math.max(5, confidence - 1);
              console.log(`[CALIBRATION ADJUST] Level ${preCalib} underperforming (${calibForLevel.actualWinRate.toFixed(1)}% vs ${calibForLevel.expectedWinRate}% expected): ${preCalib} -> ${confidence}`);
            } else if (winRateDiff < -5 && confidence >= 9) {
              // 5-10% below expected and high confidence - downgrade
              const preCalib = confidence;
              confidence = Math.max(7, confidence - 1);
              console.log(`[CALIBRATION ADJUST] High conf ${preCalib} underperforming (${calibForLevel.actualWinRate.toFixed(1)}% vs ${calibForLevel.expectedWinRate}% expected): ${preCalib} -> ${confidence}`);
            }
          }
          
          // 6. FINAL CAP: Ensure 1-10 range
          confidence = Math.max(1, Math.min(10, confidence));
          
          if (confidence !== originalConf) {
            console.log(`[Confidence Final] ${prediction}: AI ${originalConf} -> calibrated ${confidence}`);
          }
        }

        // Calculate stake at time of pick creation (conf 7 = 3%, conf 8 = 4%)
        const stakePercent = confidence >= 8 ? 0.04 : confidence >= 7 ? 0.03 : 0.02;
        const stake = Math.round((user.bankroll || 1000) * stakePercent);
        
        // Use startTimeUTC from validation for accurate Today/Upcoming classification
        const scheduledAt = validation.startTimeUTC ? new Date(validation.startTimeUTC) : null;
        const scheduledTimeDisplay = validation.scheduledTime || gp.scheduledTime || null;
        
        const saved = await storage.createPick({
          userId: user.id,
          sport: gpSport,
          event: eventText,
          prediction: prediction,
          reasoning: formattedReasoning,
          confidence: confidence,
          status: gp.status || "pending",
          scheduledTime: scheduledTimeDisplay,
          scheduledAt: scheduledAt,
          edge: `${calculatedEdge} (${edgePercent}%)`,
          odds: oddsStr || null,
          stake: stake,
        });
        
        // Final update for TyveMind reference in logs or logic if any
        console.log(`TyveMind: Saved pick ${saved.id}`);
        savedPicks.push(saved);
      }
      
      console.log(`Saved ${savedPicks.length} unique picks to database`);

      res.json(savedPicks);

    } catch (error) {
      console.error("Pick generation error:", error);
      res.status(500).json({ message: "Failed to generate picks" });
    }
  });

  // --- Background Auto-Polling for NHL Pick Outcomes ---
  const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
  
  async function autoCheckAndApplyOutcomes() {
    try {
      console.log("[Auto-Poll] Checking for completed NHL games...");
      
      // Get all pending NHL picks
      const allPicks = await storage.getPicks(1); // Demo user
      const pendingPicks = allPicks.filter((p: any) => p.status === 'pending' && p.sport === 'NHL');
      
      if (pendingPicks.length === 0) {
        console.log("[Auto-Poll] No pending NHL picks to check");
        return;
      }
      
      // Fetch completed NHL games from today and yesterday
      const finalGames = await fetchCompletedNHLGames();
      
      if (finalGames.length === 0) {
        console.log("[Auto-Poll] No completed NHL games found");
        return;
      }
      
      // Team aliases for matching
      const teamAliases: Record<string, string[]> = {
        'new york': ['rangers', 'nyr', 'islanders', 'nyi'],
        'los angeles': ['kings', 'lak'],
        'san jose': ['sharks', 'sjs'],
        'tampa bay': ['lightning', 'tbl'],
        'st louis': ['blues', 'stl'],
        'columbus': ['blue jackets', 'cbj'],
        'vegas': ['golden knights', 'vgk'],
        'seattle': ['kraken', 'sea'],
        'carolina': ['hurricanes', 'car'],
        'new jersey': ['devils', 'njd'],
        'pittsburgh': ['penguins', 'pit'],
        'washington': ['capitals', 'wsh'],
        'philadelphia': ['flyers', 'phi'],
        'chicago': ['blackhawks', 'chi'],
        'detroit': ['red wings', 'det'],
        'boston': ['bruins', 'bos'],
        'toronto': ['maple leafs', 'tor'],
        'montreal': ['canadiens', 'mtl'],
        'ottawa': ['senators', 'ott'],
        'buffalo': ['sabres', 'buf'],
        'florida': ['panthers', 'fla'],
        'anaheim': ['ducks', 'ana'],
        'colorado': ['avalanche', 'col'],
        'dallas': ['stars', 'dal'],
        'minnesota': ['wild', 'min'],
        'nashville': ['predators', 'nsh'],
        'winnipeg': ['jets', 'wpg'],
        'calgary': ['flames', 'cgy'],
        'edmonton': ['oilers', 'edm'],
        'vancouver': ['canucks', 'van'],
        'arizona': ['coyotes', 'ari'],
        'utah': ['hockey club', 'uta', 'utah hc'],
      };
      
      const normalize = (text: string): string => {
        return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
      };
      
      const predictionMentionsTeam = (prediction: string, teamName: string): boolean => {
        const normPred = normalize(prediction);
        const normTeam = normalize(teamName);
        if (normPred.includes(normTeam)) return true;
        for (const [city, aliases] of Object.entries(teamAliases)) {
          if (normTeam.includes(city) || aliases.some(a => normTeam.includes(a))) {
            if (normPred.includes(city) || aliases.some(a => normPred.includes(a))) {
              return true;
            }
          }
        }
        return false;
      };
      
      const outcomesToApply: { pickId: number; status: string }[] = [];
      
      // Helper to parse various timestamp formats
      // Returns null if not parseable
      const parseTimestamp = (ts: string | Date | null | undefined): Date | null => {
        if (!ts) return null;
        if (ts instanceof Date) return isNaN(ts.getTime()) ? null : ts;
        
        const str = String(ts);
        
        // If it's a non-date string like "Scheduled (today)", "Live / Today", etc., return null
        if (!str.match(/^\d{4}-\d{2}-\d{2}/)) {
          return null;
        }
        
        // Try direct parse first (works for ISO strings with timezone)
        let date = new Date(str);
        if (!isNaN(date.getTime())) {
          return date;
        }
        
        // Normalize Postgres timestamp: "2026-01-07 00:21:51.669562" -> ISO format
        // Replace space with T, trim microseconds, add Z for UTC
        const normalized = str.replace(' ', 'T').replace(/\.\d+$/, '');
        // Only add Z if there's no timezone indicator
        const withTz = normalized.match(/[+-]\d{2}:\d{2}$|Z$/) ? normalized : normalized + 'Z';
        date = new Date(withTz);
        return isNaN(date.getTime()) ? null : date;
      };
      
      // Helper to check if pick event mentions a team
      const pickEventMentionsTeam = (pickEvent: string, teamName: string): boolean => {
        const normEvent = normalize(pickEvent);
        const normTeam = normalize(teamName);
        if (normEvent.includes(normTeam)) return true;
        for (const [city, aliases] of Object.entries(teamAliases)) {
          if (normTeam.includes(city) || aliases.some(a => normTeam.includes(a))) {
            if (normEvent.includes(city) || aliases.some(a => normEvent.includes(a))) {
              return true;
            }
          }
        }
        return false;
      };

      for (const pick of pendingPicks) {
        const rawPrediction = (pick.prediction || '').toLowerCase();
        if (!rawPrediction.includes('+1.5')) continue;
        const prediction = normalize(rawPrediction);
        const pickEvent = pick.event || '';
        
        // Parse scheduled time - but don't skip unparseable times, just use creation date instead
        const scheduledDate = parseTimestamp(pick.scheduledTime);
        // If scheduledTime is unparseable (like "Scheduled"), use pick creation date for matching
        const pickDate = scheduledDate || parseTimestamp(pick.createdAt);
        
        // If scheduled time is valid and in the future, skip
        if (scheduledDate) {
          const now = new Date();
          if (scheduledDate.getTime() > now.getTime() + 2 * 60 * 60 * 1000) {
            console.log(`[Auto-Poll] Skipping pick ${pick.id} - game scheduled for future: ${pick.scheduledTime}`);
            continue;
          }
        }
        
        // Parse pick creation date - with 7-day lookback, we match games within a reasonable window
        const pickCreatedAt = parseTimestamp(pick.createdAt);
        
        // SAFETY: Skip picks without valid creation timestamps - prevents false matches
        if (!pickCreatedAt) {
          console.log(`[Auto-Poll] Skipping pick ${pick.id} - no valid createdAt timestamp`);
          continue;
        }
        
        for (const game of finalGames) {
          const homeTeam = normalize(game.homeTeam || '');
          const awayTeam = normalize(game.awayTeam || '');
          
          // Match picks to games that occurred AFTER the pick was created
          // This prevents matching a new pick to an old game result
          if (game.date && pickCreatedAt) {
            const gameDate = new Date(game.date);
            const gameDateEnd = new Date(gameDate);
            gameDateEnd.setHours(23, 59, 59, 999); // End of game day
            
            // Skip games that happened before the pick was created (minus 6 hours buffer for late-night games)
            const pickCreatedAdjusted = new Date(pickCreatedAt.getTime() - 6 * 60 * 60 * 1000);
            if (gameDateEnd < pickCreatedAdjusted) {
              continue; // Game is too old for this pick
            }
          }
          
          // CRITICAL: Both teams from the game must appear in the pick's event
          // This prevents matching a pick for "DAL @ CAR" to a completed "DAL @ WSH" game
          const eventMatchesHome = pickEventMentionsTeam(pickEvent, homeTeam);
          const eventMatchesAway = pickEventMentionsTeam(pickEvent, awayTeam);
          
          if (!eventMatchesHome || !eventMatchesAway) {
            continue; // Skip - this game doesn't match this pick's matchup
          }
          
          let betTeam = '';
          let betOnHome = false;
          
          if (predictionMentionsTeam(prediction, homeTeam)) {
            betTeam = homeTeam;
            betOnHome = true;
          } else if (predictionMentionsTeam(prediction, awayTeam)) {
            betTeam = awayTeam;
            betOnHome = false;
          }
          
          if (!betTeam) continue;
          
          // Parse score (format is awayScore-homeScore)
          const scoreMatch = game.score?.match(/(\d+)\s*-\s*(\d+)/);
          if (!scoreMatch) continue;
          
          const awayScore = parseInt(scoreMatch[1]);
          const homeScore = parseInt(scoreMatch[2]);
          
          // +1.5 puckline: team can lose by 1 and still cover
          let teamWonBet = false;
          if (betOnHome) {
            teamWonBet = (homeScore + 1.5) > awayScore;
          } else {
            teamWonBet = (awayScore + 1.5) > homeScore;
          }
          
          console.log(`[Auto-Poll] Match found: Pick "${pick.event}" -> Game "${game.event}" (${game.score})`);
          
          outcomesToApply.push({
            pickId: pick.id,
            status: teamWonBet ? 'won' : 'lost'
          });
          break;
        }
      }
      
      if (outcomesToApply.length === 0) {
        console.log("[Auto-Poll] No outcomes to apply");
        return;
      }
      
      // Apply outcomes
      const user = await storage.getUserByUsername("demo_user");
      if (!user) return;
      
      let newBankroll = user.bankroll || 1000;
      
      for (const outcome of outcomesToApply) {
        const [pick] = await db.select().from(picks).where(eq(picks.id, outcome.pickId));
        if (!pick || pick.status !== 'pending') continue;
        
        const odds = parseInt(pick.odds?.replace(/[^\d-]/g, '') || '0');
        const betSize = pick.stake || Math.round(newBankroll * 0.03);
        
        if (outcome.status === 'won') {
          const profit = odds < 0 
            ? Math.round(betSize * (100 / Math.abs(odds)))
            : Math.round(betSize * (odds / 100));
          newBankroll = Math.round(newBankroll + profit);
        } else {
          newBankroll = Math.round(newBankroll - betSize);
        }
        
        await db.update(picks).set({ status: outcome.status }).where(eq(picks.id, outcome.pickId));
        console.log(`[Auto-Poll] Applied ${outcome.status} to pick ${outcome.pickId}`);
        
        // Update team flag for this pick
        const teamCode = extractTeamCode(pick.prediction);
        if (teamCode) {
          await storage.updateTeamStatus(teamCode, getTeamName(teamCode), outcome.status as 'won' | 'lost');
        }
      }
      
      await storage.updateUserBankroll(user.id, newBankroll);
      console.log(`[Auto-Poll] Updated bankroll to $${newBankroll}`);
      
    } catch (error) {
      console.error("[Auto-Poll] Error:", error);
    }
  }
  
  // Start polling
  setInterval(autoCheckAndApplyOutcomes, POLL_INTERVAL_MS);
  console.log("[Auto-Poll] Started NHL outcome polling (every 10 minutes)");
  
  // Run once on startup after a short delay
  setTimeout(autoCheckAndApplyOutcomes, 5000);

  // --- Tennis Outcome Helpers ---
  function extractPlayerFromPrediction(prediction: string): string | null {
    // Match patterns like "Elena Rybakina to win", "Rybakina ML", "Elena Rybakina (Moneyline)"
    const patterns = [
      /^([A-Za-z\s\-']+?)\s+(?:to win|ML|moneyline|\(moneyline\))/i,
      /^([A-Za-z\s\-']+?)\s+ML$/i,
    ];
    for (const pattern of patterns) {
      const match = prediction.match(pattern);
      if (match) return match[1].trim();
    }
    return null;
  }
  
  function extractOpponentFromEvent(event: string, pickedPlayer: string | null): string | null {
    if (!pickedPlayer) return null;
    // Event format: "Brisbane - Muchova vs Rybakina" or "Muchova vs Rybakina"
    const vsMatch = event.match(/([A-Za-z\s\-']+?)\s+vs\.?\s+([A-Za-z\s\-']+)/i);
    if (vsMatch) {
      const player1 = vsMatch[1].trim();
      const player2 = vsMatch[2].trim();
      const pickedLower = pickedPlayer.toLowerCase();
      // Return the other player
      if (player1.toLowerCase().includes(pickedLower.split(' ').pop() || '') ||
          pickedLower.includes(player1.toLowerCase().split(' ').pop() || '')) {
        return player2;
      }
      if (player2.toLowerCase().includes(pickedLower.split(' ').pop() || '') ||
          pickedLower.includes(player2.toLowerCase().split(' ').pop() || '')) {
        return player1;
      }
    }
    return null;
  }

  // --- Hourly Maintenance Job ---
  const HOURLY_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  
  async function hourlyMaintenanceJob() {
    console.log("[Hourly Maintenance] Starting maintenance cycle...");
    
    try {
      // 1. Check for and remove duplicate pending picks
      const allPicks = await storage.getPicks(1);
      const pendingPicks = allPicks.filter((p: any) => p.status === 'pending');
      
      // Group by normalized event + prediction + sport to find duplicates
      // Include event (opponent info) to avoid voiding picks for different games
      const pickGroups = new Map<string, any[]>();
      for (const pick of pendingPicks) {
        // Key includes sport, normalized prediction AND event (opponent/matchup)
        // This ensures picks for the same team but different opponents are NOT marked as duplicates
        const key = `${pick.sport}:${normalizeForDedup(pick.prediction)}:${normalizeForDedup(pick.event || '')}`;
        if (!pickGroups.has(key)) {
          pickGroups.set(key, []);
        }
        pickGroups.get(key)!.push(pick);
      }
      
      // Void duplicates (keep highest stake)
      let duplicatesVoided = 0;
      const groupEntries = Array.from(pickGroups.entries());
      for (const [key, groupPicks] of groupEntries) {
        if (groupPicks.length > 1) {
          // Sort by stake descending, keep first
          groupPicks.sort((a: any, b: any) => (b.stake || 0) - (a.stake || 0));
          for (let i = 1; i < groupPicks.length; i++) {
            await db.update(picks).set({ status: 'void' }).where(eq(picks.id, groupPicks[i].id));
            console.log(`[Hourly Maintenance] Voided duplicate pick ${groupPicks[i].id}: ${groupPicks[i].prediction}`);
            duplicatesVoided++;
          }
        }
      }
      
      // 2. Validate pending NHL picks still match schedule (void stale picks)
      const pendingNHLPicks = pendingPicks.filter((p: any) => p.sport === 'NHL');
      let staleNHLVoided = 0;
      for (const pick of pendingNHLPicks) {
        const validation = await validatePickAgainstSchedule('NHL', pick.event);
        if (!validation.valid) {
          await db.update(picks).set({ status: 'void' }).where(eq(picks.id, pick.id));
          console.log(`[Hourly Maintenance] Voided stale NHL pick ${pick.id}: ${pick.event} - ${validation.reason}`);
          staleNHLVoided++;
        }
      }
      if (staleNHLVoided > 0) {
        console.log(`[Hourly Maintenance] Voided ${staleNHLVoided} stale NHL picks`);
      }
      
      // 3. Run outcome check for NHL
      await autoCheckAndApplyOutcomes();
      
      // 4. Check tennis outcomes for pending picks older than 12 hours
      let tennisUpdated = 0;
      let tennisVoided = 0;
      const now = new Date();
      const pendingTennisPicks = allPicks.filter((p: any) => 
        p.status === 'pending' && p.sport === 'Tennis'
      );
      
      for (const pick of pendingTennisPicks) {
        if (!pick.createdAt) continue;
        const createdAt = new Date(pick.createdAt);
        const ageHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
        
        // Only check outcomes for picks at least 12 hours old (match should be completed)
        if (ageHours >= 12) {
          // Extract picked player from prediction (e.g., "Elena Rybakina to win" -> "Elena Rybakina")
          const pickedPlayer = extractPlayerFromPrediction(pick.prediction);
          const opponent = extractOpponentFromEvent(pick.event, pickedPlayer);
          
          if (pickedPlayer && opponent) {
            try {
              const playerStats = await fetchPlayerStats(pickedPlayer);
              if (playerStats && playerStats.last10.length > 0) {
                // Look for a recent match against the opponent (within last 7 days)
                const recentMatch = playerStats.last10.find((m: any) => {
                  const matchDate = new Date(m.date);
                  const daysSinceMatch = (now.getTime() - matchDate.getTime()) / (1000 * 60 * 60 * 24);
                  // Match opponent name (partial match for abbreviated names like "K. Muchova")
                  const opponentMatch = m.opponent.toLowerCase().includes(opponent.toLowerCase().split(' ').pop() || '') ||
                                        opponent.toLowerCase().includes(m.opponent.toLowerCase().replace(/^[a-z]\. /i, ''));
                  return daysSinceMatch <= 7 && opponentMatch;
                });
                
                if (recentMatch) {
                  const newStatus = recentMatch.result === 'W' ? 'won' : 'lost';
                  await db.update(picks).set({ status: newStatus }).where(eq(picks.id, pick.id));
                  console.log(`[Tennis Outcome] Pick ${pick.id}: ${pickedPlayer} ${newStatus} vs ${opponent}`);
                  tennisUpdated++;
                  
                  // Update bankroll if won
                  if (newStatus === 'won' && pick.stake && pick.odds) {
                    const oddsNum = Number(pick.odds);
                    if (!isNaN(oddsNum) && oddsNum < 0) {
                      const payout = pick.stake + (pick.stake * (100 / Math.abs(oddsNum)));
                      const user = await storage.getUser(pick.userId);
                      if (user && user.bankroll) {
                        await storage.updateUserBankroll(pick.userId, Math.round(user.bankroll + payout));
                        console.log(`[Tennis Outcome] Added $${Math.round(payout)} to bankroll`);
                      }
                    }
                  }
                  continue; // Skip voiding logic
                }
              }
            } catch (error) {
              console.error(`[Tennis Outcome] Error checking ${pickedPlayer}:`, error);
            }
          }
          
          // Void if 48+ hours old and no outcome found
          if (ageHours >= 48) {
            await db.update(picks).set({ status: 'void' }).where(eq(picks.id, pick.id));
            console.log(`[Hourly Maintenance] Voided old tennis pick ${pick.id}: ${pick.event}`);
            tennisVoided++;
          }
        }
      }
      
      console.log(`[Tennis Outcome] Updated: ${tennisUpdated}, Voided: ${tennisVoided}`);
      
      // 4. Refresh tennis win streaks cache
      try {
        await refreshTennisWinStreaks();
        console.log('[Hourly Maintenance] Refreshed tennis win streaks');
      } catch (error) {
        console.error('[Hourly Maintenance] Failed to refresh tennis win streaks:', error);
      }
      
      console.log(`[Hourly Maintenance] Complete. Duplicates voided: ${duplicatesVoided}, Tennis voided: ${tennisVoided}`);
      
    } catch (error) {
      console.error("[Hourly Maintenance] Error:", error);
    }
  }
  
  // Helper to normalize predictions for deduplication
  function normalizeForDedup(prediction: string): string {
    return prediction
      .toLowerCase()
      .replace(/\+1\.5.*$/i, '') // Remove puckline suffix
      .replace(/ml|moneyline|to win/gi, '') // Remove ML variations
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  // Start hourly maintenance
  setInterval(hourlyMaintenanceJob, HOURLY_INTERVAL_MS);
  console.log("[Hourly Maintenance] Started maintenance polling (every 1 hour)");
  
  // Run maintenance 30 seconds after startup
  setTimeout(hourlyMaintenanceJob, 30000);

  return httpServer;
}
