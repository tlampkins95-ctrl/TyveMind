// Tennis player stats service - uses API-Tennis
// Provides last 10 matches and H2H data for tennis insights page

const API_TENNIS_KEY = process.env.API_TENNIS_KEY;

export interface TennisExplorerMatch {
  date: string;
  opponent: string;
  result: 'W' | 'L';
  score: string;
  tournament: string;
  surface: string;
}

export interface TennisExplorerPlayer {
  name: string;
  country?: string;
  rank?: number;
  last10: TennisExplorerMatch[];
  recentWins: number;
  recentLosses: number;
}

export interface TennisExplorerH2H {
  player1Name: string;
  player2Name: string;
  player1Wins: number;
  player2Wins: number;
  matches: Array<{
    date: string;
    winner: string;
    tournament: string;
    score: string;
    surface: string;
  }>;
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

const playerKeyCache = new Map<string, { key: number; name: string; country?: string; timestamp: number }>();
const playerResultsCache = new Map<string, { data: TennisExplorerPlayer; timestamp: number }>();
const h2hCache = new Map<string, { data: TennisExplorerH2H; timestamp: number }>();

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function normalizeName(name: string): string {
  return name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '')
    .trim();
}

// Reverse name order for Asian names (Wang Xinyu -> Xinyu Wang)
function reverseNameOrder(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 2) {
    return `${parts[1]} ${parts[0]}`;
  }
  return name;
}

// Alias map for players with non-Western name order or unusual spellings
const NAME_ALIASES: Record<string, string[]> = {
  'wang xinyu': ['xinyu wang', 'x. wang'],
  'zheng qinwen': ['qinwen zheng', 'q. zheng'],
  'yuan yue': ['yue yuan', 'y. yuan'],
  'wang yafan': ['yafan wang', 'y. wang'],
  'zhu lin': ['lin zhu', 'l. zhu'],
  'karolina muchova': ['muchova', 'k. muchova', 'karolna muchova'],
  'elena rybakina': ['rybakina', 'e. rybakina'],
  'aryna sabalenka': ['sabalenka', 'a. sabalenka'],
  'iga swiatek': ['swiatek', 'i. swiatek'],
  'caty mcnally': ['mcnally', 'c. mcnally', 'catherine mcnally'],
  'catherine mcnally': ['mcnally', 'c. mcnally', 'caty mcnally'],
  'arantxa rus': ['rus', 'a. rus'],
  'maya joint': ['joint', 'm. joint'],
  'sierra': ['sierra', 's. sierra'],
};

function namesMatch(name1: string, name2: string): boolean {
  const n1 = normalizeName(name1);
  const n2 = normalizeName(name2);
  
  if (n1 === n2) return true;
  
  // Check if reversed name order matches (for Asian names)
  const n1Reversed = normalizeName(reverseNameOrder(name1));
  const n2Reversed = normalizeName(reverseNameOrder(name2));
  if (n1 === n2Reversed || n1Reversed === n2) return true;
  
  // Check alias map (bidirectional)
  const aliases1 = NAME_ALIASES[n1] || [];
  const aliases2 = NAME_ALIASES[n2] || [];
  if (aliases1.includes(n2) || aliases2.includes(n1)) return true;
  
  // Also check if either name is an alias of any key
  for (const [key, aliases] of Object.entries(NAME_ALIASES)) {
    if (aliases.includes(n1) && (n2 === key || aliases.includes(n2))) return true;
    if (aliases.includes(n2) && (n1 === key || aliases.includes(n1))) return true;
  }
  
  const parts1 = n1.split(/\s+/);
  const parts2 = n2.split(/\s+/);
  const lastName1 = parts1[parts1.length - 1];
  const lastName2 = parts2[parts2.length - 1];
  
  // Exact last name match with length check
  if (lastName1 === lastName2 && lastName1.length > 4) return true;
  
  // Also check first name as last name (Asian name order)
  const firstName1 = parts1[0];
  const firstName2 = parts2[0];
  if (firstName1 === lastName2 && firstName1.length > 4) return true;
  if (firstName2 === lastName1 && firstName2.length > 4) return true;
  
  // Full name contains the search term as a complete word
  // Use word boundary matching to avoid partial matches
  const searchLower = n1.length < n2.length ? n1 : n2;
  const targetLower = n1.length < n2.length ? n2 : n1;
  
  // If searching by last name only (single word), require exact word match
  if (searchLower.split(/\s+/).length === 1) {
    const targetWords = targetLower.split(/\s+/);
    for (const word of targetWords) {
      if (word === searchLower && searchLower.length > 4) return true;
    }
  }
  
  return false;
}

async function findPlayerInStandings(playerName: string, preferredLeague?: string): Promise<{ key: number; name: string; country?: string } | null> {
  if (!API_TENNIS_KEY) {
    console.log('[API-Tennis] No API key configured');
    return null;
  }
  
  const cacheKey = `${normalizeName(playerName)}_${preferredLeague || 'any'}`;
  const cached = playerKeyCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL * 2) {
    return { key: cached.key, name: cached.name, country: cached.country };
  }
  
  // Search preferred league first, then the other
  const leagues = preferredLeague === 'WTA' ? ['WTA', 'ATP'] : 
                  preferredLeague === 'ATP' ? ['ATP', 'WTA'] : ['ATP', 'WTA'];
  
  for (const eventType of leagues) {
    try {
      console.log(`[API-Tennis] Searching ${eventType} standings for: ${playerName}`);
      const res = await fetch(
        `https://api.api-tennis.com/tennis/?method=get_standings&event_type=${eventType}&APIkey=${API_TENNIS_KEY}`
      );
      
      if (!res.ok) continue;
      
      const data = await res.json();
      if (!data.success || !data.result) continue;
      
      for (const player of data.result) {
        if (namesMatch(player.player, playerName)) {
          const result = { key: player.player_key, name: player.player, country: player.country };
          playerKeyCache.set(cacheKey, { ...result, timestamp: Date.now() });
          console.log(`[API-Tennis] Found player: ${player.player} (key: ${player.player_key}) in ${eventType}`);
          return result;
        }
      }
    } catch (error) {
      console.error(`[API-Tennis] Error searching ${eventType} standings:`, error);
    }
  }
  
  console.log(`[API-Tennis] Player not found in standings: ${playerName}`);
  return null;
}

function detectSurface(tournamentName: string): string {
  const name = tournamentName.toLowerCase();
  if (name.includes('roland') || name.includes('rome') || name.includes('madrid') || 
      name.includes('monte') || name.includes('barcelona') || name.includes('clay')) {
    return 'Clay';
  } else if (name.includes('wimbledon') || name.includes('grass') || 
             name.includes("queen's") || name.includes('halle') || name.includes('stuttgart')) {
    return 'Grass';
  }
  return 'Hard';
}

async function fetchWithRetry(url: string, retries = 3, delay = 1000): Promise<Response | null> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      if (res.status === 500 && i < retries - 1) {
        console.log(`[API-Tennis] Got 500, retrying in ${delay}ms (attempt ${i + 2}/${retries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return res;
    } catch (error) {
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  return null;
}

export async function fetchPlayerStats(playerName: string, preferredLeague?: string): Promise<TennisExplorerPlayer | null> {
  const cacheKey = `${normalizeName(playerName)}_${preferredLeague || 'any'}`;
  const cached = playerResultsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  try {
    const playerInfo = await findPlayerInStandings(playerName, preferredLeague);
    if (!playerInfo) {
      return null;
    }
    
    console.log(`[API-Tennis] Fetching results for player key: ${playerInfo.key}`);
    
    // Get player's recent results using H2H endpoint (pass same player for both to get their results)
    const res = await fetchWithRetry(
      `https://api.api-tennis.com/tennis/?method=get_H2H&first_player_key=${playerInfo.key}&second_player_key=${playerInfo.key}&APIkey=${API_TENNIS_KEY}`
    );
    
    if (!res || !res.ok) {
      console.error(`[API-Tennis] Failed to fetch player results: ${res?.status || 'no response'}`);
      return null;
    }
    
    const data = await res.json();
    if (!data.success || !data.result) {
      console.error('[API-Tennis] Invalid response for player results');
      return null;
    }
    
    const results: ApiTennisPlayerResult[] = data.result.firstPlayerResults || [];
    
    // Filter to singles matches only, SORT BY DATE (most recent first), then take last 10
    const now = new Date();
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    
    const singlesResults = results
      .filter(r => r.event_status === 'Finished' && 
                   !r.event_type_type.toLowerCase().includes('double'))
      // CRITICAL: Sort by date descending (most recent first)
      .sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime())
      // Filter out matches older than 60 days
      .filter(r => new Date(r.event_date) >= sixtyDaysAgo)
      .slice(0, 10);
    
    console.log(`[API-Tennis] ${playerInfo.name} matches after date filter: ${singlesResults.length} (recent 60 days)`);
    if (singlesResults.length > 0) {
      console.log(`[API-Tennis] Date range: ${singlesResults[singlesResults.length-1]?.event_date} to ${singlesResults[0]?.event_date}`);
    }
    
    const last10: TennisExplorerMatch[] = singlesResults.map(r => {
      const isFirstPlayer = r.first_player_key === playerInfo.key;
      const won = (r.event_winner === 'First Player' && isFirstPlayer) || 
                  (r.event_winner === 'Second Player' && !isFirstPlayer);
      
      return {
        date: r.event_date,
        opponent: isFirstPlayer ? r.event_second_player : r.event_first_player,
        result: won ? 'W' as const : 'L' as const,
        score: r.event_final_result || '',
        tournament: r.tournament_name,
        surface: detectSurface(r.tournament_name)
      };
    });
    
    const recentWins = last10.filter(m => m.result === 'W').length;
    const recentLosses = last10.filter(m => m.result === 'L').length;
    
    const playerData: TennisExplorerPlayer = {
      name: playerInfo.name,
      country: playerInfo.country,
      last10,
      recentWins,
      recentLosses
    };
    
    playerResultsCache.set(cacheKey, { data: playerData, timestamp: Date.now() });
    console.log(`[API-Tennis] Fetched ${last10.length} matches for ${playerInfo.name} (${recentWins}W-${recentLosses}L)`);
    
    return playerData;
  } catch (error) {
    console.error(`[API-Tennis] Error fetching player stats for ${playerName}:`, error);
    return null;
  }
}

export async function fetchH2H(player1Name: string, player2Name: string, preferredLeague?: string): Promise<TennisExplorerH2H | null> {
  const cacheKey = `${normalizeName(player1Name)}:${normalizeName(player2Name)}:${preferredLeague || 'any'}`;
  const cached = h2hCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  try {
    const [player1Info, player2Info] = await Promise.all([
      findPlayerInStandings(player1Name, preferredLeague),
      findPlayerInStandings(player2Name, preferredLeague)
    ]);
    
    if (!player1Info || !player2Info) {
      console.log(`[API-Tennis] Could not find both players for H2H: ${player1Name} vs ${player2Name}`);
      return null;
    }
    
    console.log(`[API-Tennis] Fetching H2H: ${player1Info.name} (${player1Info.key}) vs ${player2Info.name} (${player2Info.key})`);
    
    const res = await fetchWithRetry(
      `https://api.api-tennis.com/tennis/?method=get_H2H&first_player_key=${player1Info.key}&second_player_key=${player2Info.key}&APIkey=${API_TENNIS_KEY}`
    );
    
    if (!res || !res.ok) {
      console.error(`[API-Tennis] Failed to fetch H2H: ${res?.status || 'no response'}`);
      return null;
    }
    
    const data = await res.json();
    if (!data.success || !data.result) {
      console.error('[API-Tennis] Invalid response for H2H');
      return null;
    }
    
    const h2hMatches: ApiTennisPlayerResult[] = data.result.H2H || [];
    
    let player1Wins = 0;
    let player2Wins = 0;
    
    const matches = h2hMatches.slice(0, 10).map(r => {
      const player1IsFirst = r.first_player_key === player1Info.key;
      const firstWon = r.event_winner === 'First Player';
      
      let winner: string;
      if ((firstWon && player1IsFirst) || (!firstWon && !player1IsFirst)) {
        winner = player1Info.name;
        player1Wins++;
      } else {
        winner = player2Info.name;
        player2Wins++;
      }
      
      return {
        date: r.event_date,
        winner,
        tournament: r.tournament_name,
        score: r.event_final_result || '',
        surface: detectSurface(r.tournament_name)
      };
    });
    
    const h2hData: TennisExplorerH2H = {
      player1Name: player1Info.name,
      player2Name: player2Info.name,
      player1Wins,
      player2Wins,
      matches
    };
    
    h2hCache.set(cacheKey, { data: h2hData, timestamp: Date.now() });
    console.log(`[API-Tennis] H2H: ${player1Info.name} ${player1Wins}-${player2Wins} ${player2Info.name} (${matches.length} matches)`);
    
    return h2hData;
  } catch (error) {
    console.error(`[API-Tennis] Error fetching H2H for ${player1Name} vs ${player2Name}:`, error);
    return null;
  }
}

export function clearCache(): void {
  playerKeyCache.clear();
  playerResultsCache.clear();
  h2hCache.clear();
  console.log('[API-Tennis] Cache cleared');
}
