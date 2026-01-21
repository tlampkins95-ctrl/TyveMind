export interface TennisPlayerStats {
  name: string;
  rank?: number;
  recentWins: number;
  recentLosses: number;
  recentMatches: Array<{
    date: string;
    opponent: string;
    opponentRank?: number;
    result: 'W' | 'L';
    surface?: string;
    tournament?: string;
  }>;
  seasonStats?: {
    year: number;
    wins: number;
    losses: number;
    hardWins: number;
    hardLosses: number;
    clayWins: number;
    clayLosses: number;
    grassWins: number;
    grassLosses: number;
  };
  playerKey?: number;
  daysSinceLastMatch?: number;
}

export interface TennisMatchAnalysis {
  player1: TennisPlayerStats;
  player2: TennisPlayerStats;
  surface: string;
  h2h?: {
    player1Wins: number;
    player2Wins: number;
    matches: Array<{
      date: string;
      winner: string;
      tournament: string;
      score: string;
    }>;
  };
  advantages: {
    recentForm: string | null;
    ranking: string | null;
    h2h: string | null;
    surfaceForm: string | null;
    qualityAdjustedForm: string | null;
    restAdvantage: string | null;
  };
  recommendation: {
    pick: string | null;
    confidence: number;
    reasoning: string;
    predictedWinPct?: number;
    marketEdge?: number;
  };
}

interface ESPNCompletedMatch {
  playerName: string;
  opponentName: string;
  won: boolean;
  date: string;
  surface?: string;
  tournament?: string;
}

interface ApiTennisPlayerResult {
  event_key: string;
  event_date: string;
  event_first_player: string;
  first_player_key: number;
  event_second_player: string;
  second_player_key: number;
  event_final_result: string;
  event_winner: string;
  event_status: string;
  event_type_type: string;
  tournament_name: string;
  tournament_round: string;
}

interface ApiTennisPlayer {
  player_key: number;
  player_name: string;
  player_full_name: string;
  player_country: string;
  stats: Array<{
    season: string;
    type: string;
    rank: string;
    titles: string;
    matches_won: string;
    matches_lost: string;
    hard_won: string;
    hard_lost: string;
    clay_won: string;
    clay_lost: string;
    grass_won: string;
    grass_lost: string;
  }>;
}

// Cache for player data
const playerFormCache = new Map<string, { data: TennisPlayerStats; timestamp: number }>();
const playerKeyCache = new Map<string, { key: number; timestamp: number }>();
const h2hCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const API_TENNIS_KEY = process.env.API_TENNIS_KEY;

// Normalize player name for matching
function normalizeName(name: string): string {
  return name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '')
    .trim();
}

// Check if two names match (handles partial matches)
function namesMatch(name1: string, name2: string): boolean {
  const n1 = normalizeName(name1);
  const n2 = normalizeName(name2);
  
  if (n1 === n2) return true;
  
  // Check if one name contains the other's last name
  const parts1 = n1.split(/\s+/);
  const parts2 = n2.split(/\s+/);
  const lastName1 = parts1[parts1.length - 1];
  const lastName2 = parts2[parts2.length - 1];
  
  return lastName1 === lastName2;
}

// Find player key from API-Tennis standings
async function findPlayerKey(playerName: string, league: 'atp' | 'wta'): Promise<number | null> {
  if (!API_TENNIS_KEY) return null;
  
  const cacheKey = `${normalizeName(playerName)}-${league}`;
  const cached = playerKeyCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL * 2) {
    return cached.key;
  }
  
  try {
    const eventType = league === 'atp' ? 'ATP' : 'WTA';
    const res = await fetch(
      `https://api.api-tennis.com/tennis/?method=get_standings&event_type=${eventType}&APIkey=${API_TENNIS_KEY}`
    );
    
    if (!res.ok) return null;
    
    const data = await res.json();
    if (!data.success || !data.result) return null;
    
    // Find player in rankings
    for (const player of data.result) {
      if (namesMatch(player.player, playerName)) {
        playerKeyCache.set(cacheKey, { key: player.player_key, timestamp: Date.now() });
        console.log(`[API-Tennis] Found player key for ${playerName}: ${player.player_key}`);
        return player.player_key;
      }
    }
    
    return null;
  } catch (error) {
    console.error(`[API-Tennis] Error finding player key for ${playerName}:`, error);
    return null;
  }
}

// Get H2H and match history from API-Tennis
async function getApiTennisH2H(player1Key: number, player2Key: number): Promise<{
  h2h: ApiTennisPlayerResult[];
  player1Results: ApiTennisPlayerResult[];
  player2Results: ApiTennisPlayerResult[];
} | null> {
  if (!API_TENNIS_KEY) return null;
  
  const cacheKey = `h2h-${Math.min(player1Key, player2Key)}-${Math.max(player1Key, player2Key)}`;
  const cached = h2hCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  try {
    const res = await fetch(
      `https://api.api-tennis.com/tennis/?method=get_H2H&first_player_key=${player1Key}&second_player_key=${player2Key}&APIkey=${API_TENNIS_KEY}`
    );
    
    if (!res.ok) return null;
    
    const data = await res.json();
    if (!data.success || !data.result) return null;
    
    const result = {
      h2h: data.result.H2H || [],
      player1Results: data.result.firstPlayerResults || [],
      player2Results: data.result.secondPlayerResults || []
    };
    
    h2hCache.set(cacheKey, { data: result, timestamp: Date.now() });
    console.log(`[API-Tennis] H2H data: ${result.h2h.length} H2H matches, ${result.player1Results.length}/${result.player2Results.length} recent matches`);
    
    return result;
  } catch (error) {
    console.error(`[API-Tennis] Error fetching H2H:`, error);
    return null;
  }
}

// Get player profile from API-Tennis
async function getApiTennisPlayer(playerKey: number): Promise<ApiTennisPlayer | null> {
  if (!API_TENNIS_KEY) return null;
  
  try {
    const res = await fetch(
      `https://api.api-tennis.com/tennis/?method=get_players&player_key=${playerKey}&APIkey=${API_TENNIS_KEY}`
    );
    
    if (!res.ok) return null;
    
    const data = await res.json();
    if (!data.success || !data.result || data.result.length === 0) return null;
    
    return data.result[0];
  } catch (error) {
    console.error(`[API-Tennis] Error fetching player:`, error);
    return null;
  }
}

// Convert API-Tennis results to our format (sorted by date, most recent first)
function convertApiTennisResults(results: ApiTennisPlayerResult[], playerKey: number): TennisPlayerStats['recentMatches'] {
  const now = new Date();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  
  return results
    .filter(r => r.event_status === 'Finished' && 
                 (r.event_type_type.toLowerCase().includes('singles') || 
                  r.event_type_type.toLowerCase().includes('atp') ||
                  r.event_type_type.toLowerCase().includes('wta')))
    // Sort by date descending (most recent first) for accurate days-since-last-match
    .sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime())
    // CRITICAL: Only include matches from last 60 days
    .filter(r => new Date(r.event_date) >= sixtyDaysAgo)
    .slice(0, 10)
    .map(r => {
      const isFirstPlayer = r.first_player_key === playerKey;
      const won = (r.event_winner === 'First Player' && isFirstPlayer) || 
                  (r.event_winner === 'Second Player' && !isFirstPlayer);
      
      // Detect surface from tournament name
      let surface = 'hard';
      const tournName = r.tournament_name.toLowerCase();
      if (tournName.includes('roland') || tournName.includes('rome') || tournName.includes('madrid') || tournName.includes('clay')) {
        surface = 'clay';
      } else if (tournName.includes('wimbledon') || tournName.includes('grass') || tournName.includes('queens') || tournName.includes('halle')) {
        surface = 'grass';
      }
      
      return {
        date: r.event_date,
        opponent: isFirstPlayer ? r.event_second_player : r.event_first_player,
        result: won ? 'W' as const : 'L' as const,
        surface,
        tournament: r.tournament_name
      };
    });
}

// Fetch completed matches from ESPN scoreboard (fallback)
async function fetchESPNCompletedMatches(league: 'atp' | 'wta', daysBack: number = 14): Promise<ESPNCompletedMatch[]> {
  const matches: ESPNCompletedMatch[] = [];
  const today = new Date();
  
  console.log(`[Tennis ESPN] Fetching ${league} results for last ${daysBack} days...`);
  
  for (let i = 1; i <= Math.min(daysBack, 7); i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
    
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/tennis/${league}/scoreboard?dates=${dateStr}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      
      const data = await res.json();
      const events = data.events || [];
      
      for (const event of events) {
        const groupings = event.groupings || [];
        for (const grp of groupings) {
          const competitions = grp.competitions || [];
          for (const comp of competitions) {
            if (comp.status?.type?.completed !== true) continue;
            
            const competitors = comp.competitors || [];
            if (competitors.length !== 2) continue;
            
            const player1 = competitors[0];
            const player2 = competitors[1];
            const player1Name = player1?.athlete?.displayName || player1?.athlete?.shortName || '';
            const player2Name = player2?.athlete?.displayName || player2?.athlete?.shortName || '';
            
            if (!player1Name || !player2Name) continue;
            
            const player1Won = player1.winner === true;
            const player2Won = player2.winner === true;
            
            let surface = 'hard';
            const venue = comp.venue?.fullName?.toLowerCase() || event.name?.toLowerCase() || '';
            if (venue.includes('clay') || venue.includes('roland') || venue.includes('rome') || venue.includes('madrid')) {
              surface = 'clay';
            } else if (venue.includes('grass') || venue.includes('wimbledon') || venue.includes('queens')) {
              surface = 'grass';
            }
            
            const matchDate = comp.date || date.toISOString();
            const tournament = event.name || '';
            
            if (player1Won || player2Won) {
              matches.push({
                playerName: player1Name,
                opponentName: player2Name,
                won: player1Won,
                date: matchDate,
                surface,
                tournament
              });
              matches.push({
                playerName: player2Name,
                opponentName: player1Name,
                won: player2Won,
                date: matchDate,
                surface,
                tournament
              });
            }
          }
        }
      }
    } catch (error) {
      console.error(`[Tennis] Error fetching ${league} results for ${dateStr}:`, error);
    }
  }
  
  console.log(`[Tennis ESPN] Total ${league} matches found: ${matches.length}`);
  return matches;
}

// Get player recent form - tries API-Tennis first, falls back to ESPN
export async function getPlayerRecentForm(playerName: string, league: 'atp' | 'wta'): Promise<TennisPlayerStats> {
  const cacheKey = `${normalizeName(playerName)}-${league}`;
  const cached = playerFormCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  // Try API-Tennis first
  const playerKey = await findPlayerKey(playerName, league);
  
  if (playerKey) {
    // Get player profile for season stats
    const playerProfile = await getApiTennisPlayer(playerKey);
    
    // Get recent matches via H2H (using player vs self returns match history)
    // We need another player key - use a common opponent
    const topPlayerKey = league === 'atp' ? 2382 : 4399; // Alcaraz or Swiatek as reference
    const h2hData = await getApiTennisH2H(playerKey, topPlayerKey !== playerKey ? topPlayerKey : (league === 'atp' ? 1905 : 1999));
    
    if (h2hData && h2hData.player1Results.length > 0) {
      const recentMatches = convertApiTennisResults(h2hData.player1Results, playerKey);
      
      // Get current season stats
      let seasonStats: TennisPlayerStats['seasonStats'] | undefined;
      if (playerProfile?.stats) {
        const currentYear = new Date().getFullYear().toString();
        const singlesStats = playerProfile.stats.find(s => 
          s.season === currentYear && s.type === 'singles'
        );
        
        if (singlesStats) {
          seasonStats = {
            year: parseInt(singlesStats.season),
            wins: parseInt(singlesStats.matches_won) || 0,
            losses: parseInt(singlesStats.matches_lost) || 0,
            hardWins: parseInt(singlesStats.hard_won) || 0,
            hardLosses: parseInt(singlesStats.hard_lost) || 0,
            clayWins: parseInt(singlesStats.clay_won) || 0,
            clayLosses: parseInt(singlesStats.clay_lost) || 0,
            grassWins: parseInt(singlesStats.grass_won) || 0,
            grassLosses: parseInt(singlesStats.grass_lost) || 0,
          };
        }
      }
      
      // Calculate days since last match for rest/fatigue analysis
      let daysSinceLastMatch: number | undefined;
      if (recentMatches.length > 0 && recentMatches[0].date) {
        const lastMatchDate = new Date(recentMatches[0].date);
        const now = new Date();
        daysSinceLastMatch = Math.floor((now.getTime() - lastMatchDate.getTime()) / (1000 * 60 * 60 * 24));
      }
      
      const stats: TennisPlayerStats = {
        name: playerName,
        playerKey,
        recentWins: recentMatches.filter(m => m.result === 'W').length,
        recentLosses: recentMatches.filter(m => m.result === 'L').length,
        recentMatches,
        seasonStats,
        daysSinceLastMatch
      };
      
      playerFormCache.set(cacheKey, { data: stats, timestamp: Date.now() });
      console.log(`[API-Tennis] ${playerName}: ${stats.recentWins}W-${stats.recentLosses}L (${recentMatches.length} recent matches, ${daysSinceLastMatch ?? '?'} days rest)`);
      
      return stats;
    }
  }
  
  // Fallback to ESPN
  console.log(`[Tennis] Falling back to ESPN for ${playerName}`);
  const allMatches = await fetchESPNCompletedMatches(league, 21);
  
  const playerMatches = allMatches.filter(m => namesMatch(m.playerName, playerName));
  
  const sortedMatches = playerMatches
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 10);
  
  // Calculate days since last match for rest/fatigue analysis
  let daysSinceLastMatch: number | undefined;
  if (sortedMatches.length > 0 && sortedMatches[0].date) {
    const lastMatchDate = new Date(sortedMatches[0].date);
    const now = new Date();
    daysSinceLastMatch = Math.floor((now.getTime() - lastMatchDate.getTime()) / (1000 * 60 * 60 * 24));
  }
  
  const stats: TennisPlayerStats = {
    name: playerName,
    recentWins: sortedMatches.filter(m => m.won).length,
    recentLosses: sortedMatches.filter(m => !m.won).length,
    recentMatches: sortedMatches.map(m => ({
      date: m.date,
      opponent: m.opponentName,
      result: m.won ? 'W' : 'L',
      surface: m.surface
    })),
    daysSinceLastMatch
  };
  
  playerFormCache.set(cacheKey, { data: stats, timestamp: Date.now() });
  
  return stats;
}

// Calculate surface-specific win rate from recent matches
function getSurfaceSpecificWinRate(matches: TennisPlayerStats['recentMatches'], targetSurface: string): { wins: number; total: number; winRate: number } {
  const surfaceMatches = matches.filter(m => 
    (m.surface?.toLowerCase() || 'hard') === targetSurface.toLowerCase()
  );
  const wins = surfaceMatches.filter(m => m.result === 'W').length;
  const total = surfaceMatches.length;
  return { wins, total, winRate: total > 0 ? wins / total : 0 };
}

// Calculate quality-adjusted win rate (wins against top-50 count more)
// Note: When opponent rankings aren't available, this uses tournament round as a proxy
function getQualityAdjustedScore(matches: TennisPlayerStats['recentMatches']): number {
  let score = 0;
  let hasRankData = false;
  
  for (const match of matches) {
    // Check if we have actual rank data
    if (match.opponentRank && match.opponentRank < 100) {
      hasRankData = true;
    }
    
    // Use tournament round as proxy for opponent quality when no rank available
    const tournamentRound = match.tournament?.toLowerCase() || '';
    const isLateRound = tournamentRound.includes('final') || 
                        tournamentRound.includes('semi') || 
                        tournamentRound.includes('quarter');
    
    if (match.result === 'W') {
      const oppRank = match.opponentRank || (isLateRound ? 50 : 100);
      if (oppRank <= 20) score += 3;
      else if (oppRank <= 50) score += 2;
      else if (oppRank <= 100) score += 1.5;
      else score += 1;
    } else {
      const oppRank = match.opponentRank || (isLateRound ? 50 : 100);
      if (oppRank <= 20) score -= 0.5;
      else if (oppRank <= 50) score -= 1;
      else score -= 1.5;
    }
  }
  
  // If we have no actual rank data, reduce the weight of this score
  // to avoid false confidence from estimated ranks
  if (!hasRankData) {
    score = score * 0.5;
  }
  
  return score;
}

// Calculate rest advantage based on days since last match
function getRestAdvantage(days1: number | undefined, days2: number | undefined): { advantage: 'player1' | 'player2' | 'neutral'; reasoning: string } {
  const d1 = days1 ?? 3;
  const d2 = days2 ?? 3;
  
  // Ideal rest is 2-4 days; too many (>7) or too few (<1) is bad
  const getRestScore = (days: number) => {
    if (days < 1) return -2;
    if (days === 1) return -1;
    if (days >= 2 && days <= 4) return 1;
    if (days >= 5 && days <= 7) return 0;
    return -1;
  };
  
  const score1 = getRestScore(d1);
  const score2 = getRestScore(d2);
  
  if (score1 > score2 + 1) {
    return { advantage: 'player1', reasoning: `Better rest (${d1} vs ${d2} days since last match)` };
  } else if (score2 > score1 + 1) {
    return { advantage: 'player2', reasoning: `Better rest (${d2} vs ${d1} days since last match)` };
  }
  return { advantage: 'neutral', reasoning: '' };
}

// Calculate implied probability from American odds
function oddsToImpliedProbability(odds: number): number {
  if (odds < 0) {
    return Math.abs(odds) / (Math.abs(odds) + 100);
  } else {
    return 100 / (odds + 100);
  }
}

// Analyze a matchup between two players with IMPROVED model
export async function analyzeMatchup(
  player1Name: string,
  player2Name: string,
  league: 'atp' | 'wta',
  surface: string = 'hard',
  player1Odds?: number,
  player2Odds?: number
): Promise<TennisMatchAnalysis> {
  console.log(`[Tennis Analysis] Analyzing: ${player1Name} vs ${player2Name} (${league}, ${surface})`);
  
  // Get recent form for both players
  const [stats1, stats2] = await Promise.all([
    getPlayerRecentForm(player1Name, league),
    getPlayerRecentForm(player2Name, league)
  ]);
  
  console.log(`[Tennis Analysis] ${player1Name}: ${stats1.recentWins}W-${stats1.recentLosses}L in last ${stats1.recentMatches.length} matches`);
  console.log(`[Tennis Analysis] ${player2Name}: ${stats2.recentWins}W-${stats2.recentLosses}L in last ${stats2.recentMatches.length} matches`);
  
  // Get H2H if both have player keys
  let h2hData: TennisMatchAnalysis['h2h'] | undefined;
  if (stats1.playerKey && stats2.playerKey) {
    const h2h = await getApiTennisH2H(stats1.playerKey, stats2.playerKey);
    if (h2h && h2h.h2h.length > 0) {
      const p1Wins = h2h.h2h.filter(m => 
        (m.first_player_key === stats1.playerKey && m.event_winner === 'First Player') ||
        (m.second_player_key === stats1.playerKey && m.event_winner === 'Second Player')
      ).length;
      
      h2hData = {
        player1Wins: p1Wins,
        player2Wins: h2h.h2h.length - p1Wins,
        matches: h2h.h2h.slice(0, 5).map(m => ({
          date: m.event_date,
          winner: m.event_winner === 'First Player' ? m.event_first_player : m.event_second_player,
          tournament: m.tournament_name,
          score: m.event_final_result
        }))
      };
      console.log(`[Tennis Analysis] H2H: ${player1Name} ${h2hData.player1Wins}-${h2hData.player2Wins} ${player2Name}`);
    }
  }
  
  // Initialize advantages
  const advantages: TennisMatchAnalysis['advantages'] = {
    recentForm: null,
    ranking: null,
    h2h: null,
    surfaceForm: null,
    qualityAdjustedForm: null,
    restAdvantage: null
  };
  
  let score1 = 0;
  let score2 = 0;
  const reasoning: string[] = [];
  
  // Check if both players have sufficient data
  const hasData1 = stats1.recentMatches.length >= 5;
  const hasData2 = stats2.recentMatches.length >= 5;
  
  if (!hasData1 || !hasData2) {
    console.log(`[Tennis Analysis] Insufficient data - ${player1Name}: ${stats1.recentMatches.length} matches, ${player2Name}: ${stats2.recentMatches.length} matches`);
    return {
      player1: stats1,
      player2: stats2,
      surface,
      h2h: h2hData,
      advantages,
      recommendation: {
        pick: null,
        confidence: 0,
        reasoning: 'Insufficient match data for reliable analysis'
      }
    };
  }
  
  // IMPROVEMENT 1: Stricter recent form threshold (7+ wins in 10)
  const winRate1 = stats1.recentWins / stats1.recentMatches.length;
  const winRate2 = stats2.recentWins / stats2.recentMatches.length;
  
  const hasStrongForm1 = stats1.recentWins >= 7 && stats1.recentMatches.length >= 10;
  const hasStrongForm2 = stats2.recentWins >= 7 && stats2.recentMatches.length >= 10;
  
  if (hasStrongForm1 && !hasStrongForm2) {
    advantages.recentForm = player1Name;
    score1 += 3;
    reasoning.push(`${player1Name} has elite recent form (${stats1.recentWins}W-${stats1.recentLosses}L)`);
  } else if (hasStrongForm2 && !hasStrongForm1) {
    advantages.recentForm = player2Name;
    score2 += 3;
    reasoning.push(`${player2Name} has elite recent form (${stats2.recentWins}W-${stats2.recentLosses}L)`);
  } else if (winRate1 - winRate2 >= 0.3) {
    advantages.recentForm = player1Name;
    score1 += 2;
    reasoning.push(`${player1Name} has better recent form (${Math.round(winRate1*100)}% vs ${Math.round(winRate2*100)}%)`);
  } else if (winRate2 - winRate1 >= 0.3) {
    advantages.recentForm = player2Name;
    score2 += 2;
    reasoning.push(`${player2Name} has better recent form (${Math.round(winRate2*100)}% vs ${Math.round(winRate1*100)}%)`);
  }
  
  // IMPROVEMENT 2: Surface-specific form weighting
  const surfaceForm1 = getSurfaceSpecificWinRate(stats1.recentMatches, surface);
  const surfaceForm2 = getSurfaceSpecificWinRate(stats2.recentMatches, surface);
  
  if (surfaceForm1.total >= 3 && surfaceForm2.total >= 3) {
    if (surfaceForm1.winRate - surfaceForm2.winRate >= 0.25) {
      advantages.surfaceForm = player1Name;
      score1 += 2;
      reasoning.push(`${player1Name} stronger on ${surface} (${surfaceForm1.wins}/${surfaceForm1.total} vs ${surfaceForm2.wins}/${surfaceForm2.total})`);
    } else if (surfaceForm2.winRate - surfaceForm1.winRate >= 0.25) {
      advantages.surfaceForm = player2Name;
      score2 += 2;
      reasoning.push(`${player2Name} stronger on ${surface} (${surfaceForm2.wins}/${surfaceForm2.total} vs ${surfaceForm1.wins}/${surfaceForm1.total})`);
    }
  }
  
  // IMPROVEMENT 3: Quality-adjusted form
  const qualityScore1 = getQualityAdjustedScore(stats1.recentMatches);
  const qualityScore2 = getQualityAdjustedScore(stats2.recentMatches);
  
  if (qualityScore1 - qualityScore2 >= 3) {
    advantages.qualityAdjustedForm = player1Name;
    score1 += 1;
    reasoning.push(`${player1Name} has beaten higher-quality opponents`);
  } else if (qualityScore2 - qualityScore1 >= 3) {
    advantages.qualityAdjustedForm = player2Name;
    score2 += 1;
    reasoning.push(`${player2Name} has beaten higher-quality opponents`);
  }
  
  // IMPROVEMENT 4: Rest/fatigue factor
  const restResult = getRestAdvantage(stats1.daysSinceLastMatch, stats2.daysSinceLastMatch);
  if (restResult.advantage === 'player1') {
    advantages.restAdvantage = player1Name;
    score1 += 1;
    reasoning.push(`${player1Name}: ${restResult.reasoning}`);
  } else if (restResult.advantage === 'player2') {
    advantages.restAdvantage = player2Name;
    score2 += 1;
    reasoning.push(`${player2Name}: ${restResult.reasoning}`);
  }
  
  // H2H advantage (stronger weight for recent H2H)
  if (h2hData && h2hData.player1Wins + h2hData.player2Wins >= 2) {
    if (h2hData.player1Wins >= h2hData.player2Wins + 2) {
      advantages.h2h = player1Name;
      score1 += 2;
      reasoning.push(`${player1Name} dominates H2H ${h2hData.player1Wins}-${h2hData.player2Wins}`);
    } else if (h2hData.player2Wins >= h2hData.player1Wins + 2) {
      advantages.h2h = player2Name;
      score2 += 2;
      reasoning.push(`${player2Name} dominates H2H ${h2hData.player2Wins}-${h2hData.player1Wins}`);
    } else if (h2hData.player1Wins > h2hData.player2Wins) {
      advantages.h2h = player1Name;
      score1 += 1;
      reasoning.push(`${player1Name} leads H2H ${h2hData.player1Wins}-${h2hData.player2Wins}`);
    } else if (h2hData.player2Wins > h2hData.player1Wins) {
      advantages.h2h = player2Name;
      score2 += 1;
      reasoning.push(`${player2Name} leads H2H ${h2hData.player2Wins}-${h2hData.player1Wins}`);
    }
  }
  
  // Ranking advantage
  if (stats1.rank && stats2.rank) {
    if (stats1.rank < stats2.rank - 20) {
      advantages.ranking = player1Name;
      score1 += 1;
      reasoning.push(`${player1Name} ranked higher (#${stats1.rank} vs #${stats2.rank})`);
    } else if (stats2.rank < stats1.rank - 20) {
      advantages.ranking = player2Name;
      score2 += 1;
      reasoning.push(`${player2Name} ranked higher (#${stats2.rank} vs #${stats1.rank})`);
    }
  }
  
  // Build recommendation with STRICTER criteria
  let pick: string | null = null;
  let confidence = 0;
  let predictedWinPct = 0;
  let marketEdge = 0;
  
  const totalAdvantages = Math.abs(score1 - score2);
  const totalScore = score1 + score2;
  
  // CRITICAL SAFEGUARD: Never recommend a player with a losing record
  // This prevents picks based on stale/incorrect form data
  const hasLosingRecord1 = stats1.recentWins < stats1.recentLosses;
  const hasLosingRecord2 = stats2.recentWins < stats2.recentLosses;
  
  // NEW: Check if opponent has strong form (6+ wins in last 10)
  // If both players are in strong form, it's a coin flip - skip
  const opponentHotForm1 = stats1.recentWins >= 6 && stats1.recentMatches.length >= 8;
  const opponentHotForm2 = stats2.recentWins >= 6 && stats2.recentMatches.length >= 8;
  
  if (hasLosingRecord1 && hasLosingRecord2) {
    console.log(`[Tennis Analysis] Both players have losing records - no pick`);
    return {
      player1: stats1,
      player2: stats2,
      surface,
      h2h: h2hData,
      advantages,
      recommendation: {
        pick: null,
        confidence: 0,
        reasoning: 'Both players have losing records in recent matches'
      }
    };
  }
  
  // NEW: If BOTH players have strong form (6+ wins), it's too risky
  if (opponentHotForm1 && opponentHotForm2) {
    console.log(`[Tennis Analysis] Both players have strong form (${player1Name}: ${stats1.recentWins}W, ${player2Name}: ${stats2.recentWins}W) - skip risky matchup`);
    return {
      player1: stats1,
      player2: stats2,
      surface,
      h2h: h2hData,
      advantages,
      recommendation: {
        pick: null,
        confidence: 0,
        reasoning: `Both players in strong form (${stats1.recentWins}W vs ${stats2.recentWins}W) - too risky`
      }
    };
  }
  
  // Calculate predicted win probability based on score differential
  if (totalScore > 0) {
    predictedWinPct = score1 > score2 
      ? 0.5 + (score1 - score2) / (totalScore * 2) * 0.3
      : 0.5 - (score2 - score1) / (totalScore * 2) * 0.3;
    
    // Adjust for strong advantages
    if (score1 > score2 && totalAdvantages >= 4) predictedWinPct = Math.min(0.75, predictedWinPct + 0.1);
    if (score2 > score1 && totalAdvantages >= 4) predictedWinPct = Math.max(0.25, predictedWinPct - 0.1);
  }
  
  // IMPROVEMENT 5: Market edge validation (require 4-5% edge)
  const MINIMUM_EDGE = 0.04;
  
  if (score1 > score2 && totalAdvantages >= 3) {
    // Don't recommend a player with a losing record even if they have advantages
    if (hasLosingRecord1) {
      console.log(`[Tennis Analysis] ${player1Name} has losing record (${stats1.recentWins}W-${stats1.recentLosses}L) - skipping despite advantages`);
      pick = null;
    } else {
      pick = player1Name;
    }
    
    if (pick && player1Odds) {
      const impliedProb = oddsToImpliedProbability(player1Odds);
      marketEdge = predictedWinPct - impliedProb;
      
      if (marketEdge < MINIMUM_EDGE) {
        console.log(`[Tennis Analysis] Edge too small for ${player1Name}: ${(marketEdge * 100).toFixed(1)}% < ${(MINIMUM_EDGE * 100).toFixed(0)}% required`);
        pick = null;
        confidence = 0;
      } else {
        confidence = Math.min(7 + Math.floor(totalAdvantages / 2), 9);
        reasoning.push(`Market edge: ${(marketEdge * 100).toFixed(1)}%`);
      }
    } else if (pick) {
      confidence = Math.min(6 + totalAdvantages, 8);
    }
  } else if (score2 > score1 && totalAdvantages >= 3) {
    // Don't recommend a player with a losing record even if they have advantages
    if (hasLosingRecord2) {
      console.log(`[Tennis Analysis] ${player2Name} has losing record (${stats2.recentWins}W-${stats2.recentLosses}L) - skipping despite advantages`);
      pick = null;
    } else {
      pick = player2Name;
    }
    predictedWinPct = 1 - predictedWinPct;
    
    if (pick && player2Odds) {
      const impliedProb = oddsToImpliedProbability(player2Odds);
      marketEdge = predictedWinPct - impliedProb;
      
      if (marketEdge < MINIMUM_EDGE) {
        console.log(`[Tennis Analysis] Edge too small for ${player2Name}: ${(marketEdge * 100).toFixed(1)}% < ${(MINIMUM_EDGE * 100).toFixed(0)}% required`);
        pick = null;
        confidence = 0;
      } else {
        confidence = Math.min(7 + Math.floor(totalAdvantages / 2), 9);
        reasoning.push(`Market edge: ${(marketEdge * 100).toFixed(1)}%`);
      }
    } else if (pick) {
      confidence = Math.min(6 + totalAdvantages, 8);
    }
  }
  
  console.log(`[Tennis Analysis] Result: ${pick || 'No pick'} (conf ${confidence}, edge ${(marketEdge * 100).toFixed(1)}%)`);
  
  return {
    player1: stats1,
    player2: stats2,
    surface,
    h2h: h2hData,
    advantages,
    recommendation: {
      pick,
      confidence,
      reasoning: reasoning.length > 0 ? reasoning.join('. ') : 'No clear advantage found',
      predictedWinPct: pick ? predictedWinPct : undefined,
      marketEdge: pick ? marketEdge : undefined
    }
  };
}

// Analyze multiple matches and return only recommended ones
export async function analyzeMatches(
  matches: Array<{
    player1: string;
    player2: string;
    league: 'atp' | 'wta';
    surface?: string;
    event?: string;
    time?: string;
    player1Odds?: number;
    player2Odds?: number;
  }>
): Promise<TennisMatchAnalysis[]> {
  console.log(`[Tennis Analysis] Analyzing ${matches.length} matches with improved model...`);
  
  const analyses: TennisMatchAnalysis[] = [];
  
  for (const match of matches) {
    try {
      const analysis = await analyzeMatchup(
        match.player1,
        match.player2,
        match.league,
        match.surface || 'hard',
        match.player1Odds,
        match.player2Odds
      );
      
      // STRICTER: Require confidence >= 7 AND either no odds provided or positive market edge
      const hasPositiveEdge = !analysis.recommendation.marketEdge || analysis.recommendation.marketEdge > 0;
      
      if (analysis.recommendation.pick && analysis.recommendation.confidence >= 7 && hasPositiveEdge) {
        analyses.push(analysis);
        const edgeStr = analysis.recommendation.marketEdge 
          ? ` (edge ${(analysis.recommendation.marketEdge * 100).toFixed(1)}%)`
          : '';
        console.log(`[Tennis Analysis] RECOMMENDED: ${analysis.recommendation.pick} (conf ${analysis.recommendation.confidence})${edgeStr}`);
      } else {
        const reason = !analysis.recommendation.pick 
          ? 'no pick' 
          : analysis.recommendation.confidence < 7 
            ? `low confidence (${analysis.recommendation.confidence})`
            : 'insufficient edge';
        console.log(`[Tennis Analysis] SKIP: ${match.player1} vs ${match.player2} - ${reason}`);
      }
    } catch (error) {
      console.error(`[Tennis Analysis] Error analyzing ${match.player1} vs ${match.player2}:`, error);
    }
  }
  
  return analyses;
}
