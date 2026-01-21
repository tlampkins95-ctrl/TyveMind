import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Layout } from "@/components/layout";
import { 
  Loader2, 
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  Zap,
  Search,
  Flame,
  ChevronDown
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Map team names/cities to abbreviations for API lookup
const teamAbbreviations: Record<string, string> = {
  'anaheim': 'ANA', 'ducks': 'ANA',
  'arizona': 'ARI', 'coyotes': 'ARI',
  'boston': 'BOS', 'bruins': 'BOS',
  'buffalo': 'BUF', 'sabres': 'BUF',
  'calgary': 'CGY', 'flames': 'CGY',
  'carolina': 'CAR', 'hurricanes': 'CAR',
  'chicago': 'CHI', 'blackhawks': 'CHI',
  'colorado': 'COL', 'avalanche': 'COL',
  'columbus': 'CBJ', 'blue jackets': 'CBJ',
  'dallas': 'DAL', 'stars': 'DAL',
  'detroit': 'DET', 'red wings': 'DET',
  'edmonton': 'EDM', 'oilers': 'EDM',
  'florida': 'FLA', 'panthers': 'FLA',
  'los angeles': 'LAK', 'kings': 'LAK',
  'minnesota': 'MIN', 'wild': 'MIN',
  'montreal': 'MTL', 'canadiens': 'MTL',
  'nashville': 'NSH', 'predators': 'NSH',
  'new jersey': 'NJD', 'devils': 'NJD',
  'new york': 'NYR', 'rangers': 'NYR', 'islanders': 'NYI',
  'ottawa': 'OTT', 'senators': 'OTT',
  'philadelphia': 'PHI', 'flyers': 'PHI',
  'pittsburgh': 'PIT', 'penguins': 'PIT',
  'san jose': 'SJS', 'sharks': 'SJS',
  'seattle': 'SEA', 'kraken': 'SEA',
  'st louis': 'STL', 'blues': 'STL',
  'tampa bay': 'TBL', 'lightning': 'TBL',
  'toronto': 'TOR', 'maple leafs': 'TOR',
  'utah': 'UTA', 'mammoth': 'UTA',
  'vancouver': 'VAN', 'canucks': 'VAN',
  'vegas': 'VGK', 'golden knights': 'VGK',
  'washington': 'WSH', 'capitals': 'WSH',
  'winnipeg': 'WPG', 'jets': 'WPG',
};

function getTeamAbbrev(teamName: string): string | null {
  const lower = teamName.toLowerCase();
  return teamAbbreviations[lower] || null;
}

interface NHLGame {
  sport: string;
  league: string;
  event: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamLogo?: string;
  awayTeamLogo?: string;
  time: string;
  status: string;
  date?: string;
  score?: string;
}

interface TeamStats {
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

interface H2HGame {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  winner: string;
}

interface MatchupDetails {
  homeTeam: TeamStats;
  awayTeam: TeamStats;
  h2h: H2HGame[];
}

function useNHLSchedule() {
  return useQuery<{ nhl: NHLGame[] }>({
    queryKey: ["/api/sports/schedule"],
    refetchInterval: 60000,
  });
}

function useNHLMatchupDetails(homeAbbrev: string, awayAbbrev: string, enabled: boolean) {
  return useQuery<MatchupDetails>({
    queryKey: ["/api/nhl/matchup", homeAbbrev, awayAbbrev],
    enabled,
    staleTime: 300000,
  });
}

// Hook for fetching single team stats (uses matchup endpoint with same team for both)
function useTeamStats(teamAbbrev: string | null) {
  return useQuery<MatchupDetails>({
    queryKey: ["/api/nhl/matchup", teamAbbrev, teamAbbrev],
    enabled: !!teamAbbrev,
    staleTime: 300000,
  });
}

// NHL Moneyline Analysis types
interface MoneylineTeamAnalysis {
  team: string;
  abbreviation: string;
  logo: string;
  winStreak: number;
  record: string;
  hasUpcomingGame: boolean;
  upcomingGame: {
    event: string;
    opponent: string;
    isHome: boolean;
    time: string;
    status: string;
  } | null;
  moneyline: string | null;
  impliedProbability: string | null;
  recommendation: string | null;
}

interface MoneylineAnalysisResponse {
  streakTeams: MoneylineTeamAnalysis[];
  teamsWithoutGames: MoneylineTeamAnalysis[];
  summary: string;
}

function useNHLMoneylineAnalysis() {
  return useQuery<MoneylineAnalysisResponse>({
    queryKey: ["/api/nhl/moneyline-analysis"],
    staleTime: 60000,
    refetchInterval: 120000,
  });
}

interface TeamPerformance {
  teamCode: string;
  teamName: string;
  totalPicks: number;
  wins: number;
  losses: number;
  winRate: number;
  roi: number;
  recentForm: string;
  isHot: boolean;
  isCold: boolean;
}

interface TeamPerformanceResponse {
  all: TeamPerformance[];
  hotTeams: TeamPerformance[];
  coldTeams: TeamPerformance[];
  summary: { totalTeamsTracked: number; hotTeamsCount: number; coldTeamsCount: number };
}

function useTeamPerformance() {
  return useQuery<TeamPerformanceResponse>({
    queryKey: ["/api/teams/performance"],
    staleTime: 60000,
    refetchInterval: 120000, // Auto-refresh every 2 minutes
  });
}

function StreakBadge({ streak }: { streak: { type: string; count: number } }) {
  const isWin = streak.type === 'W';
  const isLoss = streak.type === 'L';
  
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold",
      isWin ? "bg-green-500/20 text-green-400" : 
      isLoss ? "bg-red-500/20 text-red-400" : 
      "bg-muted text-muted-foreground"
    )}>
      {isWin ? <TrendingUp className="w-3 h-3" /> : 
       isLoss ? <TrendingDown className="w-3 h-3" /> : 
       <Minus className="w-3 h-3" />}
      {streak.count}{streak.type}
    </span>
  );
}

function GameCard({ game, isExpanded, onToggle }: { 
  game: NHLGame; 
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const homeAbbrev = game.homeTeamLogo?.match(/\/([A-Z]{3})_/)?.[1] || '';
  const awayAbbrev = game.awayTeamLogo?.match(/\/([A-Z]{3})_/)?.[1] || '';
  
  const { data: matchup, isLoading } = useNHLMatchupDetails(homeAbbrev, awayAbbrev, isExpanded);

  // Extract abbreviations for game id
  const gameId = `game-${awayAbbrev}-${homeAbbrev}`;
  
  return (
    <div id={gameId} className="bg-card/50 rounded-xl border border-white/5 overflow-hidden scroll-mt-4">
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-center justify-between hover-elevate transition-all"
        data-testid={`button-game-${game.homeTeam}-${game.awayTeam}`}
      >
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {game.awayTeamLogo && (
              <img src={game.awayTeamLogo} alt={game.awayTeam} className="w-10 h-10 object-contain" />
            )}
            <span className="text-xs text-muted-foreground">@</span>
            {game.homeTeamLogo && (
              <img src={game.homeTeamLogo} alt={game.homeTeam} className="w-10 h-10 object-contain" />
            )}
          </div>
          <div className="text-left">
            <p className="font-bold text-white">{game.awayTeam} @ {game.homeTeam}</p>
            <p className="text-xs text-muted-foreground">{game.date}</p>
          </div>
        </div>
        <div className="text-right">
          {(game.status === 'Final' || game.status === 'Live') && game.score ? (
            <p className="font-bold text-white text-lg">{game.score}</p>
          ) : (
            <p className="font-bold text-primary">{game.time}</p>
          )}
          <span className={cn(
            "text-xs uppercase font-medium",
            game.status === 'Live' ? "text-red-400 animate-pulse" : 
            game.status === 'Final' ? "text-muted-foreground" : "text-sky-400"
          )}>{game.status}</span>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-white/5 p-4 space-y-6 bg-background/30">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          ) : matchup ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <TeamSection team={matchup.awayTeam} label="Away" />
                <TeamSection team={matchup.homeTeam} label="Home" />
              </div>

              <div>
                <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-primary" />
                  Last 10 Head-to-Head
                </h4>
                {matchup.h2h.length > 0 ? (
                  <div className="space-y-2">
                    {matchup.h2h.slice(0, 10).map((h2hGame, i) => (
                      <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-card/50 text-sm">
                        <span className="text-xs text-muted-foreground">{h2hGame.date}</span>
                        <span className="text-white">
                          {h2hGame.awayTeam} {h2hGame.awayScore} - {h2hGame.homeScore} {h2hGame.homeTeam}
                        </span>
                        <span className={cn(
                          "text-xs font-bold px-2 py-0.5 rounded",
                          h2hGame.winner === matchup.homeTeam.teamAbbrev ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                        )}>
                          {h2hGame.winner}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">No recent H2H data available</p>
                )}
              </div>
            </>
          ) : (
            <p className="text-center text-muted-foreground py-4">Unable to load matchup details</p>
          )}
        </div>
      )}
    </div>
  );
}

function TeamSection({ team, label }: { team: TeamStats; label: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <img src={team.logo} alt={team.teamName} className="w-8 h-8 object-contain" />
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="font-bold text-white">{team.teamName}</p>
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{team.record}</span>
        <StreakBadge streak={team.streak} />
      </div>

      <div>
        <p className="text-xs font-bold text-muted-foreground mb-2 uppercase">Last 5 Games</p>
        <div className="space-y-1">
          {team.last5.map((game, i) => (
            <div key={i} className="flex items-center gap-2 text-xs p-1.5 rounded bg-card/50">
              <span className={cn(
                "font-bold w-4",
                game.result === 'W' ? "text-green-400" : "text-red-400"
              )}>{game.result}</span>
              <img src={game.opponentLogo} alt={game.opponent} className="w-4 h-4 object-contain" />
              <span className="text-white flex-1">{game.score}</span>
              <span className="text-muted-foreground">{game.date}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HotTeamCard({ team, onJumpToGame }: { team: MoneylineTeamAnalysis; onJumpToGame?: () => void }) {
  // Calculate edge if we have implied probability
  let edge = null;
  if (team.impliedProbability) {
    const impliedPct = parseFloat(team.impliedProbability);
    // Estimate streak probability: 3W ~ 60%, 4W ~ 65%, 5W+ ~ 70%
    const streakProb = team.winStreak >= 5 ? 70 : team.winStreak >= 4 ? 65 : 60;
    edge = streakProb - impliedPct;
  }
  
  return (
    <div 
      className={cn(
        "bg-card/50 rounded-xl border border-white/5 p-4 hover-elevate transition-all",
        onJumpToGame && "cursor-pointer"
      )}
      onClick={onJumpToGame}
      data-testid={`hotteam-${team.abbreviation}`}
    >
      <div className="flex items-start gap-3">
        {team.logo && (
          <img src={team.logo} alt={team.team} className="w-12 h-12 object-contain" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-bold text-white">{team.team}</h4>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-orange-500/20 text-orange-400">
              <Flame className="w-3 h-3" />
              {team.winStreak}W Streak
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{team.record}</p>
          
          {team.upcomingGame && (
            <div className="mt-3 p-2 rounded-lg bg-background/50 border border-white/5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <p className="text-sm text-white">
                    {team.upcomingGame.isHome ? 'vs' : '@'} {team.upcomingGame.opponent}
                  </p>
                  <p className="text-xs text-muted-foreground">{team.upcomingGame.time}</p>
                </div>
                {team.moneyline && (
                  <div className="text-right">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">ML:</span>
                      <span className="font-bold text-green-400">{team.moneyline}</span>
                    </div>
                    {team.impliedProbability && (
                      <p className="text-xs text-muted-foreground">{team.impliedProbability} implied</p>
                    )}
                  </div>
                )}
              </div>
              
              {edge !== null && (
                <div className="mt-2 pt-2 border-t border-white/5 flex items-center gap-2 flex-wrap">
                  <span className={cn(
                    "text-xs font-medium px-2 py-1 rounded",
                    edge >= 5 ? "bg-green-500/20 text-green-400" 
                      : edge >= 0 ? "bg-yellow-500/20 text-yellow-400"
                      : "bg-red-500/20 text-red-400"
                  )}>
                    {edge >= 0 ? '+' : ''}{edge.toFixed(1)}% Edge
                  </span>
                  {team.recommendation && (
                    <span className="text-xs text-muted-foreground">{team.recommendation}</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const teamLogos: Record<string, string> = {
  'ANA': 'https://assets.nhle.com/logos/nhl/svg/ANA_light.svg',
  'BOS': 'https://assets.nhle.com/logos/nhl/svg/BOS_light.svg',
  'BUF': 'https://assets.nhle.com/logos/nhl/svg/BUF_light.svg',
  'CGY': 'https://assets.nhle.com/logos/nhl/svg/CGY_light.svg',
  'CAR': 'https://assets.nhle.com/logos/nhl/svg/CAR_light.svg',
  'CHI': 'https://assets.nhle.com/logos/nhl/svg/CHI_light.svg',
  'COL': 'https://assets.nhle.com/logos/nhl/svg/COL_light.svg',
  'CBJ': 'https://assets.nhle.com/logos/nhl/svg/CBJ_light.svg',
  'DAL': 'https://assets.nhle.com/logos/nhl/svg/DAL_light.svg',
  'DET': 'https://assets.nhle.com/logos/nhl/svg/DET_light.svg',
  'EDM': 'https://assets.nhle.com/logos/nhl/svg/EDM_light.svg',
  'FLA': 'https://assets.nhle.com/logos/nhl/svg/FLA_light.svg',
  'LAK': 'https://assets.nhle.com/logos/nhl/svg/LAK_light.svg',
  'MIN': 'https://assets.nhle.com/logos/nhl/svg/MIN_light.svg',
  'MTL': 'https://assets.nhle.com/logos/nhl/svg/MTL_light.svg',
  'NSH': 'https://assets.nhle.com/logos/nhl/svg/NSH_light.svg',
  'NJD': 'https://assets.nhle.com/logos/nhl/svg/NJD_light.svg',
  'NYI': 'https://assets.nhle.com/logos/nhl/svg/NYI_light.svg',
  'NYR': 'https://assets.nhle.com/logos/nhl/svg/NYR_light.svg',
  'OTT': 'https://assets.nhle.com/logos/nhl/svg/OTT_light.svg',
  'PHI': 'https://assets.nhle.com/logos/nhl/svg/PHI_light.svg',
  'PIT': 'https://assets.nhle.com/logos/nhl/svg/PIT_light.svg',
  'SJS': 'https://assets.nhle.com/logos/nhl/svg/SJS_light.svg',
  'SEA': 'https://assets.nhle.com/logos/nhl/svg/SEA_light.svg',
  'STL': 'https://assets.nhle.com/logos/nhl/svg/STL_light.svg',
  'TBL': 'https://assets.nhle.com/logos/nhl/svg/TBL_light.svg',
  'TOR': 'https://assets.nhle.com/logos/nhl/svg/TOR_light.svg',
  'UTA': 'https://assets.nhle.com/logos/nhl/svg/UTA_light.svg',
  'VAN': 'https://assets.nhle.com/logos/nhl/svg/VAN_light.svg',
  'VGK': 'https://assets.nhle.com/logos/nhl/svg/VGK_light.svg',
  'WSH': 'https://assets.nhle.com/logos/nhl/svg/WSH_light.svg',
  'WPG': 'https://assets.nhle.com/logos/nhl/svg/WPG_light.svg',
};

function TeamPerformanceSection() {
  const { data: performance, isLoading } = useTeamPerformance();
  const [hotTeamsExpanded, setHotTeamsExpanded] = useState(false);
  const [coldTeamsExpanded, setColdTeamsExpanded] = useState(false);
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }
  
  if (!performance || performance.all.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No pick history available yet</p>
      </div>
    );
  }

  const sortedHotTeams = [...performance.hotTeams].sort((a, b) => {
    const aWins = (a.recentForm.match(/W/g) || []).length;
    const bWins = (b.recentForm.match(/W/g) || []).length;
    return bWins - aWins;
  });

  const totalWins = performance.all.reduce((sum, t) => sum + t.wins, 0);
  const totalLosses = performance.all.reduce((sum, t) => sum + t.losses, 0);
  const overallWinRate = totalWins + totalLosses > 0 
    ? Math.round((totalWins / (totalWins + totalLosses)) * 100) 
    : 0;
  
  return (
    <div className="space-y-3">
      {/* Summary Stats Row */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-2xl font-bold text-primary">{totalWins}-{totalLosses}</p>
            <p className="text-xs text-muted-foreground">Overall</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-white">{overallWinRate}%</p>
            <p className="text-xs text-muted-foreground">Win Rate</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-muted-foreground">{performance.summary.totalTeamsTracked}</p>
            <p className="text-xs text-muted-foreground">Teams</p>
          </div>
        </div>
        
        {/* Hot/Cold Quick Toggles */}
        <div className="flex items-center gap-2">
          {performance.summary.hotTeamsCount > 0 && (
            <button
              onClick={() => { setHotTeamsExpanded(!hotTeamsExpanded); setColdTeamsExpanded(false); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all",
                hotTeamsExpanded 
                  ? "bg-green-500 text-white" 
                  : "bg-green-500/10 text-green-400 hover:bg-green-500/20"
              )}
              data-testid="button-expand-hot-teams"
            >
              <Flame className="w-3.5 h-3.5" />
              {performance.summary.hotTeamsCount} Hot
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", hotTeamsExpanded && "rotate-180")} />
            </button>
          )}
          {performance.summary.coldTeamsCount > 0 && (
            <button
              onClick={() => { setColdTeamsExpanded(!coldTeamsExpanded); setHotTeamsExpanded(false); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all",
                coldTeamsExpanded 
                  ? "bg-red-500 text-white" 
                  : "bg-red-500/10 text-red-400 hover:bg-red-500/20"
              )}
              data-testid="button-expand-cold-teams"
            >
              <TrendingDown className="w-3.5 h-3.5" />
              {performance.summary.coldTeamsCount} Cold
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", coldTeamsExpanded && "rotate-180")} />
            </button>
          )}
        </div>
      </div>

      {/* Expandable Hot Teams */}
      {hotTeamsExpanded && sortedHotTeams.length > 0 && (
        <div className="bg-green-500/5 rounded-lg p-3 border border-green-500/20 animate-in slide-in-from-top-2 duration-200">
          <div className="grid gap-2">
            {sortedHotTeams.map((team) => (
              <div 
                key={team.teamCode} 
                className="flex items-center gap-3 p-2 rounded-md bg-green-500/10"
              >
                <img 
                  src={teamLogos[team.teamCode] || ''} 
                  alt={team.teamName} 
                  className="w-6 h-6 object-contain"
                />
                <span className="font-medium text-white text-sm flex-1">{team.teamName}</span>
                <span className="text-xs text-muted-foreground">{team.wins}-{team.losses}</span>
                <span className="text-xs text-green-400 font-medium">{team.winRate}%</span>
                <div className="flex gap-0.5">
                  {team.recentForm.split('').slice(-5).map((r, i) => (
                    <span 
                      key={i}
                      className={cn(
                        "w-4 h-4 rounded text-[10px] font-bold flex items-center justify-center",
                        r === 'W' ? "bg-green-500/30 text-green-400" : "bg-red-500/30 text-red-400"
                      )}
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expandable Cold Teams */}
      {coldTeamsExpanded && performance.coldTeams.length > 0 && (
        <div className="bg-red-500/5 rounded-lg p-3 border border-red-500/20 animate-in slide-in-from-top-2 duration-200">
          <div className="grid gap-2">
            {performance.coldTeams.map((team) => (
              <div 
                key={team.teamCode} 
                className="flex items-center gap-3 p-2 rounded-md bg-red-500/10"
              >
                <img 
                  src={teamLogos[team.teamCode] || ''} 
                  alt={team.teamName} 
                  className="w-6 h-6 object-contain"
                />
                <span className="font-medium text-white text-sm flex-1">{team.teamName}</span>
                <span className="text-xs text-muted-foreground">{team.wins}-{team.losses}</span>
                <span className="text-xs text-red-400 font-medium">{team.winRate}%</span>
                <div className="flex gap-0.5">
                  {team.recentForm.split('').slice(-5).map((r, i) => (
                    <span 
                      key={i}
                      className={cn(
                        "w-4 h-4 rounded text-[10px] font-bold flex items-center justify-center",
                        r === 'W' ? "bg-green-500/30 text-green-400" : "bg-red-500/30 text-red-400"
                      )}
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MarketInsights() {
  const { data: schedule, isLoading, refetch } = useNHLSchedule();
  const { data: mlAnalysis, isLoading: mlLoading } = useNHLMoneylineAnalysis();
  const [expandedGame, setExpandedGame] = useState<string | null>(null);
  const [lookupTeam, setLookupTeam] = useState<string | null>(null);
  const searchString = useSearch();
  
  // Parse team from URL param (e.g., ?team=Minnesota or ?team=Wild)
  useEffect(() => {
    if (!searchString) return;
    const params = new URLSearchParams(searchString);
    const teamParam = params.get('team');
    
    if (teamParam && schedule?.nhl) {
      // Normalize by removing periods and extra spaces for matching (handles "St. Louis" vs "St Louis")
      const normalize = (s: string) => s.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
      const teamNorm = normalize(teamParam);
      const matchingGame = schedule.nhl.find(game => {
        const homeNorm = normalize(game.homeTeam);
        const awayNorm = normalize(game.awayTeam);
        return homeNorm.includes(teamNorm) || awayNorm.includes(teamNorm) ||
               teamNorm.includes(homeNorm) || teamNorm.includes(awayNorm);
      });
      if (matchingGame) {
        setExpandedGame(`${matchingGame.awayTeam}-${matchingGame.homeTeam}`);
        setLookupTeam(null);
      } else {
        // No game today - set lookup team for stats display
        const abbrev = getTeamAbbrev(teamParam);
        setLookupTeam(abbrev);
      }
    }
  }, [searchString, schedule]);
  
  // Fetch team stats when no game found today
  const { data: teamData, isLoading: teamLoading } = useTeamStats(lookupTeam);
  
  const today = new Date();
  const nhlGames = schedule?.nhl || [];

  return (
    <Layout>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-white mb-2">Market Insights</h1>
          <div className="flex items-center gap-2 text-primary">
            <Calendar className="w-4 h-4" />
            <p className="font-medium">{format(today, 'MMMM do, yyyy')}</p>
          </div>
        </div>
        
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card/50 border border-white/5 text-muted-foreground hover:text-white transition-colors"
          data-testid="button-refresh-insights"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          <span className="text-sm font-medium">Refresh</span>
        </button>
      </div>

      <div className="space-y-6">
        {/* Team Lookup Section - shows when pick links to team with no game today */}
        {lookupTeam && (
          <div className="bg-primary/5 rounded-2xl p-6 border border-primary/20">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <Search className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Team Stats Lookup</h2>
                <p className="text-xs text-muted-foreground">No game today - showing recent performance</p>
              </div>
            </div>
            
            {teamLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
              </div>
            ) : teamData?.homeTeam ? (
              <div className="bg-card/50 rounded-xl p-4 border border-white/5">
                <TeamSection team={teamData.homeTeam} label="Team Stats" />
              </div>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-4">Could not load team stats</p>
            )}
          </div>
        )}

        {/* NHL Moneyline Analysis - Hot Teams Section */}
        <div className="bg-gradient-to-br from-orange-500/10 to-red-500/10 rounded-2xl p-6 border border-orange-500/20">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center">
              <Flame className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">NHL Moneyline Analysis</h2>
              <p className="text-xs text-muted-foreground">Teams on 3+ win streaks - ML picks included when you generate picks</p>
            </div>
          </div>

          {mlLoading ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Loader2 className="w-6 h-6 text-orange-400 animate-spin" />
              <p className="text-sm text-muted-foreground">Loading hot teams...</p>
            </div>
          ) : mlAnalysis && mlAnalysis.streakTeams.length > 0 ? (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground text-center">Click a team to jump to their matchup</p>
              <div className="grid gap-4 md:grid-cols-2">
                {mlAnalysis.streakTeams.map((team, i) => {
                  // Find the matching game to create jump handler
                  const matchingGame = nhlGames.find(g => {
                    const homeAbbrev = g.homeTeamLogo?.match(/\/([A-Z]{3})_/)?.[1] || '';
                    const awayAbbrev = g.awayTeamLogo?.match(/\/([A-Z]{3})_/)?.[1] || '';
                    return homeAbbrev === team.abbreviation || awayAbbrev === team.abbreviation;
                  });
                  
                  const handleJumpToGame = matchingGame ? () => {
                    const homeAbbrev = matchingGame.homeTeamLogo?.match(/\/([A-Z]{3})_/)?.[1] || '';
                    const awayAbbrev = matchingGame.awayTeamLogo?.match(/\/([A-Z]{3})_/)?.[1] || '';
                    const gameId = `game-${awayAbbrev}-${homeAbbrev}`;
                    const gameKey = `${matchingGame.awayTeam}-${matchingGame.homeTeam}`;
                    
                    // Expand the game
                    setExpandedGame(gameKey);
                    
                    // Scroll to the game after a brief delay to allow expansion
                    setTimeout(() => {
                      document.getElementById(gameId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 100);
                  } : undefined;
                  
                  return <HotTeamCard key={i} team={team} onJumpToGame={handleJumpToGame} />;
                })}
              </div>
              <p className="text-xs text-muted-foreground text-center pt-2">{mlAnalysis.summary}</p>
            </div>
          ) : (
            <div className="text-center py-8">
              <Flame className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-white mb-1">No Hot Teams</h3>
              <p className="text-sm text-muted-foreground">No teams currently on 3+ win streaks with games today</p>
            </div>
          )}
        </div>
        
        {/* Team Performance Analytics Section */}
        <div className="bg-gradient-to-br from-orange-500/10 to-red-500/10 rounded-2xl p-6 border border-orange-500/20">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Pick Performance</h2>
              <p className="text-xs text-muted-foreground">Historical win rates from your picks - hot teams get boosted confidence</p>
            </div>
          </div>
          <TeamPerformanceSection />
        </div>
        
        <div className="bg-card/30 rounded-2xl p-6 border border-white/5">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
              <Zap className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">NHL Hockey</h2>
              <p className="text-xs text-muted-foreground">Today's games with detailed matchup analysis</p>
            </div>
          </div>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <p className="text-muted-foreground text-sm">Loading NHL schedule...</p>
            </div>
          ) : nhlGames.length > 0 ? (
            <div className="space-y-4">
              {nhlGames.map((game, i) => {
                const gameKey = `${game.awayTeam}-${game.homeTeam}`;
                return (
                  <GameCard
                    key={i}
                    game={game}
                    isExpanded={expandedGame === gameKey}
                    onToggle={() => setExpandedGame(expandedGame === gameKey ? null : gameKey)}
                  />
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12">
              <Zap className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-white mb-1">No Games Today</h3>
              <p className="text-sm text-muted-foreground">Check back tomorrow for NHL matchups</p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
