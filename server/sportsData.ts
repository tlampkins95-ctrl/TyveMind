import * as cheerio from 'cheerio';

// Simple in-memory cache for sports data
let cachedData: { nhl: SportMatch[]; tennis: SportMatch[] } | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60000; // 1 minute cache

// Kambi odds cache
let kambiOddsCache: Map<string, KambiOdds> = new Map();
let kambiCacheTimestamp = 0;
const KAMBI_CACHE_TTL = 30000; // 30 second cache for odds

export interface KambiOdds {
  eventId: number;
  event: string;
  homeTeam: string;
  awayTeam: string;
  puckLine?: { home: string; away: string; homeOdds: string; awayOdds: string };
  moneyline?: { homeOdds: string; awayOdds: string };
  status: string;
  startTime: string;
}

export interface KambiTennisOdds {
  eventId: number;
  event: string;
  player1: string;
  player2: string;
  player1Odds: string;
  player2Odds: string;
  league: string;
  tournament: string;
  status: string;
  startTime: string;
}

let kambiTennisCache: Map<string, KambiTennisOdds> = new Map();
let kambiTennisCacheTimestamp = 0;

interface ESPNEvent {
  id: string;
  name: string;
  shortName: string;
  date: string;
  status: {
    type: {
      name: string;
      state: string;
      completed: boolean;
    };
  };
  competitions: Array<{
    competitors: Array<{
      id: string;
      team: {
        name: string;
        abbreviation: string;
      };
      score?: string;
      homeAway: string;
    }>;
    odds?: Array<{
      details: string;
      overUnder: number;
    }>;
  }>;
}

interface NHLGame {
  id: number;
  gameDate: string;
  gameType: number;
  venue: { default: string };
  homeTeam: {
    abbrev: string;
    placeName: { default: string };
    score?: number;
  };
  awayTeam: {
    abbrev: string;
    placeName: { default: string };
    score?: number;
  };
  gameState: string;
  startTimeUTC: string;
}

export interface SportMatch {
  sport: string;
  league: string;
  event: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamLogo?: string;
  awayTeamLogo?: string;
  time: string;
  status: string;
  odds?: string;
  date?: string;
  score?: string;
  period?: string;
  clock?: string;
  homeAthleteId?: string;
  awayAthleteId?: string;
  surface?: string;
  startTimeUTC?: string; // ISO timestamp for accurate scheduling
}

export async function fetchNHLSchedule(): Promise<SportMatch[]> {
  try {
    // Use CT timezone for date to match user's local time
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    const response = await fetch(`https://api-web.nhle.com/v1/schedule/${today}`);
    
    if (!response.ok) {
      console.error('NHL API error:', response.status);
      return [];
    }
    
    const data = await response.json();
    const games: SportMatch[] = [];
    
    for (const week of data.gameWeek || []) {
      const gameDate = week.date;
      // Only show today's games, not the full week
      if (gameDate !== today) continue;
      
      for (const game of week.games || []) {
        const gameTime = new Date(game.startTimeUTC);
        const ctTime = gameTime.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          timeZone: 'America/Chicago'
        });
        const dateLabel = gameTime.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          timeZone: 'America/Chicago'
        });
        
        const gameStatus = game.gameState === 'LIVE' ? 'Live' : game.gameState === 'OFF' || game.gameState === 'FINAL' ? 'Final' : 'Scheduled';
        const homeScore = game.homeTeam.score;
        const awayScore = game.awayTeam.score;
        const score = (homeScore !== undefined && awayScore !== undefined) ? `${awayScore}-${homeScore}` : undefined;
        
        const homeAbbrev = game.homeTeam.abbrev;
        const awayAbbrev = game.awayTeam.abbrev;
        
        // Extract period and clock for live games
        let period: string | undefined;
        let clock: string | undefined;
        if (game.gameState === 'LIVE' || game.gameState === 'CRIT') {
          const periodNum = game.periodDescriptor?.number;
          const periodType = game.periodDescriptor?.periodType;
          if (periodNum) {
            if (periodType === 'OT') {
              period = periodNum === 1 ? 'OT' : `${periodNum}OT`;
            } else {
              period = periodNum === 1 ? '1st' : periodNum === 2 ? '2nd' : periodNum === 3 ? '3rd' : `${periodNum}th`;
            }
          }
          // Clock format from API: "12:34" or similar
          clock = game.clock?.timeRemaining || undefined;
        }
        
        games.push({
          sport: 'NHL',
          league: 'NHL',
          event: `${game.awayTeam.placeName?.default || awayAbbrev} @ ${game.homeTeam.placeName?.default || homeAbbrev}`,
          homeTeam: game.homeTeam.placeName?.default || homeAbbrev,
          awayTeam: game.awayTeam.placeName?.default || awayAbbrev,
          homeTeamLogo: `https://assets.nhle.com/logos/nhl/svg/${homeAbbrev}_dark.svg`,
          awayTeamLogo: `https://assets.nhle.com/logos/nhl/svg/${awayAbbrev}_dark.svg`,
          time: `${ctTime} CT`,
          status: gameStatus,
          date: dateLabel,
          score: score,
          period: period,
          clock: clock
        });
      }
    }
    
    return games;
  } catch (error) {
    console.error('Error fetching NHL schedule:', error);
    return [];
  }
}

// Fetch NHL schedule for today AND tomorrow (for validation purposes)
export async function fetchNHLScheduleForValidation(): Promise<SportMatch[]> {
  try {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const todayStr = today.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    
    console.log(`[Validation] Fetching NHL schedule for ${todayStr} and ${tomorrowStr}`);
    
    const [todayRes, tomorrowRes] = await Promise.all([
      fetch(`https://api-web.nhle.com/v1/schedule/${todayStr}`),
      fetch(`https://api-web.nhle.com/v1/schedule/${tomorrowStr}`)
    ]);
    
    const allGames: SportMatch[] = [];
    
    const processSchedule = async (response: Response, targetDate: string) => {
      if (!response.ok) {
        console.error(`[Validation] NHL API error for ${targetDate}: ${response.status}`);
        return;
      }
      const data = await response.json();
      
      for (const week of data.gameWeek || []) {
        const gameDate = week.date;
        // Only include games on the target date
        if (gameDate !== targetDate) continue;
        
        for (const game of week.games || []) {
          const homeAbbrev = game.homeTeam.abbrev;
          const awayAbbrev = game.awayTeam.abbrev;
          // Use commonName (mascot) for proper team identification
          const homeName = game.homeTeam.commonName?.default || game.homeTeam.name?.default || homeAbbrev;
          const awayName = game.awayTeam.commonName?.default || game.awayTeam.name?.default || awayAbbrev;
          
          allGames.push({
            sport: 'NHL',
            league: 'NHL',
            event: `${awayName} @ ${homeName}`,
            homeTeam: homeName,
            awayTeam: awayName,
            time: new Date(game.startTimeUTC).toLocaleTimeString('en-US', { 
              hour: 'numeric', 
              minute: '2-digit',
              timeZone: 'America/Chicago'
            }) + ' CT',
            status: game.gameState === 'LIVE' ? 'Live' : game.gameState === 'OFF' || game.gameState === 'FINAL' ? 'Final' : 'Scheduled',
            date: gameDate,
            startTimeUTC: game.startTimeUTC // Preserve UTC timestamp for accurate scheduling
          });
        }
      }
    };
    
    await Promise.all([
      processSchedule(todayRes, todayStr),
      processSchedule(tomorrowRes, tomorrowStr)
    ]);
    
    console.log(`[Validation] Found ${allGames.length} total NHL games for validation (today + tomorrow)`);
    return allGames;
  } catch (error) {
    console.error('[Validation] Error fetching NHL schedule for validation:', error);
    throw error; // Re-throw so validation fails strictly
  }
}

// Fetch completed NHL games from past 7 days for reliable outcome polling
// Extended lookback ensures we catch picks even if server restarts or polling is delayed
export async function fetchCompletedNHLGames(lookbackDays: number = 7): Promise<SportMatch[]> {
  try {
    const today = new Date();
    const dates: string[] = [];
    
    // Generate date strings for past N days
    for (let i = 0; i < lookbackDays; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      dates.push(date.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }));
    }
    
    console.log(`[fetchCompletedNHLGames] Checking ${lookbackDays} days: ${dates[dates.length - 1]} to ${dates[0]}`);
    
    // Fetch all days in parallel
    const responses = await Promise.all(
      dates.map(dateStr => fetch(`https://api-web.nhle.com/v1/schedule/${dateStr}`))
    );
    
    const completedGames: SportMatch[] = [];
    
    const processSchedule = async (response: Response, gameDate: string) => {
      if (!response.ok) return;
      const data = await response.json();
      
      for (const week of data.gameWeek || []) {
        for (const game of week.games || []) {
          // Only include completed games
          if (game.gameState !== 'OFF' && game.gameState !== 'FINAL') continue;
          
          const homeScore = game.homeTeam.score;
          const awayScore = game.awayTeam.score;
          const score = (homeScore !== undefined && awayScore !== undefined) ? `${awayScore}-${homeScore}` : undefined;
          
          completedGames.push({
            sport: 'NHL',
            league: 'NHL',
            event: `${game.awayTeam.placeName?.default || game.awayTeam.abbrev} @ ${game.homeTeam.placeName?.default || game.homeTeam.abbrev}`,
            homeTeam: game.homeTeam.placeName?.default || game.homeTeam.abbrev,
            awayTeam: game.awayTeam.placeName?.default || game.awayTeam.abbrev,
            time: '',
            status: 'Final',
            score: score,
            date: gameDate
          });
        }
      }
    };
    
    await Promise.all(responses.map((res, i) => processSchedule(res, dates[i])));
    
    console.log(`[fetchCompletedNHLGames] Found ${completedGames.length} completed games over ${lookbackDays} days`);
    return completedGames;
  } catch (error) {
    console.error('Error fetching completed NHL games:', error);
    return [];
  }
}

// NHL Rest/Fatigue Tracking
export interface TeamRestData {
  teamCode: string;
  teamName: string;
  daysSinceLastGame: number;
  lastGameDate: string;
  isBackToBack: boolean; // Played yesterday
  isRested: boolean; // 3+ days rest
}

export interface MatchupRestAdvantage {
  homeTeam: TeamRestData;
  awayTeam: TeamRestData;
  advantage: 'home' | 'away' | 'neutral';
  advantageReason: string;
  fatigueWarning?: string; // Warning if picking fatigued team
}

// Fetch NHL team rest data for all teams playing today
export async function fetchNHLRestData(): Promise<Map<string, TeamRestData>> {
  try {
    const today = new Date();
    const todayStr = today.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    
    // Fetch games from past 10 days to determine last game dates (covers long breaks like All-Star)
    const dates: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      dates.push(date.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }));
    }
    
    const responses = await Promise.all(
      dates.map(dateStr => fetch(`https://api-web.nhle.com/v1/schedule/${dateStr}`))
    );
    
    // Track when each team last played (most recent game)
    const teamLastGame: Map<string, { date: string; daysSince: number }> = new Map();
    
    for (let i = 0; i < responses.length; i++) {
      const response = responses[i];
      const gameDate = dates[i];
      const daysSince = i + 1; // 1 = yesterday, 2 = 2 days ago, etc.
      
      if (!response.ok) continue;
      const data = await response.json();
      
      for (const week of data.gameWeek || []) {
        for (const game of week.games || []) {
          // Only count completed games
          if (game.gameState !== 'OFF' && game.gameState !== 'FINAL') continue;
          
          const homeCode = game.homeTeam.abbrev;
          const awayCode = game.awayTeam.abbrev;
          const homeName = game.homeTeam.placeName?.default || homeCode;
          const awayName = game.awayTeam.placeName?.default || awayCode;
          
          // Only update if this is more recent than what we have
          if (!teamLastGame.has(homeCode)) {
            teamLastGame.set(homeCode, { date: gameDate, daysSince });
          }
          if (!teamLastGame.has(awayCode)) {
            teamLastGame.set(awayCode, { date: gameDate, daysSince });
          }
        }
      }
    }
    
    // Convert to TeamRestData
    const restData: Map<string, TeamRestData> = new Map();
    
    teamLastGame.forEach((lastGame, teamCode) => {
      restData.set(teamCode, {
        teamCode,
        teamName: teamCode, // Will be enriched by caller if needed
        daysSinceLastGame: lastGame.daysSince,
        lastGameDate: lastGame.date,
        isBackToBack: lastGame.daysSince === 1,
        isRested: lastGame.daysSince >= 3
      });
    });
    
    console.log(`[NHL Rest] Tracked rest data for ${restData.size} teams`);
    return restData;
  } catch (error) {
    console.error('Error fetching NHL rest data:', error);
    return new Map();
  }
}

// Calculate rest advantage for a specific matchup
export function calculateRestAdvantage(
  homeTeamCode: string,
  awayTeamCode: string,
  restData: Map<string, TeamRestData>
): MatchupRestAdvantage {
  const homeRest = restData.get(homeTeamCode);
  const awayRest = restData.get(awayTeamCode);
  
  // Default values for teams with no recent games (assume well-rested after long break)
  // If team hasn't played in >10 days, they're definitely well-rested
  const homeData: TeamRestData = homeRest || {
    teamCode: homeTeamCode,
    teamName: homeTeamCode,
    daysSinceLastGame: 11, // Beyond 10-day lookback = very well rested
    lastGameDate: 'Unknown (>10 days)',
    isBackToBack: false,
    isRested: true
  };
  
  const awayData: TeamRestData = awayRest || {
    teamCode: awayTeamCode,
    teamName: awayTeamCode,
    daysSinceLastGame: 11, // Beyond 10-day lookback = very well rested
    lastGameDate: 'Unknown (>10 days)',
    isBackToBack: false,
    isRested: true
  };
  
  let advantage: 'home' | 'away' | 'neutral' = 'neutral';
  let advantageReason = '';
  let fatigueWarning: string | undefined;
  
  // Back-to-back is a major disadvantage
  if (homeData.isBackToBack && !awayData.isBackToBack) {
    advantage = 'away';
    advantageReason = `${homeTeamCode} on back-to-back (played yesterday), ${awayTeamCode} has ${awayData.daysSinceLastGame} days rest`;
    fatigueWarning = `WARNING: ${homeTeamCode} is fatigued (back-to-back)`;
  } else if (awayData.isBackToBack && !homeData.isBackToBack) {
    advantage = 'home';
    advantageReason = `${awayTeamCode} on back-to-back (played yesterday), ${homeTeamCode} has ${homeData.daysSinceLastGame} days rest`;
    fatigueWarning = `WARNING: ${awayTeamCode} is fatigued (back-to-back)`;
  } else if (homeData.isBackToBack && awayData.isBackToBack) {
    advantage = 'neutral';
    advantageReason = 'Both teams on back-to-back';
    fatigueWarning = 'WARNING: Both teams fatigued (back-to-back)';
  } else {
    // Compare rest days - significant advantage if 2+ days difference
    const restDiff = homeData.daysSinceLastGame - awayData.daysSinceLastGame;
    if (restDiff >= 2) {
      advantage = 'home';
      advantageReason = `${homeTeamCode} well-rested (${homeData.daysSinceLastGame} days) vs ${awayTeamCode} (${awayData.daysSinceLastGame} days)`;
    } else if (restDiff <= -2) {
      advantage = 'away';
      advantageReason = `${awayTeamCode} well-rested (${awayData.daysSinceLastGame} days) vs ${homeTeamCode} (${homeData.daysSinceLastGame} days)`;
    } else {
      advantageReason = `Similar rest: ${homeTeamCode} (${homeData.daysSinceLastGame}d) vs ${awayTeamCode} (${awayData.daysSinceLastGame}d)`;
    }
  }
  
  return {
    homeTeam: homeData,
    awayTeam: awayData,
    advantage,
    advantageReason,
    fatigueWarning
  };
}

export async function fetchESPNTennis(): Promise<SportMatch[]> {
  try {
    // Get today and tomorrow's dates in YYYYMMDD format for ESPN API
    // Include tomorrow to handle overseas tournaments (Asia/Oceania) that may appear as next day
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }).replace(/-/g, '');
    const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }).replace(/-/g, '');
    
    // Fetch both today AND tomorrow to cover cross-timezone tournaments
    const [atpTodayRes, wtaTodayRes, atpTomorrowRes, wtaTomorrowRes] = await Promise.all([
      fetch(`https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard?dates=${todayStr}`),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/tennis/wta/scoreboard?dates=${todayStr}`),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard?dates=${tomorrowStr}`),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/tennis/wta/scoreboard?dates=${tomorrowStr}`)
    ]);
    
    // Map from competition UID to match data - use UID for reliable deduplication
    const matchMap = new Map<string, SportMatch>();
    
    const parseESPNTennis = (data: any, feedLeague: string) => {
      for (const tournament of data.events || []) {
        const tournamentName = tournament.shortName || tournament.name || 'Tournament';
        
        // ESPN tennis has nested structure: events -> groupings -> grouping.grouping -> competitions
        for (const groupingWrapper of tournament.groupings || []) {
          // Determine league from grouping name (Men's Singles = ATP, Women's Singles = WTA)
          // Note: nested structure is groupings[].grouping.displayName
          const groupingInfo = groupingWrapper.grouping || groupingWrapper;
          const groupingName = groupingInfo.displayName || groupingInfo.name || '';
          // Skip doubles matches - only show singles
          if (groupingName.toLowerCase().includes("doubles")) {
            continue;
          }
          
          let groupingLeague = feedLeague;
          if (groupingName.toLowerCase().includes("women")) {
            groupingLeague = 'WTA';
          } else if (groupingName.toLowerCase().includes("men")) {
            groupingLeague = 'ATP';
          }
          
          for (const competition of groupingWrapper.competitions || []) {
            try {
              // Use competition UID for reliable deduplication
              const compId = competition.uid || competition.id || '';
              if (!compId) continue;
              
              // Skip if already processed (both feeds may have same competition)
              if (matchMap.has(compId)) continue;
              
              const gameTime = new Date(competition.date || competition.startDate);
              
              // No date filter - we're fetching both today and tomorrow
              // The startTimeUTC is preserved so frontend can classify correctly
              
              const ctTime = gameTime.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit',
                timeZone: 'America/Chicago'
              });
              
              const competitors = competition.competitors || [];
              const player1 = competitors[0]?.athlete?.displayName 
                || competitors[0]?.athlete?.shortName
                || 'TBD';
              const player2 = competitors[1]?.athlete?.displayName 
                || competitors[1]?.athlete?.shortName
                || 'TBD';
              
              const player1Id = competitors[0]?.athlete?.guid?.toString() 
                || competitors[0]?.athlete?.id?.toString() || '';
              const player2Id = competitors[1]?.athlete?.guid?.toString() 
                || competitors[1]?.athlete?.id?.toString() || '';
              
              // Determine league: grouping name > athlete gender > feed default
              let league = groupingLeague;
              const athlete1Gender = competitors[0]?.athlete?.gender;
              const athlete2Gender = competitors[1]?.athlete?.gender;
              if (athlete1Gender === 'female' || athlete2Gender === 'female') {
                league = 'WTA';
              } else if (athlete1Gender === 'male' || athlete2Gender === 'male') {
                league = 'ATP';
              }
              
              // Get venue/location - try multiple sources for city
              const venueCity = competition.venue?.address?.city 
                || competition.venue?.fullName?.split(',')[0] 
                || '';
              const court = competition.venue?.court || '';
              
              // Extract city from tournament name if venue is empty
              // e.g., "ASB Classic" -> "Auckland", "Brisbane International" -> "Brisbane"
              const tournamentCityMap: Record<string, string> = {
                'brisbane': 'Brisbane',
                'auckland': 'Auckland', 
                'asb classic': 'Auckland',
                'canberra': 'Canberra',
                'hong kong': 'Hong Kong',
                'adelaide': 'Adelaide',
                'sydney': 'Sydney',
                'melbourne': 'Melbourne'
              };
              
              let cityName = venueCity;
              if (!cityName) {
                const tournLower = tournamentName.toLowerCase();
                for (const [key, value] of Object.entries(tournamentCityMap)) {
                  if (tournLower.includes(key)) {
                    cityName = value;
                    break;
                  }
                }
              }
              
              const fullLocation = cityName 
                ? (court ? `${cityName} (${court})` : cityName)
                : (court ? `(${court})` : tournamentName);
              
              const status = competition.status?.type;
              const matchStatus = status?.completed ? 'Final' : status?.state === 'in' ? 'Live' : 'Scheduled';
              
              // Skip completed matches
              if (matchStatus === 'Final') continue;
              
              // Determine surface from venue or tournament
              const venueSurface = competition.venue?.surface || '';
              let matchSurface = 'hard';
              const surfaceLower = (venueSurface || tournamentName || '').toLowerCase();
              if (surfaceLower.includes('clay')) matchSurface = 'clay';
              else if (surfaceLower.includes('grass')) matchSurface = 'grass';
              
              // Add to matchMap using competition ID as key
              matchMap.set(compId, {
                sport: 'Tennis',
                league: league,
                event: fullLocation || tournamentName,
                homeTeam: player1,
                awayTeam: player2,
                time: `${ctTime} CT`,
                status: matchStatus,
                homeAthleteId: player1Id,
                awayAthleteId: player2Id,
                surface: matchSurface,
                startTimeUTC: gameTime.toISOString() // Preserve actual ESPN match time for scheduling
              });
            } catch (e) {
              console.error('Error parsing tennis competition:', e);
            }
          }
        }
      }
    };
    
    // Parse all four feeds - WTA first so its league tags take precedence for combined events
    // Map deduplicates by competition UID so same match won't appear twice
    if (wtaTodayRes.ok) {
      const data = await wtaTodayRes.json();
      parseESPNTennis(data, 'WTA');
    }
    if (wtaTomorrowRes.ok) {
      const data = await wtaTomorrowRes.json();
      parseESPNTennis(data, 'WTA');
    }
    if (atpTodayRes.ok) {
      const data = await atpTodayRes.json();
      parseESPNTennis(data, 'ATP');
    }
    if (atpTomorrowRes.ok) {
      const data = await atpTomorrowRes.json();
      parseESPNTennis(data, 'ATP');
    }
    
    // Convert map to array
    return Array.from(matchMap.values());
  } catch (error) {
    console.error('Error fetching ESPN tennis:', error);
    return [];
  }
}

export async function fetchKambiNHLOdds(): Promise<KambiOdds[]> {
  try {
    const now = Date.now();
    if (kambiOddsCache.size > 0 && (now - kambiCacheTimestamp) < KAMBI_CACHE_TTL) {
      return Array.from(kambiOddsCache.values());
    }

    const response = await fetch('https://eu-offering-api.kambicdn.com/offering/v2018/potawuswirl/listView/ice_hockey/nhl.json?lang=en_US&market=US');
    
    if (!response.ok) {
      console.error('Kambi API error:', response.status);
      return [];
    }
    
    const data = await response.json();
    const odds: KambiOdds[] = [];
    kambiOddsCache.clear();
    
    // First pass: get event IDs and basic info from listView
    const eventIds: number[] = [];
    const eventBasicInfo: Map<number, { event: any, puckLine?: any }> = new Map();
    
    for (const item of data.events || []) {
      const event = item.event;
      const betOffers = item.betOffers || [];
      
      eventIds.push(event.id);
      
      const puckLineOffer = betOffers.find((o: any) => 
        o.criterion?.label?.includes('Puck Line') || o.criterion?.englishLabel?.includes('Puck Line')
      );
      
      let puckLine;
      if (puckLineOffer?.outcomes) {
        const homeOutcome = puckLineOffer.outcomes.find((o: any) => o.type === 'OT_ONE');
        const awayOutcome = puckLineOffer.outcomes.find((o: any) => o.type === 'OT_TWO');
        if (homeOutcome && awayOutcome) {
          puckLine = {
            home: (homeOutcome.line / 1000).toFixed(1),
            away: (awayOutcome.line / 1000).toFixed(1),
            homeOdds: homeOutcome.oddsAmerican,
            awayOdds: awayOutcome.oddsAmerican,
          };
        }
      }
      
      eventBasicInfo.set(event.id, { event, puckLine });
    }
    
    // Second pass: fetch individual event details to get moneyline odds
    // Kambi listView only returns pucklines, moneylines require individual event fetch
    const eventDetailsPromises = eventIds.map(async (eventId) => {
      try {
        const eventRes = await fetch(`https://eu-offering-api.kambicdn.com/offering/v2018/potawuswirl/betoffer/event/${eventId}.json?lang=en_US&market=US`);
        if (eventRes.ok) {
          const eventData = await eventRes.json();
          return { eventId, data: eventData };
        }
      } catch {
        // Silently skip failed individual fetches
      }
      return { eventId, data: null };
    });
    
    const eventDetails = await Promise.all(eventDetailsPromises);
    
    // Map moneyline data by eventId
    const moneylineMap: Map<number, { homeOdds: string, awayOdds: string }> = new Map();
    for (const { eventId, data: eventData } of eventDetails) {
      if (!eventData?.betOffers) continue;
      
      const mlOffer = eventData.betOffers.find((o: any) => 
        o.criterion?.label?.includes('Moneyline') || 
        o.criterion?.englishLabel?.includes('Moneyline')
      );
      
      if (mlOffer?.outcomes) {
        const homeOutcome = mlOffer.outcomes.find((o: any) => o.type === 'OT_ONE');
        const awayOutcome = mlOffer.outcomes.find((o: any) => o.type === 'OT_TWO');
        if (homeOutcome && awayOutcome) {
          moneylineMap.set(eventId, {
            homeOdds: homeOutcome.oddsAmerican,
            awayOdds: awayOutcome.oddsAmerican,
          });
        }
      }
    }
    
    // Build final odds array
    for (const [eventId, info] of Array.from(eventBasicInfo.entries())) {
      const event = info.event;
      const oddsData: KambiOdds = {
        eventId: event.id,
        event: event.name || `${event.awayName} @ ${event.homeName}`,
        homeTeam: event.homeName,
        awayTeam: event.awayName,
        status: event.state === 'STARTED' ? 'Live' : event.state === 'FINISHED' ? 'Final' : 'Scheduled',
        startTime: event.start,
      };
      
      if (info.puckLine) {
        oddsData.puckLine = info.puckLine;
      }
      
      const moneyline = moneylineMap.get(eventId);
      if (moneyline) {
        oddsData.moneyline = moneyline;
      }
      
      odds.push(oddsData);
      kambiOddsCache.set(event.id.toString(), oddsData);
    }
    
    kambiCacheTimestamp = now;
    console.log(`[Kambi NHL] Fetched ${odds.length} events, ${moneylineMap.size} with moneyline odds`);
    return odds;
  } catch (error) {
    console.error('Error fetching Kambi odds:', error);
    return [];
  }
}

export async function fetchKambiTennisOdds(): Promise<KambiTennisOdds[]> {
  try {
    const now = Date.now();
    if (kambiTennisCache.size > 0 && (now - kambiTennisCacheTimestamp) < KAMBI_CACHE_TTL) {
      return Array.from(kambiTennisCache.values());
    }

    // Fetch both WTA and ATP
    const [wtaResponse, atpResponse] = await Promise.all([
      fetch('https://eu-offering-api.kambicdn.com/offering/v2018/potawuswirl/listView/tennis/wta.json?lang=en_US&market=US'),
      fetch('https://eu-offering-api.kambicdn.com/offering/v2018/potawuswirl/listView/tennis/atp.json?lang=en_US&market=US')
    ]);
    
    const allOdds: KambiTennisOdds[] = [];
    kambiTennisCache.clear();
    
    const parseKambiTennis = (data: any, league: string) => {
      for (const item of data.events || []) {
        const event = item.event;
        const betOffers = item.betOffers || [];
        
        // Skip doubles matches (contain "/" in player names)
        if (event.homeName?.includes('/') || event.awayName?.includes('/')) {
          continue;
        }
        
        // Find moneyline odds
        const moneylineOffer = betOffers.find((o: any) => 
          o.criterion?.label?.includes('Moneyline') || 
          o.criterion?.englishLabel?.includes('Match Odds')
        );
        
        if (!moneylineOffer?.outcomes) continue;
        
        const player1Outcome = moneylineOffer.outcomes.find((o: any) => o.type === 'OT_ONE');
        const player2Outcome = moneylineOffer.outcomes.find((o: any) => o.type === 'OT_TWO');
        
        if (!player1Outcome || !player2Outcome) continue;
        
        // Extract tournament from path
        const tournament = event.path?.find((p: any) => 
          !['Tennis', 'ATP', 'WTA', 'ITF Men', 'ITF Women'].includes(p.englishName)
        )?.englishName || event.group || '';
        
        // Parse player names - some events have "Player1 vs Player2" in event.name 
        // with tournament in homeName/awayName instead
        let player1 = event.homeName;
        let player2 = event.awayName;
        
        // Check if event.name contains " vs " and homeName looks like a tournament
        const eventName = event.name || '';
        if (eventName.includes(' vs ') && !event.homeName?.includes(' ')) {
          const vsMatch = eventName.match(/^(.+?)\s+vs\s+(.+)$/i);
          if (vsMatch) {
            player1 = vsMatch[1].trim();
            player2 = vsMatch[2].trim();
          }
        }
        
        // Also check participant names from outcomes as fallback
        if (!player1 || !player2 || player1.length < 3 || player2.length < 3) {
          const p1Label = player1Outcome.participant || player1Outcome.label || '';
          const p2Label = player2Outcome.participant || player2Outcome.label || '';
          if (p1Label && p2Label) {
            player1 = p1Label;
            player2 = p2Label;
          }
        }
        
        // Skip if we still don't have valid player names
        if (!player1 || !player2 || player1.length < 3 || player2.length < 3) {
          continue;
        }
        
        const oddsData: KambiTennisOdds = {
          eventId: event.id,
          event: eventName || `${player1} vs ${player2}`,
          player1,
          player2,
          player1Odds: player1Outcome.oddsAmerican,
          player2Odds: player2Outcome.oddsAmerican,
          league,
          tournament,
          status: event.state === 'STARTED' ? 'Live' : event.state === 'FINISHED' ? 'Final' : 'Scheduled',
          startTime: event.start,
        };
        
        allOdds.push(oddsData);
        kambiTennisCache.set(event.id.toString(), oddsData);
      }
    };
    
    if (wtaResponse.ok) {
      const wtaData = await wtaResponse.json();
      parseKambiTennis(wtaData, 'WTA');
    }
    
    if (atpResponse.ok) {
      const atpData = await atpResponse.json();
      parseKambiTennis(atpData, 'ATP');
    }
    
    kambiTennisCacheTimestamp = now;
    console.log(`[Kambi Tennis] Fetched ${allOdds.length} matches with odds`);
    return allOdds;
  } catch (error) {
    console.error('Error fetching Kambi tennis odds:', error);
    return [];
  }
}

// Parse American odds string to number (handles "-245", "+150", etc.)
function parseAmericanOdds(odds: string): number {
  if (!odds) return 0;
  // Remove any whitespace and parse
  const cleaned = odds.trim();
  const num = Number(cleaned);
  return isNaN(num) ? 0 : num;
}

// Filter tennis matches with favorable odds (-200 to -300 range for favorites)
export function filterFavorableTennisOdds(odds: KambiTennisOdds[]): KambiTennisOdds[] {
  return odds.filter(match => {
    const p1Odds = parseAmericanOdds(match.player1Odds);
    const p2Odds = parseAmericanOdds(match.player2Odds);
    
    // We want matches where one player has odds in -200 to -300 range
    // This means a strong favorite but not a lock (-400+)
    // Negative odds indicate favorite, lower (more negative) = stronger favorite
    const isP1Favorable = p1Odds <= -200 && p1Odds >= -300;
    const isP2Favorable = p2Odds <= -200 && p2Odds >= -300;
    
    return isP1Favorable || isP2Favorable;
  });
}

export async function fetchAllSportsData(): Promise<{
  nhl: SportMatch[];
  tennis: SportMatch[];
}> {
  // Return cached data if still fresh
  const now = Date.now();
  if (cachedData && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedData;
  }
  
  const [nhl, tennis] = await Promise.all([
    fetchNHLSchedule(),
    fetchESPNTennis()
  ]);
  
  // Update cache
  cachedData = { nhl, tennis };
  cacheTimestamp = now;
  
  return cachedData;
}

// Win streak tracking
export interface PlayerWinStreak {
  name: string;
  league: string; // ATP or WTA
  winStreak: number;
  lastMatches: string[];
  ranking?: string;
  surface?: string;
  profileUrl: string;
}

// Cache for win streaks
let winStreakCache: PlayerWinStreak[] = [];
let winStreakCacheTimestamp = 0;
const WIN_STREAK_CACHE_TTL = 300000; // 5 minute cache

// Force refresh win streaks - clears cache and fetches new data
export async function refreshTennisWinStreaks(): Promise<PlayerWinStreak[]> {
  console.log('[Win Streaks] Force refreshing tennis win streaks...');
  winStreakCache = [];
  winStreakCacheTimestamp = 0;
  return fetchTennisWinStreaks();
}

export async function fetchTennisWinStreaks(): Promise<PlayerWinStreak[]> {
  const now = Date.now();
  if (winStreakCache.length > 0 && (now - winStreakCacheTimestamp) < WIN_STREAK_CACHE_TTL) {
    return winStreakCache;
  }

  try {
    // Fetch recent results from TennisExplorer (includes both wins and losses)
    const atpResults = await fetchRecentResults('atp-single');
    const wtaResults = await fetchRecentResults('wta-single');
    
    // Track match history by player (ordered by date, most recent first)
    const playerHistory: Map<string, { 
      results: Array<{ won: boolean; opponent: string; date: string }>;
      league: string; 
      profileUrl: string;
    }> = new Map();
    
    // Process ATP results - track both winners and losers
    for (const result of atpResults) {
      // Add winner's match
      const winnerData = playerHistory.get(result.winner) || { results: [], league: 'ATP', profileUrl: result.winnerUrl };
      winnerData.results.push({ won: true, opponent: result.loser, date: result.date });
      playerHistory.set(result.winner, winnerData);
      
      // Add loser's match (breaks their streak)
      const loserData = playerHistory.get(result.loser) || { results: [], league: 'ATP', profileUrl: '' };
      loserData.results.push({ won: false, opponent: result.winner, date: result.date });
      playerHistory.set(result.loser, loserData);
    }
    
    // Process WTA results  
    for (const result of wtaResults) {
      const winnerData = playerHistory.get(result.winner) || { results: [], league: 'WTA', profileUrl: result.winnerUrl };
      winnerData.results.push({ won: true, opponent: result.loser, date: result.date });
      playerHistory.set(result.winner, winnerData);
      
      const loserData = playerHistory.get(result.loser) || { results: [], league: 'WTA', profileUrl: '' };
      loserData.results.push({ won: false, opponent: result.winner, date: result.date });
      playerHistory.set(result.loser, loserData);
    }
    
    // Calculate consecutive win streaks (count from most recent match until first loss)
    const streaks: PlayerWinStreak[] = [];
    playerHistory.forEach((data, name) => {
      // Sort results by date (most recent first)
      data.results.sort((a, b) => b.date.localeCompare(a.date));
      
      // Count consecutive wins from the beginning
      let consecutiveWins = 0;
      const winMatches: string[] = [];
      
      for (const match of data.results) {
        if (match.won) {
          consecutiveWins++;
          winMatches.push(`W vs ${match.opponent}`);
        } else {
          break; // Stop at first loss
        }
      }
      
      if (consecutiveWins >= 3 && data.profileUrl) {
        streaks.push({
          name,
          league: data.league,
          winStreak: consecutiveWins,
          lastMatches: winMatches.slice(0, 5),
          profileUrl: data.profileUrl,
        });
      }
    });
    
    // Sort by win streak (highest first)
    streaks.sort((a, b) => b.winStreak - a.winStreak);
    
    winStreakCache = streaks.slice(0, 20); // Top 20 players
    winStreakCacheTimestamp = now;
    
    return winStreakCache;
  } catch (error) {
    console.error('Error fetching tennis win streaks:', error);
    if (winStreakCache.length > 0) {
      return winStreakCache; // Return cached data on error
    }
    throw error; // Re-throw if no cache available
  }
}

interface MatchResult {
  winner: string;
  winnerUrl: string;
  loser: string;
  score: string;
  tournament: string;
  date: string;
}

async function fetchRecentResults(type: string): Promise<MatchResult[]> {
  const results: MatchResult[] = [];
  
  // Fetch last 5 days of results for better streak detection
  const today = new Date();
  for (let i = 0; i < 5; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    
    const url = `https://www.tennisexplorer.com/results/?type=${type}&year=${year}&month=${month}&day=${day}`;
    
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      });
      
      if (!response.ok) {
        console.warn(`TennisExplorer returned ${response.status} for ${dateStr}`);
        continue;
      }
      
      const html = await response.text();
      const $ = cheerio.load(html);
      
      // Parse match results from all tables on the page
      $('table tbody tr').each((_, row) => {
        const $row = $(row);
        const cells = $row.find('td');
        
        // Look for player name links
        const playerLinks = $row.find('td a[href*="/player/"]');
        if (playerLinks.length >= 2) {
          const player1Name = $(playerLinks[0]).text().trim();
          const player1Url = $(playerLinks[0]).attr('href') || '';
          const player2Name = $(playerLinks[1]).text().trim();
          
          // Find the score - look for cells with set scores (numbers)
          let hasValidScore = false;
          cells.each((_, cell) => {
            const text = $(cell).text().trim();
            // Match set scores like "6", "4", "7"
            if (/^[0-7]$/.test(text)) {
              hasValidScore = true;
              return false; // break
            }
          });
          
          // Skip walkovers, retirements, and incomplete matches
          const rowText = $row.text().toLowerCase();
          if (rowText.includes('w.o.') || rowText.includes('walkover') || 
              rowText.includes('ret.') || rowText.includes('retired') ||
              rowText.includes('def.') || rowText.includes('default')) {
            return; // Skip this row
          }
          
          if (player1Name && player2Name && hasValidScore) {
            // In TennisExplorer results, winner is typically listed first
            results.push({
              winner: player1Name,
              winnerUrl: player1Url.startsWith('/') ? `https://www.tennisexplorer.com${player1Url}` : player1Url,
              loser: player2Name,
              score: '',
              tournament: '',
              date: dateStr
            });
          }
        }
      });
      
      // Small delay between requests to be respectful
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (error) {
      console.error(`Error fetching ${type} results for ${dateStr}:`, error);
      // Continue with other days
    }
  }
  
  return results;
}

// NHL Team Stats for Market Insights
export interface TeamStats {
  teamName: string;
  teamAbbrev: string;
  logo: string;
  record: string;
  streak: { type: string; count: number };
  last5: Array<{
    opponent: string;
    opponentLogo: string;
    result: string;
    score: string;
    date: string;
  }>;
}

export interface H2HGame {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  winner: string;
}

export interface MatchupDetails {
  homeTeam: TeamStats;
  awayTeam: TeamStats;
  h2h: H2HGame[];
}

export async function fetchNHLMatchupDetails(homeAbbrev: string, awayAbbrev: string): Promise<MatchupDetails | null> {
  try {
    // Fetch standings for team stats
    const standingsResp = await fetch('https://api-web.nhle.com/v1/standings/now');
    if (!standingsResp.ok) return null;
    
    const standingsData = await standingsResp.json();
    const teamsMap = new Map<string, any>();
    
    for (const team of standingsData.standings || []) {
      teamsMap.set(team.teamAbbrev?.default, team);
    }
    
    const homeTeamData = teamsMap.get(homeAbbrev);
    const awayTeamData = teamsMap.get(awayAbbrev);
    
    if (!homeTeamData || !awayTeamData) return null;

    // Determine current NHL season (season starts in October)
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-indexed
    // If before October, we're in the previous season (e.g., Jan 2026 = 2025-26 season)
    const seasonStart = month < 10 ? year - 1 : year;
    const seasonEnd = seasonStart + 1;
    const season = `${seasonStart}${seasonEnd}`;

    // Fetch last 5 games for each team
    const [homeSchedule, awaySchedule] = await Promise.all([
      fetch(`https://api-web.nhle.com/v1/club-schedule-season/${homeAbbrev}/${season}`).then(r => r.json()).catch(() => ({ games: [] })),
      fetch(`https://api-web.nhle.com/v1/club-schedule-season/${awayAbbrev}/${season}`).then(r => r.json()).catch(() => ({ games: [] }))
    ]);

    const getLast5 = (schedule: any, teamAbbrev: string) => {
      const completedGames = (schedule.games || [])
        .filter((g: any) => g.gameState === 'OFF' || g.gameState === 'FINAL')
        .slice(-5)
        .reverse();
      
      return completedGames.map((game: any) => {
        const isHome = game.homeTeam.abbrev === teamAbbrev;
        const ourScore = isHome ? game.homeTeam.score : game.awayTeam.score;
        const theirScore = isHome ? game.awayTeam.score : game.homeTeam.score;
        const opponent = isHome ? game.awayTeam : game.homeTeam;
        
        return {
          opponent: opponent.placeName?.default || opponent.abbrev,
          opponentLogo: `https://assets.nhle.com/logos/nhl/svg/${opponent.abbrev}_dark.svg`,
          result: ourScore > theirScore ? 'W' : 'L',
          score: `${ourScore}-${theirScore}`,
          date: new Date(game.gameDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        };
      });
    };

    // Fetch H2H - look through both teams' schedules for games against each other
    const allGames = [...(homeSchedule.games || []), ...(awaySchedule.games || [])];
    const h2hGamesMap = new Map<string, H2HGame>();
    
    for (const game of allGames) {
      if (game.gameState !== 'OFF' && game.gameState !== 'FINAL') continue;
      
      const isH2H = (game.homeTeam.abbrev === homeAbbrev && game.awayTeam.abbrev === awayAbbrev) ||
                    (game.homeTeam.abbrev === awayAbbrev && game.awayTeam.abbrev === homeAbbrev);
      
      if (isH2H) {
        const gameKey = game.id.toString();
        if (!h2hGamesMap.has(gameKey)) {
          const homeScore = game.homeTeam.score || 0;
          const awayScore = game.awayTeam.score || 0;
          h2hGamesMap.set(gameKey, {
            date: new Date(game.gameDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            homeTeam: game.homeTeam.abbrev,
            awayTeam: game.awayTeam.abbrev,
            homeScore,
            awayScore,
            winner: homeScore > awayScore ? game.homeTeam.abbrev : game.awayTeam.abbrev
          });
        }
      }
    }
    
    const h2hGames = Array.from(h2hGamesMap.values()).slice(0, 10);

    const buildTeamStats = (teamData: any, abbrev: string, schedule: any): TeamStats => ({
      teamName: teamData.teamName?.default || teamData.teamCommonName?.default || abbrev,
      teamAbbrev: abbrev,
      logo: `https://assets.nhle.com/logos/nhl/svg/${abbrev}_dark.svg`,
      record: `${teamData.wins}-${teamData.losses}-${teamData.otLosses}`,
      streak: { 
        type: teamData.streakCode || '-', 
        count: teamData.streakCount || 0 
      },
      last5: getLast5(schedule, abbrev)
    });

    return {
      homeTeam: buildTeamStats(homeTeamData, homeAbbrev, homeSchedule),
      awayTeam: buildTeamStats(awayTeamData, awayAbbrev, awaySchedule),
      h2h: h2hGames
    };
  } catch (error) {
    console.error('Error fetching NHL matchup details:', error);
    return null;
  }
}

// NHL Team Win Streaks
export interface TeamWinStreak {
  name: string;
  abbreviation: string;
  winStreak: number;
  record: string;
  logo?: string;
}

// NHL Team Strength Analysis
export interface TeamStrength {
  abbreviation: string;
  teamName: string;
  points: number;
  wins: number;
  losses: number;
  otLosses: number;
  goalDifferential: number;
  goalsFor: number;
  goalsAgainst: number;
  l10Record: string;  // Last 10 games record
  l10Points: number;
  homeRecord: string;
  roadRecord: string;
  streakCode: string;  // W or L
  streakCount: number;
  pointsPct: number;
  leagueRank: number;
}

let teamStrengthCache: Map<string, TeamStrength> = new Map();
let teamStrengthCacheTimestamp = 0;
const TEAM_STRENGTH_CACHE_TTL = 300000; // 5 minute cache

export async function fetchNHLTeamStrength(): Promise<Map<string, TeamStrength>> {
  const now = Date.now();
  if (teamStrengthCache.size > 0 && (now - teamStrengthCacheTimestamp) < TEAM_STRENGTH_CACHE_TTL) {
    return teamStrengthCache;
  }

  try {
    const response = await fetch('https://api-web.nhle.com/v1/standings/now');
    if (!response.ok) {
      console.error('NHL standings API error:', response.status);
      return teamStrengthCache;
    }

    const data = await response.json();
    const strengthMap = new Map<string, TeamStrength>();
    let rank = 0;

    // Sort by points first for league ranking
    const sortedTeams = [...(data.standings || [])].sort((a: any, b: any) => 
      (b.points || 0) - (a.points || 0)
    );

    for (const team of sortedTeams) {
      rank++;
      const abbrev = team.teamAbbrev?.default || '';
      if (!abbrev) continue;
      
      const strength: TeamStrength = {
        abbreviation: abbrev,
        teamName: team.teamName?.default || team.teamCommonName?.default || 'Unknown',
        points: team.points || 0,
        wins: team.wins || 0,
        losses: team.losses || 0,
        otLosses: team.otLosses || 0,
        goalDifferential: team.goalDifferential || 0,
        goalsFor: team.goalFor || 0,
        goalsAgainst: team.goalAgainst || 0,
        l10Record: `${team.l10Wins || 0}-${team.l10Losses || 0}-${team.l10OtLosses || 0}`,
        l10Points: team.l10Points || 0,
        homeRecord: `${team.homeWins || 0}-${team.homeLosses || 0}-${team.homeOtLosses || 0}`,
        roadRecord: `${team.roadWins || 0}-${team.roadLosses || 0}-${team.roadOtLosses || 0}`,
        streakCode: team.streakCode || 'N',
        streakCount: team.streakCount || 0,
        pointsPct: team.pointPctg || 0,
        leagueRank: rank,
      };
      
      strengthMap.set(abbrev, strength);
    }
    
    teamStrengthCache = strengthMap;
    teamStrengthCacheTimestamp = now;
    console.log(`[Team Strength] Fetched stats for ${strengthMap.size} NHL teams`);
    
    return teamStrengthCache;
  } catch (error) {
    console.error('Error fetching NHL team strength:', error);
    return teamStrengthCache;
  }
}

// Get team strength summary for AI context
export function getTeamStrengthContext(teamStrength: Map<string, TeamStrength>): string {
  if (teamStrength.size === 0) return '';
  
  const lines: string[] = ['NHL TEAM STRENGTH ANALYSIS (ranked by points):'];
  
  // Show top 10 teams (strong) and bottom 5 (weak)
  const teams = Array.from(teamStrength.values());
  const topTeams = teams.slice(0, 10);
  const bottomTeams = teams.slice(-5);
  
  lines.push('TOP PERFORMERS:');
  for (const t of topTeams) {
    const streak = t.streakCode === 'W' ? `${t.streakCount}W` : t.streakCode === 'L' ? `${t.streakCount}L` : '-';
    lines.push(`  ${t.abbreviation}: ${t.wins}-${t.losses}-${t.otLosses} (${t.points}pts, GD ${t.goalDifferential > 0 ? '+' : ''}${t.goalDifferential}, L10: ${t.l10Record}, Streak: ${streak})`);
  }
  
  lines.push('STRUGGLING TEAMS (avoid betting on):');
  for (const t of bottomTeams) {
    const streak = t.streakCode === 'W' ? `${t.streakCount}W` : t.streakCode === 'L' ? `${t.streakCount}L` : '-';
    lines.push(`  ${t.abbreviation}: ${t.wins}-${t.losses}-${t.otLosses} (${t.points}pts, GD ${t.goalDifferential > 0 ? '+' : ''}${t.goalDifferential}, L10: ${t.l10Record}, Streak: ${streak})`);
  }
  
  return lines.join('\n');
}

let nhlStreakCache: TeamWinStreak[] = [];
let nhlStreakCacheTimestamp = 0;
const NHL_STREAK_CACHE_TTL = 300000; // 5 minute cache

// NHL Injury tracking
export interface NHLInjury {
  playerName: string;
  team: string;
  teamAbbrev: string;
  position: string;
  injuryType: string;
  status: string; // "Out", "Day-to-Day", "IR"
  notes: string;
}

let nhlInjuryCache: NHLInjury[] = [];
let nhlInjuryCacheTimestamp = 0;
const NHL_INJURY_CACHE_TTL = 3600000; // 1 hour cache

// Map team names to abbreviations
const teamNameToAbbrev: Record<string, string> = {
  'Anaheim Ducks': 'ANA', 'Arizona Coyotes': 'ARI', 'Boston Bruins': 'BOS',
  'Buffalo Sabres': 'BUF', 'Calgary Flames': 'CGY', 'Carolina Hurricanes': 'CAR',
  'Chicago Blackhawks': 'CHI', 'Colorado Avalanche': 'COL', 'Columbus Blue Jackets': 'CBJ',
  'Dallas Stars': 'DAL', 'Detroit Red Wings': 'DET', 'Edmonton Oilers': 'EDM',
  'Florida Panthers': 'FLA', 'Los Angeles Kings': 'LAK', 'Minnesota Wild': 'MIN',
  'Montréal Canadiens': 'MTL', 'Montreal Canadiens': 'MTL', 'Nashville Predators': 'NSH',
  'New Jersey Devils': 'NJD', 'New York Islanders': 'NYI', 'New York Rangers': 'NYR',
  'Ottawa Senators': 'OTT', 'Philadelphia Flyers': 'PHI', 'Pittsburgh Penguins': 'PIT',
  'San Jose Sharks': 'SJS', 'Seattle Kraken': 'SEA', 'St. Louis Blues': 'STL',
  'Tampa Bay Lightning': 'TBL', 'Toronto Maple Leafs': 'TOR', 'Utah Hockey Club': 'UTA',
  'Vancouver Canucks': 'VAN', 'Vegas Golden Knights': 'VGK', 'Washington Capitals': 'WSH',
  'Winnipeg Jets': 'WPG',
};

export async function fetchNHLInjuries(): Promise<NHLInjury[]> {
  const now = Date.now();
  if (nhlInjuryCache.length > 0 && (now - nhlInjuryCacheTimestamp) < NHL_INJURY_CACHE_TTL) {
    return nhlInjuryCache;
  }

  try {
    const response = await fetch('https://www.hockey-reference.com/friv/injuries.cgi', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TyveMind/1.0)',
      },
    });
    
    if (!response.ok) {
      console.error('Hockey-reference injury page error:', response.status);
      return nhlInjuryCache;
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const injuries: NHLInjury[] = [];

    // Parse the injury table
    $('table#injuries tbody tr').each((_, row) => {
      const $row = $(row);
      const playerLink = $row.find('th[data-stat="player"] a');
      const playerName = playerLink.text().trim();
      const team = $row.find('td[data-stat="team_name"]').text().trim();
      const injuryType = $row.find('td[data-stat="injury_type"]').text().trim();
      const injuryNote = $row.find('td[data-stat="injury_note"]').text().trim();
      
      if (playerName && team) {
        // Determine status from note
        let status = 'Unknown';
        const noteLower = (injuryNote || '').toLowerCase();
        if (noteLower.includes('out indefinitely') || noteLower.includes('out for season')) {
          status = 'Out';
        } else if (noteLower.includes('ir') || noteLower.includes('injured reserve')) {
          status = 'IR';
        } else if (noteLower.includes('day-to-day') || noteLower.includes('dtd')) {
          status = 'Day-to-Day';
        } else if (noteLower.includes('out')) {
          status = 'Out';
        } else {
          status = 'Questionable';
        }
        
        injuries.push({
          playerName,
          team,
          teamAbbrev: teamNameToAbbrev[team] || '',
          position: '', // Position not always available
          injuryType: injuryType || 'Undisclosed',
          status,
          notes: injuryNote,
        });
      }
    });

    nhlInjuryCache = injuries;
    nhlInjuryCacheTimestamp = now;
    console.log(`[NHL Injuries] Fetched ${injuries.length} injured players`);
    
    return nhlInjuryCache;
  } catch (error) {
    console.error('Error fetching NHL injuries:', error);
    return nhlInjuryCache;
  }
}

// Get injury context for AI - summarize key injuries per team playing today
export function getInjuryContext(injuries: NHLInjury[], teamsPlaying: string[]): string {
  if (injuries.length === 0) return '';
  
  const relevantInjuries = injuries.filter(inj => 
    teamsPlaying.includes(inj.teamAbbrev) && 
    (inj.status === 'Out' || inj.status === 'IR' || inj.status === 'Day-to-Day')
  );
  
  if (relevantInjuries.length === 0) return '';
  
  const lines: string[] = ['KEY INJURIES FOR TODAY\'S GAMES:'];
  
  // Group by team
  const byTeam = new Map<string, NHLInjury[]>();
  for (const inj of relevantInjuries) {
    const existing = byTeam.get(inj.teamAbbrev) || [];
    existing.push(inj);
    byTeam.set(inj.teamAbbrev, existing);
  }
  
  Array.from(byTeam.entries()).forEach(([team, teamInjuries]) => {
    const significant = teamInjuries.slice(0, 5); // Max 5 per team
    const injList = significant.map((i: NHLInjury) => 
      `${i.playerName} (${i.injuryType}, ${i.status})`
    ).join(', ');
    lines.push(`  ${team}: ${injList}`);
  });
  
  lines.push('(Consider injury impact when evaluating matchups)');
  return lines.join('\n');
}

export async function fetchNHLTeamWinStreaks(): Promise<TeamWinStreak[]> {
  const now = Date.now();
  if (nhlStreakCache.length > 0 && (now - nhlStreakCacheTimestamp) < NHL_STREAK_CACHE_TTL) {
    return nhlStreakCache;
  }

  try {
    const response = await fetch('https://api-web.nhle.com/v1/standings/now');
    if (!response.ok) {
      console.error('NHL standings API error:', response.status);
      return nhlStreakCache;
    }

    const data = await response.json();
    const streaks: TeamWinStreak[] = [];

    for (const team of data.standings || []) {
      const streakCode = team.streakCode || '';
      const streakCount = team.streakCount || 0;
      
      // Only include teams on winning streaks of 3+
      if (streakCode === 'W' && streakCount >= 3) {
        streaks.push({
          name: team.teamName?.default || team.teamCommonName?.default || 'Unknown',
          abbreviation: team.teamAbbrev?.default || '',
          winStreak: streakCount,
          record: `${team.wins}-${team.losses}-${team.otLosses}`,
          logo: team.teamLogo,
        });
      }
    }

    // Sort by streak length
    streaks.sort((a, b) => b.winStreak - a.winStreak);
    
    nhlStreakCache = streaks;
    nhlStreakCacheTimestamp = now;
    
    return nhlStreakCache;
  } catch (error) {
    console.error('Error fetching NHL team streaks:', error);
    return nhlStreakCache;
  }
}

// ============================================
// NEW EDGE FACTORS - Goalie, Stats, Travel, etc.
// ============================================

// Goalie starting information
export interface GoalieStart {
  teamCode: string;
  teamName: string;
  goalieName: string;
  confirmed: boolean;
  savePercentage?: number;
  gamesPlayed?: number;
  record?: string;
  isBackup?: boolean;
}

let goalieCache: GoalieStart[] = [];
let goalieCacheTimestamp = 0;
const GOALIE_CACHE_TTL = 300000; // 5 minute cache

// Fetch starting goalies from NHL Official API (pre-game data)
// This uses the gamecenter endpoint which provides confirmed starters close to game time
export async function fetchStartingGoalies(): Promise<GoalieStart[]> {
  const now = Date.now();
  if (goalieCache.length > 0 && now - goalieCacheTimestamp < GOALIE_CACHE_TTL) {
    return goalieCache;
  }

  try {
    // Get today's schedule to find game IDs
    const today = new Date().toISOString().split('T')[0];
    const scheduleUrl = `https://api-web.nhle.com/v1/schedule/${today}`;
    
    const scheduleResponse = await fetch(scheduleUrl);
    if (!scheduleResponse.ok) {
      console.log('NHL Schedule API returned status:', scheduleResponse.status);
      return goalieCache;
    }
    
    const scheduleData = await scheduleResponse.json();
    const goalies: GoalieStart[] = [];
    
    // Process each game day
    for (const gameDay of scheduleData.gameWeek || []) {
      for (const game of gameDay.games || []) {
        if (game.gameType !== 2) continue; // Only regular season games
        
        const gameId = game.id;
        const homeTeam = game.homeTeam?.abbrev;
        const awayTeam = game.awayTeam?.abbrev;
        
        try {
          // Fetch gamecenter landing page for this game
          const landingUrl = `https://api-web.nhle.com/v1/gamecenter/${gameId}/landing`;
          const landingResponse = await fetch(landingUrl);
          
          if (landingResponse.ok) {
            const landingData = await landingResponse.json();
            
            // Extract goalie information from the landing page
            // Pre-game: look for matchup data or lineup info
            // In-progress/post-game: look for boxscore goalies
            
            // Check for pre-game lineup info
            const homeGoalieInfo = extractGoalieFromLanding(landingData, 'home', homeTeam);
            const awayGoalieInfo = extractGoalieFromLanding(landingData, 'away', awayTeam);
            
            if (homeGoalieInfo) goalies.push(homeGoalieInfo);
            if (awayGoalieInfo) goalies.push(awayGoalieInfo);
          }
        } catch (gameError) {
          // Continue to next game if this one fails
          console.log(`Could not fetch goalie data for game ${gameId}`);
        }
      }
    }
    
    console.log(`[NHL API] Fetched ${goalies.length} goalie starters from official API`);
    
    goalieCache = goalies;
    goalieCacheTimestamp = now;
    return goalieCache;
    
  } catch (error) {
    console.error('Error fetching starting goalies from NHL API:', error);
    return goalieCache;
  }
}

// Helper function to extract goalie info from NHL gamecenter landing data
function extractGoalieFromLanding(data: any, side: 'home' | 'away', teamAbbrev: string): GoalieStart | null {
  try {
    // Check for matchup goalieComparison data (pre-game)
    // Structure: matchup.goalieComparison.homeTeam/awayTeam.leaders[0]
    const matchup = data.matchup;
    if (matchup?.goalieComparison) {
      const teamGoalies = side === 'home' 
        ? matchup.goalieComparison.homeTeam 
        : matchup.goalieComparison.awayTeam;
      
      // Get the top goalie from leaders array (first is usually the likely starter)
      const leaders = teamGoalies?.leaders || [];
      if (leaders.length > 0) {
        // Find the goalie with most games played or first in list
        const goalie = leaders[0];
        
        if (goalie) {
          const savePct = goalie.savePctg 
            ? parseFloat((goalie.savePctg * 100).toFixed(1)) 
            : undefined;
          
          return {
            teamCode: teamAbbrev,
            teamName: teamAbbrev,
            goalieName: `${goalie.firstName?.default || ''} ${goalie.lastName?.default || ''}`.trim() || goalie.name?.default || 'Unknown',
            confirmed: false, // NHL API shows stats, not confirmed starters
            savePercentage: savePct,
            gamesPlayed: goalie.gamesPlayed,
            record: goalie.record
          };
        }
      }
    }
    
    // Check boxscore for in-progress or completed games
    const boxscore = data.boxscore;
    if (boxscore) {
      const teamBox = side === 'home' ? boxscore.homeTeam : boxscore.awayTeam;
      const goalies = teamBox?.goalies || [];
      
      // First goalie is usually the starter
      if (goalies.length > 0) {
        const starter = goalies[0];
        return {
          teamCode: teamAbbrev,
          teamName: teamAbbrev,
          goalieName: `${starter.firstName?.default || ''} ${starter.lastName?.default || ''}`.trim(),
          confirmed: true, // In boxscore = confirmed started
          savePercentage: starter.savePctg ? parseFloat((starter.savePctg * 100).toFixed(1)) : undefined,
          gamesPlayed: starter.gamesPlayed
        };
      }
    }
    
    // Check for summary/gameOutcome (alternative structure)
    const summary = data.summary;
    if (summary) {
      const teamSummary = side === 'home' ? summary.homeTeam : summary.awayTeam;
      if (teamSummary?.goalie) {
        const goalie = teamSummary.goalie;
        return {
          teamCode: teamAbbrev,
          teamName: teamAbbrev,
          goalieName: `${goalie.firstName?.default || ''} ${goalie.lastName?.default || ''}`.trim(),
          confirmed: true
        };
      }
    }
    
    // Check for probable goalie in game data
    const gameData = side === 'home' ? data.homeTeam : data.awayTeam;
    if (gameData?.probableGoalie) {
      const goalie = gameData.probableGoalie;
      return {
        teamCode: teamAbbrev,
        teamName: teamAbbrev,
        goalieName: `${goalie.firstName?.default || ''} ${goalie.lastName?.default || ''}`.trim(),
        confirmed: false,
        savePercentage: goalie.savePctg ? parseFloat((goalie.savePctg * 100).toFixed(1)) : undefined
      };
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

// Team stats for advanced analytics
export interface NHLTeamStats {
  teamCode: string;
  teamName: string;
  // Overall record
  wins: number;
  losses: number;
  otLosses: number;
  points: number;
  // Home/Away splits
  homeWins: number;
  homeLosses: number;
  homeOtLosses: number;
  awayWins: number;
  awayLosses: number;
  awayOtLosses: number;
  // Scoring
  goalsFor: number;
  goalsAgainst: number;
  goalDifferential: number;
  goalsPerGame: number;
  goalsAgainstPerGame: number;
  // Special teams
  powerPlayPct: number;
  penaltyKillPct: number;
  // Recent form (last 10)
  last10Wins: number;
  last10Losses: number;
  last10OtLosses: number;
  streakCode: string;
  streakCount: number;
}

let teamStatsCache: Map<string, NHLTeamStats> = new Map();
let teamStatsCacheTimestamp = 0;
const TEAM_STATS_CACHE_TTL = 1800000; // 30 minute cache

// Team name to abbreviation mapping for NHL Stats API
const NHL_TEAM_ABBREV_MAP: Record<string, string> = {
  'Anaheim Ducks': 'ANA', 'Boston Bruins': 'BOS', 'Buffalo Sabres': 'BUF',
  'Calgary Flames': 'CGY', 'Carolina Hurricanes': 'CAR', 'Chicago Blackhawks': 'CHI',
  'Colorado Avalanche': 'COL', 'Columbus Blue Jackets': 'CBJ', 'Dallas Stars': 'DAL',
  'Detroit Red Wings': 'DET', 'Edmonton Oilers': 'EDM', 'Florida Panthers': 'FLA',
  'Los Angeles Kings': 'LAK', 'Minnesota Wild': 'MIN', 'Montréal Canadiens': 'MTL',
  'Nashville Predators': 'NSH', 'New Jersey Devils': 'NJD', 'New York Islanders': 'NYI',
  'New York Rangers': 'NYR', 'Ottawa Senators': 'OTT', 'Philadelphia Flyers': 'PHI',
  'Pittsburgh Penguins': 'PIT', 'San Jose Sharks': 'SJS', 'Seattle Kraken': 'SEA',
  'St. Louis Blues': 'STL', 'Tampa Bay Lightning': 'TBL', 'Toronto Maple Leafs': 'TOR',
  'Utah Hockey Club': 'UTA', 'Vancouver Canucks': 'VAN', 'Vegas Golden Knights': 'VGK',
  'Washington Capitals': 'WSH', 'Winnipeg Jets': 'WPG'
};

// Fetch PP/PK stats from dedicated NHL Stats API
async function fetchSpecialTeamsStats(): Promise<{ pp: Map<string, number>; pk: Map<string, number> }> {
  const ppMap = new Map<string, number>();
  const pkMap = new Map<string, number>();
  
  try {
    const [ppResponse, pkResponse] = await Promise.all([
      fetch('https://api.nhle.com/stats/rest/en/team/powerplay?cayenneExp=seasonId=20242025%20and%20gameTypeId=2'),
      fetch('https://api.nhle.com/stats/rest/en/team/penaltykilltime?cayenneExp=seasonId=20242025%20and%20gameTypeId=2')
    ]);
    
    if (ppResponse.ok) {
      const ppData = await ppResponse.json();
      for (const team of ppData.data || []) {
        const abbrev = NHL_TEAM_ABBREV_MAP[team.teamFullName] || '';
        if (abbrev && team.powerPlayPct != null) {
          ppMap.set(abbrev, parseFloat((team.powerPlayPct * 100).toFixed(1)));
        }
      }
      console.log(`Fetched PP stats for ${ppMap.size} teams`);
    }
    
    if (pkResponse.ok) {
      const pkData = await pkResponse.json();
      for (const team of pkData.data || []) {
        const abbrev = NHL_TEAM_ABBREV_MAP[team.teamFullName] || '';
        if (abbrev && team.overallPenaltyKillPct != null) {
          pkMap.set(abbrev, parseFloat((team.overallPenaltyKillPct * 100).toFixed(1)));
        }
      }
      console.log(`Fetched PK stats for ${pkMap.size} teams`);
    }
  } catch (error) {
    console.error('Error fetching special teams stats:', error);
  }
  
  return { pp: ppMap, pk: pkMap };
}

// Fetch comprehensive team stats from NHL API
export async function fetchNHLTeamStats(): Promise<Map<string, NHLTeamStats>> {
  const now = Date.now();
  if (teamStatsCache.size > 0 && now - teamStatsCacheTimestamp < TEAM_STATS_CACHE_TTL) {
    return teamStatsCache;
  }

  try {
    // Fetch standings and special teams stats in parallel
    const [standingsResponse, specialTeams] = await Promise.all([
      fetch('https://api-web.nhle.com/v1/standings/now'),
      fetchSpecialTeamsStats()
    ]);
    
    if (!standingsResponse.ok) {
      console.error('NHL standings API error:', standingsResponse.status);
      return teamStatsCache;
    }

    const data = await standingsResponse.json();
    const statsMap = new Map<string, NHLTeamStats>();

    for (const team of data.standings || []) {
      const teamCode = team.teamAbbrev?.default || '';
      const gamesPlayed = team.gamesPlayed || 1;
      
      // Get PP/PK from dedicated API, fallback to defaults
      const ppPct = specialTeams.pp.get(teamCode) ?? 20;
      const pkPct = specialTeams.pk.get(teamCode) ?? 80;
      
      const stats: NHLTeamStats = {
        teamCode,
        teamName: team.teamName?.default || team.teamCommonName?.default || '',
        wins: team.wins || 0,
        losses: team.losses || 0,
        otLosses: team.otLosses || 0,
        points: team.points || 0,
        homeWins: team.homeWins || 0,
        homeLosses: team.homeLosses || 0,
        homeOtLosses: team.homeOtLosses || 0,
        awayWins: team.roadWins || 0,
        awayLosses: team.roadLosses || 0,
        awayOtLosses: team.roadOtLosses || 0,
        goalsFor: team.goalFor || 0,
        goalsAgainst: team.goalAgainst || 0,
        goalDifferential: team.goalDifferential || 0,
        goalsPerGame: parseFloat(((team.goalFor || 0) / gamesPlayed).toFixed(2)),
        goalsAgainstPerGame: parseFloat(((team.goalAgainst || 0) / gamesPlayed).toFixed(2)),
        powerPlayPct: ppPct,
        penaltyKillPct: pkPct,
        last10Wins: team.l10Wins || 0,
        last10Losses: team.l10Losses || 0,
        last10OtLosses: team.l10OtLosses || 0,
        streakCode: team.streakCode || '',
        streakCount: team.streakCount || 0
      };
      
      statsMap.set(teamCode, stats);
    }

    console.log(`Fetched stats for ${statsMap.size} NHL teams`);
    teamStatsCache = statsMap;
    teamStatsCacheTimestamp = now;
    return teamStatsCache;

  } catch (error) {
    console.error('Error fetching NHL team stats:', error);
    return teamStatsCache;
  }
}

// Head-to-head history
export interface HeadToHeadRecord {
  team1Code: string;
  team2Code: string;
  team1Wins: number;
  team2Wins: number;
  ties: number;
  lastMeetings: Array<{
    date: string;
    winner: string;
    score: string;
  }>;
}

// Fetch head-to-head data between two teams
export async function fetchHeadToHead(team1Code: string, team2Code: string): Promise<HeadToHeadRecord | null> {
  try {
    // NHL API doesn't have direct H2H endpoint, but we can use schedule/game history
    // For now, return a placeholder structure - would need to aggregate from game history
    console.log(`H2H lookup for ${team1Code} vs ${team2Code}`);
    
    // This would require fetching multiple seasons of game data
    // For MVP, we'll note the limitation and return null
    return null;
    
  } catch (error) {
    console.error('Error fetching H2H data:', error);
    return null;
  }
}

// Line movement tracking
export interface LineMovement {
  eventId: string;
  event: string;
  homeTeam: string;
  awayTeam: string;
  openingHomeOdds?: string;
  openingAwayOdds?: string;
  currentHomeOdds?: string;
  currentAwayOdds?: string;
  homeMovement?: number; // Positive = moved toward home, negative = moved toward away
  movementDirection: 'home' | 'away' | 'stable';
  significantMovement: boolean; // >10 point movement indicates sharp action
}

let lineMovementCache: Map<string, LineMovement> = new Map();
let lineMovementCacheTimestamp = 0;
const LINE_MOVEMENT_CACHE_TTL = 60000; // 1 minute cache

// Track line movement by comparing current odds to cached opening odds
export async function trackLineMovement(currentOdds: KambiOdds[]): Promise<LineMovement[]> {
  const movements: LineMovement[] = [];
  const now = Date.now();
  
  for (const odds of currentOdds) {
    const key = `${odds.homeTeam}-${odds.awayTeam}`;
    const cached = lineMovementCache.get(key);
    
    if (!cached) {
      // First time seeing this matchup - store as opening odds
      const movement: LineMovement = {
        eventId: odds.eventId.toString(),
        event: odds.event,
        homeTeam: odds.homeTeam,
        awayTeam: odds.awayTeam,
        openingHomeOdds: odds.moneyline?.homeOdds,
        openingAwayOdds: odds.moneyline?.awayOdds,
        currentHomeOdds: odds.moneyline?.homeOdds,
        currentAwayOdds: odds.moneyline?.awayOdds,
        movementDirection: 'stable',
        significantMovement: false
      };
      lineMovementCache.set(key, movement);
      movements.push(movement);
    } else {
      // Compare current to opening
      const currentHome = parseInt(odds.moneyline?.homeOdds || '0');
      const openingHome = parseInt(cached.openingHomeOdds || '0');
      
      let homeMovement = 0;
      if (currentHome && openingHome) {
        // Calculate movement - lower odds means more favored
        homeMovement = openingHome - currentHome;
      }
      
      const movement: LineMovement = {
        ...cached,
        currentHomeOdds: odds.moneyline?.homeOdds,
        currentAwayOdds: odds.moneyline?.awayOdds,
        homeMovement,
        movementDirection: homeMovement > 10 ? 'home' : homeMovement < -10 ? 'away' : 'stable',
        significantMovement: Math.abs(homeMovement) > 10
      };
      
      lineMovementCache.set(key, movement);
      movements.push(movement);
    }
  }
  
  lineMovementCacheTimestamp = now;
  return movements;
}

// Schedule spot / trap game detection
export interface ScheduleSpot {
  teamCode: string;
  currentOpponent: string;
  nextOpponent?: string;
  previousOpponent?: string;
  isTrapGame: boolean;
  trapReason?: string;
  isRevengeGame: boolean;
  revengeReason?: string;
  gameSpotRating: number; // 1-10, higher = better spot
}

// Detect trap games and revenge spots
export async function analyzeScheduleSpot(
  teamCode: string,
  currentOpponent: string,
  schedule: SportMatch[],
  restData: Map<string, TeamRestData>
): Promise<ScheduleSpot> {
  const spot: ScheduleSpot = {
    teamCode,
    currentOpponent,
    isTrapGame: false,
    isRevengeGame: false,
    gameSpotRating: 5
  };
  
  // Find team's next game after today
  const teamSchedule = schedule.filter(m => 
    m.homeTeam.includes(teamCode) || m.awayTeam.includes(teamCode)
  );
  
  // Look for trap game indicators:
  // 1. Playing a weak team before a strong rival
  // 2. Back-to-back before a big game
  const weakTeams = ['ANA', 'SJS', 'CHI', 'CBJ', 'MTL'];
  const strongTeams = ['EDM', 'DAL', 'WPG', 'FLA', 'COL', 'CAR', 'VGK', 'TBL'];
  
  if (weakTeams.includes(currentOpponent)) {
    // Check if next game is against a strong team (would be trap)
    // For MVP, we flag potential trap games
    spot.gameSpotRating += 2; // Actually easier spot, but risk of overlook
  }
  
  if (strongTeams.includes(currentOpponent)) {
    spot.gameSpotRating -= 1; // Tougher matchup
  }
  
  // Check for back-to-back in schedule spot
  const teamRest = restData.get(teamCode);
  if (teamRest?.isBackToBack) {
    spot.gameSpotRating -= 2;
    spot.isTrapGame = true;
    spot.trapReason = 'Back-to-back game, fatigue risk';
  }
  
  return spot;
}

// Travel/timezone fatigue tracking
export interface TravelFatigue {
  teamCode: string;
  teamName: string;
  homeCity: string;
  homeTimezone: string;
  lastGameLocation?: string;
  travelDistance?: number; // in miles
  timezoneChange: number; // hours of timezone difference
  isCrossCountryTrip: boolean;
  fatigueLevel: 'none' | 'low' | 'medium' | 'high';
  fatigueReason?: string;
}

// NHL team locations for travel calculations
const NHL_TEAM_LOCATIONS: Record<string, { city: string; timezone: string; lon: number; lat: number }> = {
  'ANA': { city: 'Anaheim', timezone: 'America/Los_Angeles', lon: -117.88, lat: 33.81 },
  'ARI': { city: 'Salt Lake City', timezone: 'America/Denver', lon: -111.89, lat: 40.77 },
  'BOS': { city: 'Boston', timezone: 'America/New_York', lon: -71.06, lat: 42.37 },
  'BUF': { city: 'Buffalo', timezone: 'America/New_York', lon: -78.88, lat: 42.87 },
  'CGY': { city: 'Calgary', timezone: 'America/Denver', lon: -114.07, lat: 51.04 },
  'CAR': { city: 'Raleigh', timezone: 'America/New_York', lon: -78.64, lat: 35.80 },
  'CHI': { city: 'Chicago', timezone: 'America/Chicago', lon: -87.63, lat: 41.88 },
  'COL': { city: 'Denver', timezone: 'America/Denver', lon: -104.99, lat: 39.74 },
  'CBJ': { city: 'Columbus', timezone: 'America/New_York', lon: -83.00, lat: 39.96 },
  'DAL': { city: 'Dallas', timezone: 'America/Chicago', lon: -96.80, lat: 32.79 },
  'DET': { city: 'Detroit', timezone: 'America/New_York', lon: -83.05, lat: 42.34 },
  'EDM': { city: 'Edmonton', timezone: 'America/Denver', lon: -113.50, lat: 53.55 },
  'FLA': { city: 'Sunrise', timezone: 'America/New_York', lon: -80.33, lat: 26.16 },
  'LAK': { city: 'Los Angeles', timezone: 'America/Los_Angeles', lon: -118.27, lat: 34.04 },
  'MIN': { city: 'St. Paul', timezone: 'America/Chicago', lon: -93.09, lat: 44.95 },
  'MTL': { city: 'Montreal', timezone: 'America/New_York', lon: -73.57, lat: 45.50 },
  'NSH': { city: 'Nashville', timezone: 'America/Chicago', lon: -86.78, lat: 36.16 },
  'NJD': { city: 'Newark', timezone: 'America/New_York', lon: -74.17, lat: 40.74 },
  'NYI': { city: 'Elmont', timezone: 'America/New_York', lon: -73.72, lat: 40.72 },
  'NYR': { city: 'New York', timezone: 'America/New_York', lon: -73.99, lat: 40.75 },
  'OTT': { city: 'Ottawa', timezone: 'America/New_York', lon: -75.69, lat: 45.30 },
  'PHI': { city: 'Philadelphia', timezone: 'America/New_York', lon: -75.17, lat: 39.95 },
  'PIT': { city: 'Pittsburgh', timezone: 'America/New_York', lon: -79.99, lat: 40.44 },
  'SEA': { city: 'Seattle', timezone: 'America/Los_Angeles', lon: -122.35, lat: 47.62 },
  'SJS': { city: 'San Jose', timezone: 'America/Los_Angeles', lon: -121.90, lat: 37.34 },
  'STL': { city: 'St. Louis', timezone: 'America/Chicago', lon: -90.20, lat: 38.63 },
  'TBL': { city: 'Tampa', timezone: 'America/New_York', lon: -82.45, lat: 27.95 },
  'TOR': { city: 'Toronto', timezone: 'America/New_York', lon: -79.38, lat: 43.65 },
  'UTA': { city: 'Salt Lake City', timezone: 'America/Denver', lon: -111.89, lat: 40.77 },
  'VAN': { city: 'Vancouver', timezone: 'America/Los_Angeles', lon: -123.12, lat: 49.28 },
  'VGK': { city: 'Las Vegas', timezone: 'America/Los_Angeles', lon: -115.14, lat: 36.17 },
  'WSH': { city: 'Washington', timezone: 'America/New_York', lon: -77.02, lat: 38.90 },
  'WPG': { city: 'Winnipeg', timezone: 'America/Chicago', lon: -97.14, lat: 49.90 }
};

// Timezone offsets from UTC
const TIMEZONE_OFFSETS: Record<string, number> = {
  'America/New_York': -5,
  'America/Chicago': -6,
  'America/Denver': -7,
  'America/Los_Angeles': -8
};

// Calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.round(R * c);
}

// Analyze travel fatigue for a team
export function analyzeTravelFatigue(
  teamCode: string,
  lastGameLocation: string | null,
  isHome: boolean
): TravelFatigue {
  const teamInfo = NHL_TEAM_LOCATIONS[teamCode];
  
  if (!teamInfo) {
    return {
      teamCode,
      teamName: teamCode,
      homeCity: 'Unknown',
      homeTimezone: 'America/New_York',
      timezoneChange: 0,
      isCrossCountryTrip: false,
      fatigueLevel: 'none'
    };
  }
  
  const fatigue: TravelFatigue = {
    teamCode,
    teamName: teamCode,
    homeCity: teamInfo.city,
    homeTimezone: teamInfo.timezone,
    lastGameLocation: lastGameLocation || undefined,
    timezoneChange: 0,
    isCrossCountryTrip: false,
    fatigueLevel: 'none'
  };
  
  // If playing at home, less fatigue
  if (isHome) {
    fatigue.fatigueLevel = 'none';
    return fatigue;
  }
  
  // If we know last game location, calculate travel
  if (lastGameLocation) {
    const lastLoc = NHL_TEAM_LOCATIONS[lastGameLocation];
    if (lastLoc) {
      fatigue.travelDistance = calculateDistance(
        lastLoc.lat, lastLoc.lon,
        teamInfo.lat, teamInfo.lon
      );
      
      const tzDiff = Math.abs(
        (TIMEZONE_OFFSETS[teamInfo.timezone] || 0) -
        (TIMEZONE_OFFSETS[lastLoc.timezone] || 0)
      );
      fatigue.timezoneChange = tzDiff;
      
      // Cross-country = 2000+ miles or 3+ timezone change
      if (fatigue.travelDistance > 2000 || tzDiff >= 3) {
        fatigue.isCrossCountryTrip = true;
        fatigue.fatigueLevel = 'high';
        fatigue.fatigueReason = `Cross-country trip (${fatigue.travelDistance} miles, ${tzDiff}h timezone change)`;
      } else if (fatigue.travelDistance > 1000 || tzDiff >= 2) {
        fatigue.fatigueLevel = 'medium';
        fatigue.fatigueReason = `Long travel (${fatigue.travelDistance} miles, ${tzDiff}h timezone change)`;
      } else if (fatigue.travelDistance > 500) {
        fatigue.fatigueLevel = 'low';
        fatigue.fatigueReason = `Moderate travel (${fatigue.travelDistance} miles)`;
      }
    }
  }
  
  return fatigue;
}

// Goals For/Against trends (last 5 games)
export interface ScoringTrend {
  teamCode: string;
  last5GoalsFor: number;
  last5GoalsAgainst: number;
  avgGoalsFor: number;
  avgGoalsAgainst: number;
  offenseTrend: 'hot' | 'cold' | 'average';
  defenseTrend: 'strong' | 'weak' | 'average';
  trendDescription: string;
}

// Analyze recent scoring trends from NHL API
export async function fetchScoringTrends(teamCodes: string[]): Promise<Map<string, ScoringTrend>> {
  const trends = new Map<string, ScoringTrend>();
  
  try {
    // Get team stats which includes last 10 record
    const teamStats = await fetchNHLTeamStats();
    
    for (const code of teamCodes) {
      const stats = teamStats.get(code);
      if (!stats) continue;
      
      // Use goals per game and against per game as trend indicators
      let offenseTrend: 'hot' | 'cold' | 'average' = 'average';
      let defenseTrend: 'strong' | 'weak' | 'average' = 'average';
      
      // League averages roughly 3.0 GPG
      if (stats.goalsPerGame >= 3.5) {
        offenseTrend = 'hot';
      } else if (stats.goalsPerGame <= 2.5) {
        offenseTrend = 'cold';
      }
      
      if (stats.goalsAgainstPerGame <= 2.5) {
        defenseTrend = 'strong';
      } else if (stats.goalsAgainstPerGame >= 3.5) {
        defenseTrend = 'weak';
      }
      
      const trend: ScoringTrend = {
        teamCode: code,
        last5GoalsFor: Math.round(stats.goalsPerGame * 5),
        last5GoalsAgainst: Math.round(stats.goalsAgainstPerGame * 5),
        avgGoalsFor: stats.goalsPerGame,
        avgGoalsAgainst: stats.goalsAgainstPerGame,
        offenseTrend,
        defenseTrend,
        trendDescription: `${code}: ${stats.goalsPerGame.toFixed(1)} GF/G (${offenseTrend}), ${stats.goalsAgainstPerGame.toFixed(1)} GA/G (${defenseTrend} defense)`
      };
      
      trends.set(code, trend);
    }
    
    return trends;
    
  } catch (error) {
    console.error('Error fetching scoring trends:', error);
    return trends;
  }
}

// Comprehensive edge analysis for a matchup
export interface MatchupEdgeAnalysis {
  homeTeam: string;
  awayTeam: string;
  // Goalie factor
  homeGoalie?: GoalieStart;
  awayGoalie?: GoalieStart;
  goalieAdvantage: 'home' | 'away' | 'even';
  // Home/Away splits
  homeTeamHomeRecord: string;
  awayTeamAwayRecord: string;
  venueAdvantage: 'home' | 'away' | 'even';
  // Special teams
  homeSpecialTeams: { pp: number; pk: number };
  awaySpecialTeams: { pp: number; pk: number };
  specialTeamsAdvantage: 'home' | 'away' | 'even';
  // Scoring trends
  homeScoringTrend?: ScoringTrend;
  awayScoringTrend?: ScoringTrend;
  // Travel
  homeTravelFatigue?: TravelFatigue;
  awayTravelFatigue?: TravelFatigue;
  travelAdvantage: 'home' | 'away' | 'even';
  // Line movement
  lineMovement?: LineMovement;
  sharpMoneyDirection?: 'home' | 'away' | 'none';
  // Overall edge score
  homeEdgeScore: number; // -10 to +10, positive favors home
  edgeSummary: string[];
}

// Perform comprehensive edge analysis for a matchup
export async function analyzeMatchupEdge(
  homeTeamCode: string,
  awayTeamCode: string,
  kambiOdds: KambiOdds[],
  restData: Map<string, TeamRestData>
): Promise<MatchupEdgeAnalysis> {
  // Fetch all data in parallel
  const [goalies, teamStats, scoringTrends] = await Promise.all([
    fetchStartingGoalies(),
    fetchNHLTeamStats(),
    fetchScoringTrends([homeTeamCode, awayTeamCode])
  ]);
  
  // Track line movement
  const lineMovements = await trackLineMovement(kambiOdds);
  
  const homeStats = teamStats.get(homeTeamCode);
  const awayStats = teamStats.get(awayTeamCode);
  
  const homeGoalie = goalies.find(g => g.teamCode === homeTeamCode);
  const awayGoalie = goalies.find(g => g.teamCode === awayTeamCode);
  
  const analysis: MatchupEdgeAnalysis = {
    homeTeam: homeTeamCode,
    awayTeam: awayTeamCode,
    homeGoalie,
    awayGoalie,
    goalieAdvantage: 'even',
    homeTeamHomeRecord: homeStats ? `${homeStats.homeWins}-${homeStats.homeLosses}-${homeStats.homeOtLosses}` : 'N/A',
    awayTeamAwayRecord: awayStats ? `${awayStats.awayWins}-${awayStats.awayLosses}-${awayStats.awayOtLosses}` : 'N/A',
    venueAdvantage: 'even',
    homeSpecialTeams: { pp: homeStats?.powerPlayPct || 0, pk: homeStats?.penaltyKillPct || 0 },
    awaySpecialTeams: { pp: awayStats?.powerPlayPct || 0, pk: awayStats?.penaltyKillPct || 0 },
    specialTeamsAdvantage: 'even',
    homeScoringTrend: scoringTrends.get(homeTeamCode),
    awayScoringTrend: scoringTrends.get(awayTeamCode),
    travelAdvantage: 'home', // Home team never travels for home games
    homeEdgeScore: 0,
    edgeSummary: []
  };
  
  // Calculate edge score
  let edgeScore = 0;
  
  // Venue advantage (home teams typically win ~55% in NHL)
  edgeScore += 1; // Built-in home ice advantage
  analysis.edgeSummary.push('Home ice advantage (+1)');
  
  // Home/Away record comparison
  if (homeStats && awayStats) {
    const homeWinPct = homeStats.homeWins / (homeStats.homeWins + homeStats.homeLosses + homeStats.homeOtLosses);
    const awayWinPct = awayStats.awayWins / (awayStats.awayWins + awayStats.awayLosses + awayStats.awayOtLosses);
    
    if (homeWinPct > awayWinPct + 0.1) {
      edgeScore += 1;
      analysis.venueAdvantage = 'home';
      analysis.edgeSummary.push(`Home team strong at home (.${Math.round(homeWinPct * 100)})`);
    } else if (awayWinPct > homeWinPct + 0.1) {
      edgeScore -= 1;
      analysis.venueAdvantage = 'away';
      analysis.edgeSummary.push(`Away team strong on road (.${Math.round(awayWinPct * 100)})`);
    }
    
    // Special teams comparison
    const homeST = homeStats.powerPlayPct + homeStats.penaltyKillPct;
    const awayST = awayStats.powerPlayPct + awayStats.penaltyKillPct;
    
    if (homeST > awayST + 10) {
      edgeScore += 1;
      analysis.specialTeamsAdvantage = 'home';
      analysis.edgeSummary.push(`Home special teams edge (PP: ${homeStats.powerPlayPct}%, PK: ${homeStats.penaltyKillPct}%)`);
    } else if (awayST > homeST + 10) {
      edgeScore -= 1;
      analysis.specialTeamsAdvantage = 'away';
      analysis.edgeSummary.push(`Away special teams edge (PP: ${awayStats.powerPlayPct}%, PK: ${awayStats.penaltyKillPct}%)`);
    }
  }
  
  // Rest advantage
  const homeRest = restData.get(homeTeamCode);
  const awayRest = restData.get(awayTeamCode);
  
  if (homeRest?.isBackToBack && !awayRest?.isBackToBack) {
    edgeScore -= 2;
    analysis.edgeSummary.push('Home team on back-to-back (-2)');
  } else if (awayRest?.isBackToBack && !homeRest?.isBackToBack) {
    edgeScore += 2;
    analysis.edgeSummary.push('Away team on back-to-back (+2)');
  }
  
  // Travel fatigue (away team)
  const awayTravel = analyzeTravelFatigue(awayTeamCode, null, false);
  analysis.awayTravelFatigue = awayTravel;
  
  if (awayTravel.fatigueLevel === 'high') {
    edgeScore += 1;
    analysis.edgeSummary.push(`Away team travel fatigue: ${awayTravel.fatigueReason}`);
  }
  
  // Line movement
  const matchupMovement = lineMovements.find(m => 
    m.homeTeam.includes(homeTeamCode) || m.awayTeam.includes(awayTeamCode)
  );
  
  if (matchupMovement?.significantMovement) {
    analysis.lineMovement = matchupMovement;
    analysis.sharpMoneyDirection = matchupMovement.movementDirection === 'stable' ? 'none' : matchupMovement.movementDirection;
    
    if (matchupMovement.movementDirection === 'home') {
      edgeScore += 1;
      analysis.edgeSummary.push('Sharp money moving toward home team');
    } else if (matchupMovement.movementDirection === 'away') {
      edgeScore -= 1;
      analysis.edgeSummary.push('Sharp money moving toward away team');
    }
  }
  
  // Scoring trends
  const homeTrend = scoringTrends.get(homeTeamCode);
  const awayTrend = scoringTrends.get(awayTeamCode);
  
  if (homeTrend?.offenseTrend === 'hot' && awayTrend?.defenseTrend === 'weak') {
    edgeScore += 1;
    analysis.edgeSummary.push('Home offense hot vs weak away defense');
  }
  if (awayTrend?.offenseTrend === 'hot' && homeTrend?.defenseTrend === 'weak') {
    edgeScore -= 1;
    analysis.edgeSummary.push('Away offense hot vs weak home defense');
  }
  
  analysis.homeEdgeScore = edgeScore;
  
  return analysis;
}
