import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Layout } from "@/components/layout";
import { 
  Loader2, 
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Calendar,
  Search,
  Users,
  Swords,
  ArrowLeft
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";

interface TennisMatch {
  date: string;
  opponent: string;
  result: 'W' | 'L';
  score: string;
  tournament: string;
  surface: string;
}

interface TennisPlayer {
  name: string;
  slug: string;
  country?: string;
  rank?: number;
  last10: TennisMatch[];
  recentWins: number;
  recentLosses: number;
}

interface TennisH2H {
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

interface TennisMatchup {
  player1: TennisPlayer | null;
  player2: TennisPlayer | null;
  h2h: TennisH2H | null;
}

interface KambiTennisOdds {
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

interface KambiTennisResponse {
  all: KambiTennisOdds[];
  favorable: KambiTennisOdds[];
  summary: string;
}

interface TennisEvent {
  event: string;
  player1: string;
  player2: string;
  time: string;
  status: string;
  tour: string;
  surface?: string;
}

function useTennisSchedule() {
  return useQuery<{ tennis: TennisEvent[] }>({
    queryKey: ["/api/sports/schedule"],
    select: (data: any) => {
      const tennisEvents: TennisEvent[] = [];
      if (data?.tennis) {
        for (const match of data.tennis) {
          // Player names are in homeTeam/awayTeam, not event field
          const player1 = match.homeTeam || '';
          const player2 = match.awayTeam || '';
          
          // Only show matches with actual player names (not TBD)
          if (player1 && player2 && player1 !== 'TBD' && player2 !== 'TBD') {
            tennisEvents.push({
              event: match.event || 'Tennis',
              player1: player1.trim(),
              player2: player2.trim(),
              time: match.time || 'TBD',
              status: match.status || 'Scheduled',
              tour: match.league || 'ATP',
              surface: match.surface
            });
          }
        }
      }
      return { tennis: tennisEvents };
    },
    refetchInterval: 60000,
  });
}

function useKambiTennisMatches() {
  return useQuery<TennisEvent[]>({
    queryKey: ["/api/odds/tennis", "matches"],
    select: (data: any) => {
      const events: TennisEvent[] = [];
      const seen = new Set<string>();
      
      for (const match of data?.all || []) {
        const key = `${match.player1}-${match.player2}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        
        events.push({
          event: match.tournament || match.league || 'Tennis',
          player1: match.player1,
          player2: match.player2,
          time: match.startTime ? new Date(match.startTime).toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            timeZone: 'America/Chicago'
          }) + ' CT' : 'TBD',
          status: match.status === 'STARTED' ? 'Live' : 'Scheduled',
          tour: match.league?.includes('WTA') ? 'WTA' : 'ATP',
          surface: 'hard'
        });
      }
      return events;
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchInterval: 60000,
  });
}

function normalizePlayerName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function useTennisMatchup(player1: string, player2: string, enabled: boolean, league?: string) {
  const p1 = normalizePlayerName(player1);
  const p2 = normalizePlayerName(player2);
  const normalizedLeague = league?.trim().toUpperCase() || '';
  
  return useQuery<TennisMatchup>({
    queryKey: ['/api/tennis/matchup', p1, p2, normalizedLeague],
    queryFn: async () => {
      const url = `/api/tennis/matchup?player1=${encodeURIComponent(player1.trim())}&player2=${encodeURIComponent(player2.trim())}${league ? `&league=${encodeURIComponent(league.trim())}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch matchup');
      return res.json();
    },
    enabled,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });
}

function useTennisPlayer(playerName: string, enabled: boolean) {
  return useQuery<TennisPlayer>({
    queryKey: [`/api/tennis/player/${encodeURIComponent(playerName)}`],
    enabled: enabled && !!playerName,
    staleTime: 300000,
  });
}

function useKambiTennisOdds() {
  return useQuery<KambiTennisResponse>({
    queryKey: ['/api/odds/tennis'],
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });
}

function findOddsForMatchup(odds: KambiTennisOdds[], player1: string, player2: string): KambiTennisOdds | null {
  if (!odds) return null;
  const p1Lower = player1.toLowerCase();
  const p2Lower = player2.toLowerCase();
  
  return odds.find(o => {
    const op1Lower = o.player1.toLowerCase();
    const op2Lower = o.player2.toLowerCase();
    return (op1Lower.includes(p1Lower) || p1Lower.includes(op1Lower.split(' ').pop() || '')) &&
           (op2Lower.includes(p2Lower) || p2Lower.includes(op2Lower.split(' ').pop() || ''));
  }) || null;
}

function parseOdds(odds: string): number {
  if (!odds) return 0;
  const num = Number(odds.trim());
  return isNaN(num) ? 0 : num;
}

function StreakBadge({ wins, losses }: { wins: number; losses: number }) {
  const isHotStreak = wins >= 7;
  const isColdStreak = losses >= 4;
  
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold",
      isHotStreak ? "bg-green-500/20 text-green-400" : 
      isColdStreak ? "bg-red-500/20 text-red-400" : 
      "bg-muted text-muted-foreground"
    )}>
      {isHotStreak ? <TrendingUp className="w-3 h-3" /> : 
       isColdStreak ? <TrendingDown className="w-3 h-3" /> : null}
      {wins}W-{losses}L
    </span>
  );
}

function SurfaceBadge({ surface }: { surface: string }) {
  const surfaceLower = surface.toLowerCase();
  return (
    <span className={cn(
      "text-xs px-1.5 py-0.5 rounded font-medium",
      surfaceLower.includes('clay') ? "bg-orange-500/20 text-orange-400" :
      surfaceLower.includes('grass') ? "bg-green-500/20 text-green-400" :
      "bg-blue-500/20 text-blue-400"
    )}>
      {surface}
    </span>
  );
}

function TourBadge({ tour }: { tour: string }) {
  const isWTA = tour.toLowerCase().includes('wta');
  return (
    <span className={cn(
      "text-xs px-2 py-0.5 rounded font-bold",
      isWTA ? "bg-pink-500/20 text-pink-400" : "bg-sky-500/20 text-sky-400"
    )}>
      {isWTA ? 'WTA' : 'ATP'}
    </span>
  );
}

function MatchCard({ match, isExpanded, onToggle }: { 
  match: TennisEvent; 
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { data: matchup, isLoading } = useTennisMatchup(
    match.player1, 
    match.player2, 
    isExpanded,
    match.tour
  );

  return (
    <div className="bg-card/50 rounded-xl border border-white/5 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-center justify-between hover-elevate transition-all"
        data-testid={`button-match-${match.player1}-${match.player2}`}
      >
        <div className="flex items-center gap-4">
          <TourBadge tour={match.tour} />
          <div className="text-left">
            <p className="font-bold text-white">{match.player1} vs {match.player2}</p>
            <div className="flex items-center gap-2 mt-1">
              {match.surface && <SurfaceBadge surface={match.surface} />}
              <span className="text-xs text-muted-foreground">{match.time}</span>
            </div>
          </div>
        </div>
        <span className={cn(
          "text-xs uppercase font-medium px-2 py-1 rounded",
          match.status === 'Live' ? "bg-red-500/20 text-red-400 animate-pulse" : 
          match.status === 'Final' ? "bg-muted text-muted-foreground" : 
          "bg-sky-500/10 text-sky-400"
        )}>{match.status}</span>
      </button>

      {isExpanded && (
        <div className="border-t border-white/5 p-4 space-y-6 bg-background/30">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          ) : matchup ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {matchup.player1 && (
                  <div className="bg-card/50 rounded-xl p-4 border border-primary/20">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs uppercase font-bold text-primary px-2 py-0.5 bg-primary/10 rounded">Player 1</span>
                    </div>
                    <PlayerSection player={matchup.player1} />
                  </div>
                )}
                {matchup.player2 && (
                  <div className="bg-card/50 rounded-xl p-4 border border-white/10">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs uppercase font-bold text-muted-foreground px-2 py-0.5 bg-muted/20 rounded">Player 2</span>
                    </div>
                    <PlayerSection player={matchup.player2} />
                  </div>
                )}
              </div>

              {matchup.h2h && (
                <div>
                  <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                    <Users className="w-4 h-4 text-primary" />
                    Head-to-Head: {matchup.h2h.player1Wins} - {matchup.h2h.player2Wins}
                  </h4>
                  {matchup.h2h.matches.length > 0 ? (
                    <div className="space-y-2">
                      {matchup.h2h.matches.slice(0, 10).map((h2hMatch, i) => (
                        <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-card/50 text-sm gap-2">
                          <span className="text-xs text-muted-foreground shrink-0">{h2hMatch.date}</span>
                          <span className="text-white truncate flex-1 text-center">{h2hMatch.tournament}</span>
                          <SurfaceBadge surface={h2hMatch.surface} />
                          <span className="text-xs font-bold text-primary shrink-0">{h2hMatch.winner}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">No previous H2H matches found</p>
                  )}
                </div>
              )}
              
              {!matchup.player1 && !matchup.player2 && (
                <p className="text-center text-muted-foreground py-4">Could not find player data on TennisExplorer</p>
              )}
            </>
          ) : (
            <p className="text-center text-muted-foreground py-4">Unable to load matchup details</p>
          )}
        </div>
      )}
    </div>
  );
}

function PlayerSection({ player }: { player: TennisPlayer }) {
  return (
    <div className="space-y-3" data-testid={`player-section-${player.name.replace(/\s+/g, '-').toLowerCase()}`}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
          {player.name.charAt(0)}
        </div>
        <div>
          <p className="font-bold text-white" data-testid="text-player-name">{player.name}</p>
          <div className="flex items-center gap-2">
            {player.rank && <span className="text-xs text-muted-foreground" data-testid="text-player-rank">Rank #{player.rank}</span>}
            {player.country && <span className="text-xs text-muted-foreground" data-testid="text-player-country">{player.country}</span>}
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Last 10:</span>
        <StreakBadge wins={player.recentWins} losses={player.recentLosses} />
      </div>

      <div>
        <p className="text-xs font-bold text-muted-foreground mb-2 uppercase">Recent Matches</p>
        <div className="space-y-1">
          {player.last10.map((match, i) => (
            <div key={i} className="flex items-center gap-2 text-xs p-1.5 rounded bg-card/50">
              <span className={cn(
                "font-bold w-4",
                match.result === 'W' ? "text-green-400" : "text-red-400"
              )}>{match.result}</span>
              <span className="text-white truncate flex-1">{match.opponent}</span>
              <SurfaceBadge surface={match.surface} />
              <span className="text-muted-foreground shrink-0">{match.date}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PlayerLookup() {
  const [searchName, setSearchName] = useState('');
  const [lookupName, setLookupName] = useState('');
  
  const { data: player, isLoading, error } = useTennisPlayer(lookupName, !!lookupName);
  
  const handleSearch = () => {
    if (searchName.trim()) {
      setLookupName(searchName.trim());
    }
  };
  
  return (
    <div className="bg-primary/5 rounded-2xl p-6 border border-primary/20">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
          <Search className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Player Lookup</h2>
          <p className="text-xs text-muted-foreground">Search for any tennis player's recent form</p>
        </div>
      </div>
      
      <div className="flex gap-2 mb-4">
        <Input
          placeholder="Enter player name (e.g., Sinner)"
          value={searchName}
          onChange={(e) => setSearchName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          className="flex-1"
          data-testid="input-player-search"
        />
        <Button onClick={handleSearch} disabled={!searchName.trim()} data-testid="button-player-search">
          <Search className="w-4 h-4" />
        </Button>
      </div>
      
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
        </div>
      )}
      
      {error && (
        <p className="text-muted-foreground text-sm text-center py-4" data-testid="text-player-not-found">Player not found. Try a different spelling.</p>
      )}
      
      {player && (
        <div className="bg-card/50 rounded-xl p-4 border border-white/5" data-testid="container-player-result">
          <PlayerSection player={player} />
        </div>
      )}
    </div>
  );
}

function H2HComparisonView({ player1Name, player2Name, league }: { player1Name: string; player2Name: string; league?: string }) {
  const { data: matchup, isLoading, error } = useTennisMatchup(player1Name, player2Name, true, league);
  const { data: kambiOdds } = useKambiTennisOdds();
  
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
        <p className="text-muted-foreground">Loading head-to-head comparison...</p>
      </div>
    );
  }
  
  if (error || !matchup) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Could not load player comparison. Try different player names.</p>
      </div>
    );
  }
  
  const { player1, player2, h2h } = matchup;
  const liveOdds = kambiOdds?.all ? findOddsForMatchup(kambiOdds.all, player1Name, player2Name) : null;
  
  return (
    <div className="space-y-6" data-testid="container-h2h-comparison">
      {liveOdds && (
        <div className="bg-gradient-to-r from-green-500/10 to-blue-500/10 rounded-2xl p-6 border border-green-500/20">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Kambi/Potawatomi Odds</h2>
              <p className="text-xs text-muted-foreground">{liveOdds.tournament} - Live betting lines</p>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className={cn(
              "p-4 rounded-xl text-center",
              parseOdds(liveOdds.player1Odds) < 0 ? "bg-green-500/20 border border-green-500/30" : "bg-card/50 border border-white/5"
            )}>
              <p className="text-sm text-muted-foreground mb-1">{liveOdds.player1}</p>
              <p className={cn(
                "text-2xl font-bold",
                parseOdds(liveOdds.player1Odds) < 0 ? "text-green-400" : "text-white"
              )}>
                {liveOdds.player1Odds}
              </p>
              {parseOdds(liveOdds.player1Odds) < 0 && (
                <p className="text-xs text-green-400 mt-1">Favorite</p>
              )}
            </div>
            <div className={cn(
              "p-4 rounded-xl text-center",
              parseOdds(liveOdds.player2Odds) < 0 ? "bg-green-500/20 border border-green-500/30" : "bg-card/50 border border-white/5"
            )}>
              <p className="text-sm text-muted-foreground mb-1">{liveOdds.player2}</p>
              <p className={cn(
                "text-2xl font-bold",
                parseOdds(liveOdds.player2Odds) < 0 ? "text-green-400" : "text-white"
              )}>
                {liveOdds.player2Odds}
              </p>
              {parseOdds(liveOdds.player2Odds) < 0 && (
                <p className="text-xs text-green-400 mt-1">Favorite</p>
              )}
            </div>
          </div>
          
          <p className="text-xs text-muted-foreground text-center mt-3">
            {liveOdds.league} - {liveOdds.status}
          </p>
        </div>
      )}
      
      <div className="bg-card/30 rounded-2xl p-6 border border-white/5">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
            <Swords className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Head-to-Head Record</h2>
            <p className="text-xs text-muted-foreground">Historical matchup data</p>
          </div>
        </div>
        
        {h2h && (
          <div className="bg-card/50 rounded-xl p-4 border border-white/5 mb-6">
            <div className="flex items-center justify-center gap-8">
              <div className="text-center flex-1">
                <p className="text-4xl font-bold text-green-400">{h2h.player1Wins}</p>
                <p className="text-sm text-muted-foreground mt-1">{h2h.player1Name}</p>
              </div>
              <div className="text-muted-foreground text-3xl font-bold">-</div>
              <div className="text-center flex-1">
                <p className="text-4xl font-bold text-green-400">{h2h.player2Wins}</p>
                <p className="text-sm text-muted-foreground mt-1">{h2h.player2Name}</p>
              </div>
            </div>
            
            {h2h.matches && h2h.matches.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/5">
                <p className="text-xs font-bold text-muted-foreground mb-3 uppercase">Match History</p>
                <div className="space-y-2">
                  {h2h.matches.slice(0, 8).map((match, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs p-2 rounded bg-background/50">
                      <span className="text-muted-foreground shrink-0 w-20">{match.date}</span>
                      <span className="text-green-400 font-bold w-32 truncate">{match.winner}</span>
                      <span className="text-muted-foreground truncate flex-1">{match.tournament}</span>
                      <span className="text-white shrink-0">{match.score}</span>
                      <SurfaceBadge surface={match.surface} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        
        <p className="text-xs font-bold text-muted-foreground mb-4 uppercase">Player Stats Comparison</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {player1 && (
            <div className="bg-card/50 rounded-xl p-4 border border-white/5" data-testid="container-h2h-player1">
              <PlayerSection player={player1} />
            </div>
          )}
          {player2 && (
            <div className="bg-card/50 rounded-xl p-4 border border-white/5" data-testid="container-h2h-player2">
              <PlayerSection player={player2} />
            </div>
          )}
        </div>
        
        {!player1 && !player2 && (
          <p className="text-muted-foreground text-center py-8">Could not find player statistics</p>
        )}
      </div>
    </div>
  );
}

export default function TennisInsights() {
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const urlPlayer1 = params.get('player1')?.trim() || null;
  const urlPlayer2 = params.get('player2')?.trim() || null;
  const urlLeague = params.get('league')?.trim().toUpperCase() || undefined;
  const queryClient = useQueryClient();
  
  const { data: schedule, isLoading: scheduleLoading, refetch } = useTennisSchedule();
  const { data: kambiMatches, isLoading: kambiLoading } = useKambiTennisMatches();
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);
  
  // Invalidate matchup cache when URL params change to ensure fresh data
  useEffect(() => {
    if (urlPlayer1 && urlPlayer2) {
      const p1 = normalizePlayerName(urlPlayer1);
      const p2 = normalizePlayerName(urlPlayer2);
      queryClient.invalidateQueries({ queryKey: ['/api/tennis/matchup', p1, p2] });
    }
  }, [urlPlayer1, urlPlayer2, queryClient]);
  
  const today = new Date();
  const isLoading = scheduleLoading || kambiLoading;
  
  // Merge matches from Kambi (has real player names) and ESPN schedule
  const tennisMatches = (() => {
    const merged: TennisEvent[] = [];
    const seen = new Set<string>();
    
    // Add Kambi matches first (has real player names)
    for (const match of kambiMatches || []) {
      const key = `${match.player1}-${match.player2}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(match);
      }
    }
    
    // Add ESPN schedule matches that aren't already included
    for (const match of schedule?.tennis || []) {
      const key = `${match.player1}-${match.player2}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(match);
      }
    }
    
    return merged;
  })();
  
  const showH2HView = urlPlayer1 && urlPlayer2;

  return (
    <Layout>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          {showH2HView ? (
            <>
              <Link href="/tennis-insights" className="flex items-center gap-2 text-muted-foreground hover:text-white transition-colors mb-2">
                <ArrowLeft className="w-4 h-4" />
                <span className="text-sm">Back to Tennis Insights</span>
              </Link>
              <h1 className="text-3xl font-display font-bold text-white mb-2">
                {urlPlayer1} vs {urlPlayer2}
              </h1>
            </>
          ) : (
            <>
              <h1 className="text-3xl font-display font-bold text-white mb-2">Tennis Insights</h1>
              <div className="flex items-center gap-2 text-primary">
                <Calendar className="w-4 h-4" />
                <p className="font-medium">{format(today, 'MMMM do, yyyy')}</p>
              </div>
            </>
          )}
        </div>
        
        {!showH2HView && (
          <Button
            variant="ghost"
            onClick={() => refetch()}
            className="flex items-center gap-2"
            data-testid="button-refresh-tennis"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span className="text-sm font-medium">Refresh</span>
          </Button>
        )}
      </div>

      {showH2HView ? (
        <H2HComparisonView player1Name={urlPlayer1} player2Name={urlPlayer2} league={urlLeague} />
      ) : (
        <div className="space-y-6">
          <PlayerLookup />
          
          <div className="bg-card/30 rounded-2xl p-6 border border-white/5">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Today's Matches</h2>
                <p className="text-xs text-muted-foreground">ATP & WTA matches with player form analysis</p>
              </div>
            </div>

            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <p className="text-muted-foreground text-sm">Loading tennis schedule...</p>
              </div>
            ) : tennisMatches.length > 0 ? (
              <div className="space-y-4">
                {tennisMatches.map((match, i) => {
                  const matchKey = `${match.player1}-${match.player2}`;
                  return (
                    <MatchCard
                      key={i}
                      match={match}
                      isExpanded={expandedMatch === matchKey}
                      onToggle={() => setExpandedMatch(expandedMatch === matchKey ? null : matchKey)}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12">
                <Calendar className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-white mb-1">No Matches Today</h3>
                <p className="text-sm text-muted-foreground">Check back later for ATP & WTA matches</p>
              </div>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
