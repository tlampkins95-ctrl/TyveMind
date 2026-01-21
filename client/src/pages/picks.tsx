import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { 
  Accordion, 
  AccordionContent, 
  AccordionItem, 
  AccordionTrigger 
} from "@/components/ui/accordion";
import { Layout } from "@/components/layout";
import { PickCard } from "@/components/pick-card";
import { usePicks, useUser } from "@/hooks/use-betting";
import { Loader2, Trophy, BrainCircuit, Activity, Zap, Wallet, Clock, CalendarClock } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function classifyPickTime(scheduledTime: string | null, createdAt?: Date | string | null, scheduledAt?: Date | string | null): 'live' | 'upcoming' {
  // Get today's date in Central Time (America/Chicago)
  const now = new Date();
  const todayCT = now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); // YYYY-MM-DD format
  
  // PRIMARY: Use scheduledAt timestamp (UTC) for accurate classification
  if (scheduledAt) {
    const scheduled = new Date(scheduledAt);
    if (!isNaN(scheduled.getTime())) {
      // Convert scheduled time to Central Time date for comparison
      const scheduledDateCT = scheduled.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
      // Compare as strings (YYYY-MM-DD format sorts correctly)
      return scheduledDateCT > todayCT ? 'upcoming' : 'live';
    }
  }
  
  // SECONDARY: Check for explicit text indicators in scheduledTime
  if (scheduledTime) {
    const lower = scheduledTime.toLowerCase();
    if (lower.includes('live') || lower.includes('today')) {
      return 'live';
    }
    if (lower.includes('tomorrow')) {
      return 'upcoming';
    }
    
    // Try to parse scheduledTime as a date
    const scheduled = new Date(scheduledTime);
    if (!isNaN(scheduled.getTime())) {
      const scheduledDateCT = scheduled.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
      return scheduledDateCT > todayCT ? 'upcoming' : 'live';
    }
  }
  
  // FALLBACK: use createdAt (legacy picks without scheduledAt)
  if (createdAt) {
    const created = new Date(createdAt);
    if (!isNaN(created.getTime())) {
      const createdDateCT = created.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
      return createdDateCT === todayCT ? 'live' : 'upcoming';
    }
  }
  
  return 'upcoming';
}

interface TeamPerformance {
  teamCode: string;
  teamName: string;
  isHot: boolean;
}

export default function PicksPage() {
  const { data: picks, isLoading: picksLoading } = usePicks();
  const { data: user } = useUser();
  const { data: teamPerformance } = useQuery<{ hotTeams: TeamPerformance[] }>({
    queryKey: ['/api/teams/performance'],
  });
  const [tennisFilter, setTennisFilter] = useState<'live' | 'upcoming'>('live');
  const [nhlFilter, setNhlFilter] = useState<'live' | 'upcoming'>('live');
  
  const hotTeamNames = teamPerformance?.hotTeams?.flatMap(t => [t.teamCode, t.teamName].filter(Boolean)) || [];

  const tennisPicks = picks?.filter(p => p.sport === "Tennis") || [];
  const nhlPicks = picks?.filter(p => p.sport === "NHL") || [];

  const pendingTennisPicks = tennisPicks.filter(p => p.status === 'pending');
  const completedTennisPicks = tennisPicks.filter(p => p.status !== 'pending');
  const pendingNhlPicks = nhlPicks.filter(p => p.status === 'pending');
  const completedNhlPicks = nhlPicks.filter(p => p.status !== 'pending');
  
  const liveTennisPicks = pendingTennisPicks.filter(p => classifyPickTime(p.scheduledTime, p.createdAt, p.scheduledAt) === 'live');
  const upcomingTennisPicks = pendingTennisPicks.filter(p => classifyPickTime(p.scheduledTime, p.createdAt, p.scheduledAt) === 'upcoming');
  const liveNhlPicks = pendingNhlPicks.filter(p => classifyPickTime(p.scheduledTime, p.createdAt, p.scheduledAt) === 'live');
  const upcomingNhlPicks = pendingNhlPicks.filter(p => classifyPickTime(p.scheduledTime, p.createdAt, p.scheduledAt) === 'upcoming');
  
  const activeTennisPicks = tennisFilter === 'live' ? liveTennisPicks : upcomingTennisPicks;
  const activeNhlPicks = nhlFilter === 'live' ? liveNhlPicks : upcomingNhlPicks;

  return (
    <Layout>
      <div className="flex flex-col gap-8">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-display font-bold text-white mb-2">My Picks</h1>
            <p className="text-muted-foreground">
              Strategic selections based on your AI-driven betting strategy.
            </p>
          </div>
          <div className="stat-card-glow flex items-center gap-3 py-3 px-5">
            <Wallet className="w-5 h-5 text-primary" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Bankroll</p>
              <p className="text-xl font-bold glow-text">${user?.bankroll || 1000}</p>
            </div>
          </div>
        </div>

        {/* NHL Only - Tennis tab hidden */}
        <div className="w-full space-y-8">
            <div className="bg-card/30 border border-primary/20 rounded-2xl p-6 backdrop-blur-md max-w-2xl">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <BrainCircuit className="w-5 h-5 text-primary" />
                NHL Hockey Strategy
              </h3>
              <ul className="space-y-3 text-sm text-muted-foreground list-disc pl-5">
                <li>NHL: Analyzing Kambi (Potawatomi) for +1.5 pucklines (-200 odds minimum).</li>
                <li>H2H History: Verifying last 20 head-to-head via Aiscore.</li>
                <li>Filtering: High probability of staying within 1 goal.</li>
              </ul>
            </div>

            <div className="flex items-center justify-between">
              <Select value={nhlFilter} onValueChange={(v) => setNhlFilter(v as 'live' | 'upcoming')}>
                <SelectTrigger className="w-[180px] bg-card/50 border-white/10" data-testid="select-nhl-filter">
                  <SelectValue placeholder="Filter picks" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="live" data-testid="select-nhl-live">
                    <span className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Today ({liveNhlPicks.length})
                    </span>
                  </SelectItem>
                  <SelectItem value="upcoming" data-testid="select-nhl-upcoming">
                    <span className="flex items-center gap-2">
                      <CalendarClock className="w-4 h-4" />
                      Upcoming ({upcomingNhlPicks.length})
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-4">
              {picksLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>
              ) : activeNhlPicks.length > 0 ? (
                activeNhlPicks.sort((a, b) => {
                  // Sort by odds from lowest to highest (e.g., -200 before -150) - more juice first
                  const parseOdds = (odds: string | null) => {
                    if (!odds) return -999;
                    const num = parseInt(odds.replace(/[^-\d]/g, ''));
                    return isNaN(num) ? -999 : num;
                  };
                  return parseOdds(a.odds) - parseOdds(b.odds);
                }).map((pick, idx) => (
                  <PickCard key={pick.id} pick={pick} index={idx} bankroll={user?.bankroll || 1000} hotTeams={hotTeamNames} />
                ))
              ) : pendingNhlPicks.length > 0 ? (
                <FilterEmptyState 
                  filter={nhlFilter} 
                  otherCount={nhlFilter === 'live' ? upcomingNhlPicks.length : liveNhlPicks.length}
                  onSwitch={() => setNhlFilter(nhlFilter === 'live' ? 'upcoming' : 'live')}
                />
              ) : completedNhlPicks.length === 0 ? (
                <EmptyState sport="NHL" />
              ) : null}

              {completedNhlPicks.length > 0 && (
                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="completed-nhl" className="border-none">
                    <AccordionTrigger className="flex gap-2 items-center text-muted-foreground hover:text-white hover:no-underline py-4 px-0">
                      <span className="text-sm font-bold uppercase tracking-widest">Completed Picks ({completedNhlPicks.length})</span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 pt-4 pb-8">
                      {completedNhlPicks.map((pick, idx) => (
                        <PickCard key={pick.id} pick={pick} index={idx} bankroll={user?.bankroll || 1000} hotTeams={hotTeamNames} />
                      ))}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}
            </div>
        </div>
      </div>
    </Layout>
  );
}

function EmptyState({ sport }: { sport: string }) {
  return (
    <div className="text-center py-20 bg-card/30 rounded-2xl border border-white/5">
      <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mx-auto mb-4 border border-white/5">
        <Trophy className="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 className="text-xl font-bold text-white mb-2">No {sport} Picks</h3>
      <p className="text-muted-foreground max-w-sm mx-auto">
        Run AI analysis on the Dashboard to find the latest strategic {sport} opportunities.
      </p>
    </div>
  );
}

function FilterEmptyState({ filter, otherCount, onSwitch }: { filter: 'live' | 'upcoming'; otherCount: number; onSwitch: () => void }) {
  return (
    <div className="text-center py-12 bg-card/30 rounded-2xl border border-white/5">
      <div className="w-12 h-12 bg-secondary rounded-full flex items-center justify-center mx-auto mb-4 border border-white/5">
        {filter === 'live' ? <Clock className="w-6 h-6 text-muted-foreground" /> : <CalendarClock className="w-6 h-6 text-muted-foreground" />}
      </div>
      <h3 className="text-lg font-bold text-white mb-2">
        No {filter === 'live' ? "Today's" : 'Upcoming'} Picks
      </h3>
      {otherCount > 0 && (
        <button 
          onClick={onSwitch}
          className="text-primary hover:underline text-sm"
          data-testid="button-switch-filter"
        >
          View {otherCount} {filter === 'live' ? 'upcoming' : "today's"} pick{otherCount !== 1 ? 's' : ''}
        </button>
      )}
    </div>
  );
}
