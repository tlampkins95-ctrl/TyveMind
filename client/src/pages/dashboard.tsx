import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { PickCard } from "@/components/pick-card";
import { useUser, usePicks, useUpdateStrategy, useGeneratePicks } from "@/hooks/use-betting";
import { useSportsSchedule, useTennisWinStreaks, useNHLTeamStreaks } from "@/hooks/use-sports-data";
import { useAuth } from "@/hooks/use-auth";
import { 
  Loader2, 
  BrainCircuit, 
  Save, 
  Sparkles, 
  Trophy, 
  Calendar as CalendarIcon, 
  Activity, 
  Zap, 
  Target,
  TrendingUp,
  RefreshCw
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { queryClient } from "@/lib/queryClient";
import { 
  Accordion, 
  AccordionContent, 
  AccordionItem, 
  AccordionTrigger 
} from "@/components/ui/accordion";
import { format } from "date-fns";

interface NHLGame {
  homeTeam?: string;
  awayTeam?: string;
  score?: string;
  status?: string;
  period?: string;
  clock?: string;
}

function findGameScore(pick: any, nhlGames: NHLGame[]): { score?: string; status?: string } | undefined {
  if (pick.sport?.toLowerCase() !== 'nhl') return undefined;
  
  // Extract team names from the event (e.g., "Dallas Stars at Montreal Canadiens" or "MIN Wild @ LA Kings")
  const event = pick.event?.toLowerCase() || '';
  
  // Team name mappings for common abbreviations/short names
  const teamAliases: Record<string, string[]> = {
    'new york': ['rangers', 'nyr', 'ny rangers'],
    'los angeles': ['kings', 'lak', 'la kings', 'la'],
    'minnesota': ['wild', 'min'],
    'detroit': ['red wings', 'det'],
    'ottawa': ['senators', 'ott'],
    'anaheim': ['ducks', 'ana'],
    'washington': ['capitals', 'wsh'],
    'utah': ['mammoth', 'uta'],
    'carolina': ['hurricanes', 'car'],
    'new jersey': ['devils', 'njd', 'nj'],
    'florida': ['panthers', 'fla'],
    'colorado': ['avalanche', 'col'],
    'pittsburgh': ['penguins', 'pit'],
    'dallas': ['stars', 'dal'],
    'montreal': ['canadiens', 'mtl'],
  };
  
  for (const game of nhlGames) {
    const homeTeam = game.homeTeam?.toLowerCase() || '';
    const awayTeam = game.awayTeam?.toLowerCase() || '';
    
    // Check direct match
    let homeMatch = event.includes(homeTeam);
    let awayMatch = event.includes(awayTeam);
    
    // Check aliases
    if (!homeMatch) {
      const aliases = teamAliases[homeTeam] || [];
      homeMatch = aliases.some(alias => event.includes(alias));
    }
    if (!awayMatch) {
      const aliases = teamAliases[awayTeam] || [];
      awayMatch = aliases.some(alias => event.includes(alias));
    }
    
    if (homeMatch || awayMatch) {
      // Return score if game has started, otherwise show status
      if (game.score) {
        return { score: game.score, status: game.status };
      } else if (game.status === 'Live' || game.status === 'Final') {
        return { score: '0-0', status: game.status };
      }
    }
  }
  return undefined;
}

function PicksCarousel({ picks, bankroll, nhlGames = [], hotTeams = [] }: { picks: any[]; bankroll: number; nhlGames?: NHLGame[]; hotTeams?: string[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (picks.length <= 1 || isPaused) return;
    
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % picks.length);
    }, 4000);

    return () => clearInterval(interval);
  }, [picks.length, isPaused]);

  useEffect(() => {
    if (scrollRef.current && scrollRef.current.children[currentIndex]) {
      const card = scrollRef.current.children[currentIndex] as HTMLElement;
      scrollRef.current.scrollTo({
        left: card.offsetLeft - 16,
        behavior: 'smooth'
      });
    }
  }, [currentIndex]);

  return (
    <div 
      className="relative"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div 
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {picks.map((pick, idx) => (
          <div key={pick.id} className="flex-shrink-0 w-[320px]">
            <PickCard 
              pick={pick} 
              index={idx} 
              bankroll={bankroll} 
              gameScore={findGameScore(pick, nhlGames)}
              hotTeams={hotTeams}
            />
          </div>
        ))}
      </div>
      
      {picks.length > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {picks.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentIndex(idx)}
              className={`w-2 h-2 rounded-full transition-all ${
                idx === currentIndex ? 'bg-primary w-6' : 'bg-white/20 hover:bg-white/40'
              }`}
              data-testid={`button-carousel-dot-${idx}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface TeamPerformance {
  teamCode: string;
  teamName: string;
  isHot: boolean;
}

export default function Dashboard() {
  const { data: user, isLoading: userLoading } = useUser();
  const { data: picks, isLoading: picksLoading } = usePicks();
  const { data: liveSchedule, isLoading: scheduleLoading, refetch: refetchSchedule } = useSportsSchedule();
  const { data: winStreaks, isLoading: winStreaksLoading } = useTennisWinStreaks();
  const { data: nhlTeamStreaks, isLoading: nhlStreaksLoading } = useNHLTeamStreaks();
  const { data: teamPerformance } = useQuery<{ hotTeams: TeamPerformance[] }>({
    queryKey: ['/api/teams/performance'],
  });
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const updateStrategy = useUpdateStrategy();
  const generatePicks = useGeneratePicks();
  
  const hotTeamNames = teamPerformance?.hotTeams?.flatMap(t => [t.teamCode, t.teamName].filter(Boolean)) || [];

  const [strategy, setStrategy] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [generationContext, setGenerationContext] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const today = new Date();

  // Sync local state when user data loads
  useEffect(() => {
    if (user && user.bettingStrategy && !isEditing) {
      setStrategy(user.bettingStrategy);
    }
  }, [user?.bettingStrategy, isEditing]);

  const handleSaveStrategy = () => {
    updateStrategy.mutate({ strategy }, {
      onSuccess: () => setIsEditing(false)
    });
  };

  const handleGenerate = () => {
    setIsGenerating(true);
    generatePicks.mutate({ 
      sport: "General", 
      context: generationContext || "Analyze using live ESPN/NHL API data. Verify NHL +1.5 pucklines (-200 min) and tennis win streaks."
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/picks"] });
      },
      onSettled: () => setIsGenerating(false)
    });
  };

  // Use live data if available, fallback to static
  const nhlGames = liveSchedule?.nhl || [];
  const atpMatches = liveSchedule?.tennis?.filter(m => m.league === 'ATP') || [];
  const wtaMatches = liveSchedule?.tennis?.filter(m => m.league === 'WTA') || [];

  return (
    <Layout>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-white mb-2">Dashboard</h1>
          <div className="flex items-center gap-2 text-primary">
            <CalendarIcon className="w-4 h-4" />
            <p className="font-medium">{format(today, 'MMMM do, yyyy')}</p>
          </div>
        </div>
        
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="relative overflow-hidden px-6 py-3 rounded-xl font-bold text-white bg-primary hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 hover:shadow-primary/40 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed group"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
          <span className="flex items-center gap-2">
            {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
            {isGenerating ? "Analyzing Markets..." : "Generate AI Picks"}
          </span>
        </button>
      </div>

      <AnimatePresence>
        {isGenerating && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-card/30 border border-primary/20 rounded-xl p-4 md:p-6 backdrop-blur-md mb-8"
          >
            <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
              <BrainCircuit className="w-5 h-5 text-primary animate-pulse" />
              AI Analysis in Progress
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Our AI is currently scanning live odds, analyzing your strategy preferences, and identifying value plays.
            </p>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-primary animate-progress origin-left" style={{ width: "100%" }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="surface-elevated p-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, hsl(25 95% 53% / 0.4), transparent)' }} />
            <div className="flex items-center justify-between mb-6">
              <h2 className="section-header text-xl flex items-center gap-3">
                <Target className="w-5 h-5 text-primary" />
                Live Sports Schedule
              </h2>
              <button 
                onClick={() => refetchSchedule()} 
                className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
                data-testid="button-refresh-schedule"
              >
                <RefreshCw className={`w-3 h-3 ${scheduleLoading ? 'animate-spin' : ''}`} />
                {scheduleLoading ? 'Updating...' : 'Refresh'}
              </button>
            </div>
            
            <Accordion type="single" collapsible className="space-y-4">
              {/* Tennis sections hidden - NHL only focus */}

              <AccordionItem value="nhl" className="border border-white/5 rounded-xl px-4 surface-sunken">
                <AccordionTrigger className="hover:no-underline py-4">
                  <div className="flex items-center gap-3">
                    <Zap className="w-4 h-4 text-amber-400" />
                    <span className="font-bold text-white">NHL Hockey</span>
                    <span className="text-[10px] text-muted-foreground">({nhlGames.length} games)</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <div className="space-y-4">
                    {nhlGames.length > 0 ? (
                      Object.entries(
                        nhlGames.reduce((acc, game) => {
                          const date = game.date || 'Today';
                          if (!acc[date]) acc[date] = [];
                          acc[date].push(game);
                          return acc;
                        }, {} as Record<string, typeof nhlGames>)
                      ).map(([date, games]) => (
                        <div key={date}>
                          <p className="text-xs font-bold text-primary mb-2 uppercase">{date}</p>
                          <div className="space-y-2">
                            {games.map((item, i) => (
                              <div key={i} className="flex justify-between items-center p-3 rounded-lg bg-background/40">
                                <div className="flex items-center gap-3">
                                  {item.awayTeamLogo && (
                                    <img src={item.awayTeamLogo} alt={item.awayTeam} className="w-6 h-6 object-contain" />
                                  )}
                                  <span className="text-xs text-muted-foreground">@</span>
                                  {item.homeTeamLogo && (
                                    <img src={item.homeTeamLogo} alt={item.homeTeam} className="w-6 h-6 object-contain" />
                                  )}
                                  <p className="text-sm font-bold text-white ml-2">{item.awayTeam} @ {item.homeTeam}</p>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                  {(item.status === 'Final' || item.status === 'Live') && item.score ? (
                                    <span className="text-sm font-bold text-white">{item.score}</span>
                                  ) : (
                                    <span className="text-[10px] font-bold text-primary uppercase">{item.time}</span>
                                  )}
                                  {item.status === 'Live' && (item.period || item.clock) ? (
                                    <span className="text-[9px] uppercase text-red-400 animate-pulse">
                                      {item.period}{item.clock ? ` ${item.clock}` : ''}
                                    </span>
                                  ) : (
                                    <span className={`text-[9px] uppercase ${item.status === 'Live' ? 'text-red-400 animate-pulse' : item.status === 'Final' ? 'text-muted-foreground' : 'text-sky-400'}`}>{item.status}</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">No NHL games found</p>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="winstreaks" className="border border-white/5 rounded-xl px-4 surface-sunken">
                <AccordionTrigger className="hover:no-underline py-4">
                  <div className="flex items-center gap-3">
                    <Target className="w-4 h-4 text-green-400" />
                    <span className="font-bold text-white">Active Win Streaks</span>
                    <span className="text-[10px] text-muted-foreground">
                      {(winStreaksLoading || nhlStreaksLoading) ? 'Loading...' : `(${(nhlTeamStreaks?.length || 0) + (winStreaks?.length || 0)} total)`}
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <div className="space-y-4">
                    {/* NHL Teams Section */}
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-2 font-semibold uppercase">NHL Teams (3+ wins)</p>
                      <div className="space-y-2">
                        {nhlStreaksLoading ? (
                          <div className="flex items-center gap-2 py-2">
                            <Loader2 className="w-4 h-4 text-primary animate-spin" />
                            <span className="text-[10px] text-muted-foreground">Loading NHL streaks...</span>
                          </div>
                        ) : nhlTeamStreaks && nhlTeamStreaks.length > 0 ? (
                          nhlTeamStreaks.slice(0, 5).map((team, i) => (
                            <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-background/40">
                              {team.logo && (
                                <img src={team.logo} alt={team.name} className="w-8 h-8 object-contain" />
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] font-bold text-sky-400 uppercase">NHL</span>
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-bold">
                                    {team.winStreak}W Streak
                                  </span>
                                </div>
                                <p className="text-sm font-bold text-white truncate">{team.name}</p>
                                <p className="text-[10px] text-muted-foreground">{team.record}</p>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-[10px] text-muted-foreground py-2">No NHL teams on 3+ win streaks</p>
                        )}
                      </div>
                    </div>

                    {/* Tennis Players Section - Hidden, NHL only focus */}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>

          <div className="surface-elevated p-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, hsl(25 95% 53% / 0.4), transparent)' }} />
            <div className="flex items-center justify-between mb-6">
              <h2 className="section-header text-xl flex items-center gap-3">
                <Target className="w-5 h-5 text-primary" />
                My Picks
              </h2>
            </div>
            
            {picksLoading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <p className="text-muted-foreground text-sm">Loading your picks...</p>
              </div>
            ) : picks && picks.filter(p => p.status === 'pending').length > 0 ? (
              <PicksCarousel picks={[...picks].filter(p => p.status === 'pending').sort((a, b) => {
                // Sort by odds from lowest to highest (e.g., -200 before -150) - more juice first
                const parseOdds = (odds: string | null) => {
                  if (!odds) return -999;
                  const num = parseInt(odds.replace(/[^-\d]/g, ''));
                  return isNaN(num) ? -999 : num;
                };
                return parseOdds(a.odds) - parseOdds(b.odds);
              })} bankroll={user?.bankroll || 1000} nhlGames={nhlGames} hotTeams={hotTeamNames} />
            ) : (
              <div className="text-center py-12">
                <div className="w-12 h-12 bg-secondary rounded-full flex items-center justify-center mx-auto mb-3 border border-white/5">
                  <Trophy className="w-6 h-6 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-bold text-white mb-1">No Picks Yet</h3>
                <p className="text-sm text-muted-foreground">Generate AI picks to get started</p>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-1 space-y-6">
          <div className="stat-card relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 opacity-20" style={{ background: 'radial-gradient(circle, hsl(25 95% 53% / 0.5) 0%, transparent 70%)' }} />
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-header text-xl flex items-center gap-3">
                <BrainCircuit className="w-5 h-5 text-primary" />
                Strategy DNA
              </h2>
              {isAuthenticated && (
                !isEditing ? (
                  <button onClick={() => setIsEditing(true)} className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors" data-testid="button-edit-strategy">
                    Edit
                  </button>
                ) : (
                  <button onClick={handleSaveStrategy} disabled={updateStrategy.isPending} className="flex items-center gap-1.5 text-xs font-bold text-sky-500 hover:text-sky-400 bg-sky-500/10 px-3 py-1.5 rounded-lg transition-colors" data-testid="button-save-strategy">
                    {updateStrategy.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    Save
                  </button>
                )
              )}
            </div>
            <div className="h-64 overflow-y-auto pr-2 text-sm text-muted-foreground leading-relaxed">
              {!isAuthenticated && !authLoading ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <BrainCircuit className="w-12 h-12 text-muted-foreground/30 mb-4" />
                  <p className="text-sm text-muted-foreground mb-4">Log in to view and edit your betting strategy</p>
                  <a 
                    href="/api/login" 
                    className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                    data-testid="link-login-strategy"
                  >
                    Log In
                  </a>
                </div>
              ) : isEditing ? (
                <textarea
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value)}
                  className="w-full h-full bg-secondary/50 rounded-xl p-4 text-sm text-foreground resize-none border border-white/10 outline-none"
                  data-testid="textarea-strategy"
                />
              ) : (
                user?.bettingStrategy || "No strategy defined."
              )}
            </div>
          </div>

          <div className="bg-card/50 rounded-2xl p-6 border border-white/5">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-sky-500" />
              Today's Stats
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-secondary/50 text-center">
                <p className="text-[10px] text-muted-foreground uppercase font-bold mb-1">Total Picks</p>
                <p className="text-2xl font-display font-bold text-white">{picks?.length || 0}</p>
              </div>
              <div className="p-4 rounded-xl bg-secondary/50 text-center">
                <p className="text-[10px] text-muted-foreground uppercase font-bold mb-1">Bankroll</p>
                <p className="text-2xl font-display font-bold text-primary">${user?.bankroll || 1000}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
