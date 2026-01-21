import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, CheckCircle, XCircle, Clock, ExternalLink, Flame, ChevronDown, RotateCcw } from "lucide-react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import type { Pick } from "@shared/schema";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";

// Map abbreviations to searchable team names (includes common variations)
const abbrevToTeam: Record<string, string> = {
  'TB': 'Tampa Bay', 'TBL': 'Tampa Bay',
  'COL': 'Colorado', 'VGS': 'Vegas', 'VGK': 'Vegas',
  'DAL': 'Dallas', 'CAR': 'Carolina',
  'WPG': 'Winnipeg', 'MIN': 'Minnesota',
  'SEA': 'Seattle', 'CGY': 'Calgary',
  'FLA': 'Florida', 'PIT': 'Pittsburgh',
  'MTL': 'Montreal', 'NYR': 'New York', 'NY': 'New York',
  'NJD': 'New Jersey', 'NJ': 'New Jersey', 'DET': 'Detroit',
  'OTT': 'Ottawa', 'ANA': 'Anaheim',
  'WSH': 'Washington', 'UTA': 'Utah',
  'BOS': 'Boston', 'BUF': 'Buffalo',
  'CHI': 'Chicago', 'CBJ': 'Columbus',
  'EDM': 'Edmonton', 'LAK': 'Los Angeles', 'LA': 'Los Angeles',
  'NSH': 'Nashville', 'PHI': 'Philadelphia',
  'SJS': 'San Jose', 'SJ': 'San Jose', 'STL': 'St Louis', 'Blues': 'St Louis', 'BLUES': 'St Louis', 'St.': 'St Louis', 'ST.': 'St Louis', 'Louis': 'St Louis',
  'TOR': 'Toronto', 'VAN': 'Vancouver',
};

// Extract team name from pick prediction for linking to Insights
function extractTeamForInsights(pick: Pick): string | null {
  if (pick.sport !== 'NHL') return null;
  
  const prediction = pick.prediction || '';
  // Match team name before +/- spread (e.g., "TB Lightning +1.5" or "Minnesota Wild +1.5")
  const match = prediction.match(/^([A-Za-z\s]+?)(?:\s+\+|\s+-|\s+ML|$)/);
  if (match) {
    const teamPart = match[1].trim();
    const words = teamPart.split(' ');
    
    // Check if first word is an abbreviation
    const firstWord = words[0].toUpperCase();
    if (abbrevToTeam[firstWord]) {
      return abbrevToTeam[firstWord];
    }
    
    // Otherwise return the first word (city name like "Minnesota")
    return words[0];
  }
  return null;
}

// Extract player names and league from tennis pick for linking to Tennis Insights
function extractTennisPlayersForInsights(pick: Pick): { player1: string; player2: string; league?: string } | null {
  if (pick.sport !== 'Tennis') return null;
  
  const event = pick.event || '';
  
  // Detect league from event string
  const eventLower = event.toLowerCase();
  let league: string | undefined;
  if (eventLower.includes('wta') || eventLower.includes("women")) {
    league = 'WTA';
  } else if (eventLower.includes('atp') || eventLower.includes("men")) {
    league = 'ATP';
  }
  
  // Clean player name by removing tournament metadata
  const cleanName = (name: string) => {
    return name
      .replace(/\s*\|.*$/g, '')         // Remove "| Tournament" suffix
      .replace(/\s*@.*$/g, '')          // Remove "@ Venue" suffix
      .replace(/\s*\(.*?\)\s*/g, '')    // Remove (ATP Finals) etc
      .replace(/\s*\[.*?\]\s*/g, '')    // Remove [1] seed markers etc
      .trim();
  };
  
  // First, try to find " vs " which is the clearest separator
  const vsIndex = event.toLowerCase().indexOf(' vs ');
  if (vsIndex !== -1) {
    // Get everything before and after " vs "
    let beforeVs = event.substring(0, vsIndex);
    let afterVs = event.substring(vsIndex + 4); // skip " vs "
    
    // For player1: remove tournament prefixes like "Hobart (WTA) - " or "WTA: "
    // Find the last separator before the player name
    const prefixMatch = beforeVs.match(/^.*?(?:\s+-\s+|\s*:\s*)(.+)$/);
    if (prefixMatch) {
      beforeVs = prefixMatch[1];
    }
    
    const player1 = cleanName(beforeVs);
    const player2 = cleanName(afterVs);
    
    // Validate we got reasonable player names (at least 2 chars each)
    if (player1.length >= 2 && player2.length >= 2) {
      return { player1, player2, league };
    }
  }
  
  return null;
}

function calculatePayout(betAmount: number, odds: string): number {
  const numericOdds = parseInt(odds.replace(/[^-\d]/g, ''));
  if (isNaN(numericOdds)) return 0;
  
  if (numericOdds < 0) {
    return Math.round(betAmount * (100 / Math.abs(numericOdds)));
  } else {
    return Math.round(betAmount * (numericOdds / 100));
  }
}

interface GameScore {
  score?: string;
  status?: string;
}

interface PickCardProps {
  pick: Pick;
  index: number;
  bankroll?: number;
  gameScore?: GameScore;
  hotTeams?: string[];
}

function isPickTeamHot(pick: Pick, hotTeams: string[]): boolean {
  if (!hotTeams?.length || pick.sport !== 'NHL') return false;
  
  const searchText = ((pick.prediction || '') + ' ' + (pick.event || '')).toUpperCase();
  
  // Check each hot team for a match
  for (const hotTeam of hotTeams) {
    if (!hotTeam) continue;
    const hotUpper = hotTeam.toUpperCase();
    
    // Direct match for full team name (word boundary check)
    if (hotUpper.length >= 3) {
      const regex = new RegExp('\\b' + hotUpper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
      if (regex.test(searchText)) return true;
    }
    
    // For team codes (3-letter abbreviations), require exact word boundary match
    if (hotUpper.length === 3 && /^[A-Z]{3}$/.test(hotUpper)) {
      const codeRegex = new RegExp('\\b' + hotUpper + '\\b');
      if (codeRegex.test(searchText)) return true;
    }
  }
  
  return false;
}

export function PickCard({ pick, index, bankroll = 1000, gameScore, hotTeams = [] }: PickCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAdminControls, setShowAdminControls] = useState(false);
  const isHot = isPickTeamHot(pick, hotTeams);
  const confidence = pick.confidence || 5;
  
  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      return apiRequest('PATCH', `/api/picks/${pick.id}/status`, { status: newStatus });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/picks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
      setShowAdminControls(false);
    },
  });
  
  const canUpdateStatus = pick.status === 'pending' || pick.status === 'void';
  
  // Bet sizing: conf 7 = 3%, conf 8 = 4% (as per user strategy)
  const unitPercent = confidence >= 8 ? 4 : confidence >= 7 ? 3 : confidence >= 6 ? 2 : 1;
  const betAmount = pick.stake || Math.round(bankroll * (unitPercent / 100));
  const payout = pick.odds ? calculatePayout(betAmount, pick.odds) : 0;
  
  const confidenceColor = 
    confidence >= 8 ? "text-green-400 bg-green-500/10 border-green-500/20" :
    confidence >= 6 ? "text-amber-400 bg-amber-500/10 border-amber-500/20" :
    "text-red-400 bg-red-500/10 border-red-500/20";
  
  const statusConfig = {
    won: { icon: CheckCircle, color: "text-green-400", bg: "bg-green-500/10", label: "Won" },
    lost: { icon: XCircle, color: "text-red-400", bg: "bg-red-500/10", label: "Lost" },
    pending: { icon: Clock, color: "text-amber-400", bg: "bg-amber-500/10", label: "Pending" },
    void: { icon: RotateCcw, color: "text-muted-foreground", bg: "bg-muted/30", label: "Void" },
  };
  
  const status = statusConfig[pick.status as keyof typeof statusConfig] || statusConfig.pending;
  const StatusIcon = status.icon;
  
  // Check if this pick can link to Insights
  const teamForInsights = extractTeamForInsights(pick);
  const tennisPlayers = extractTennisPlayersForInsights(pick);
  
  // Determine the appropriate insights URL based on sport
  let insightsUrl: string | null = null;
  let insightsLabel = "View Insights";
  
  if (teamForInsights) {
    insightsUrl = `/insights?team=${encodeURIComponent(teamForInsights)}`;
  } else if (tennisPlayers) {
    let url = `/tennis-insights?player1=${encodeURIComponent(tennisPlayers.player1)}&player2=${encodeURIComponent(tennisPlayers.player2)}`;
    if (tennisPlayers.league) {
      url += `&league=${encodeURIComponent(tennisPlayers.league)}`;
    }
    insightsUrl = url;
    insightsLabel = "View H2H";
  }

  const cardInner = (
    <>
      {/* Header: Sport + Hot indicator + Confidence + Status */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/70 px-2.5 py-1 rounded-md" style={{ background: 'linear-gradient(135deg, hsl(0 0% 15%) 0%, hsl(0 0% 10%) 100%)' }}>
            {pick.sport}
          </span>
          {isHot && (
            <div className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30" data-testid="badge-hot-team">
              <Flame className="w-3 h-3" />
              HOT
            </div>
          )}
          <div className={cn("flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold border backdrop-blur-sm", confidenceColor)}>
            <TrendingUp className="w-3 h-3" />
            {confidence}/10
          </div>
        </div>
        <div className="flex items-center gap-2">
          {insightsUrl && (
            <span className="text-[9px] text-primary flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
              <ExternalLink className="w-3 h-3" />
              {insightsLabel}
            </span>
          )}
          {canUpdateStatus ? (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowAdminControls(!showAdminControls);
              }}
              className={cn("flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold cursor-pointer hover:ring-1 hover:ring-primary/50 transition-all", status.bg, status.color)}
              data-testid={`button-toggle-admin-${pick.id}`}
            >
              <StatusIcon className="w-3 h-3" />
              {status.label}
            </button>
          ) : (
            <div className={cn("flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold", status.bg, status.color)}>
              <StatusIcon className="w-3 h-3" />
              {status.label}
            </div>
          )}
        </div>
      </div>
      
      {/* Admin Controls for manual status update */}
      <AnimatePresence>
        {showAdminControls && canUpdateStatus && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="flex items-center justify-between gap-2 p-3 mb-3 rounded-xl border border-white/10" style={{ background: 'linear-gradient(135deg, hsl(0 0% 8%) 0%, hsl(0 0% 5%) 100%)' }}>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Update Result:</span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    updateStatusMutation.mutate('won');
                  }}
                  disabled={updateStatusMutation.isPending}
                  className="h-7 px-3 bg-green-500/20 hover:bg-green-500/30 text-green-400 text-xs font-bold"
                  data-testid={`button-mark-won-${pick.id}`}
                >
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Won
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    updateStatusMutation.mutate('lost');
                  }}
                  disabled={updateStatusMutation.isPending}
                  className="h-7 px-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-bold"
                  data-testid={`button-mark-lost-${pick.id}`}
                >
                  <XCircle className="w-3 h-3 mr-1" />
                  Lost
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    updateStatusMutation.mutate('void');
                  }}
                  disabled={updateStatusMutation.isPending}
                  className="h-7 px-3 bg-muted/50 hover:bg-muted text-muted-foreground text-xs font-bold"
                  data-testid={`button-mark-void-${pick.id}`}
                >
                  <RotateCcw className="w-3 h-3 mr-1" />
                  Void
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Event name */}
      <h3 className="font-bold text-white text-sm mb-3 leading-tight">{pick.event}</h3>
      
      {/* Prediction + Odds + Edge row */}
      <div className="flex items-center justify-between mb-4 p-3 rounded-xl" style={{ background: 'linear-gradient(135deg, hsl(25 95% 53% / 0.08) 0%, transparent 100%)' }}>
        <span className="text-primary font-bold text-base">{pick.prediction}</span>
        <div className="flex items-center gap-2">
          {pick.edge && (
            <span className={cn(
              "text-[10px] font-bold px-2 py-0.5 rounded-md",
              pick.edge.includes('Moderate') ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
              pick.edge.includes('Small') ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
              'bg-muted text-muted-foreground border border-white/5'
            )}>
              {pick.edge}
            </span>
          )}
          <span className="text-white font-mono font-bold text-sm">{pick.odds}</span>
        </div>
      </div>
      
      {/* Game score if available */}
      {gameScore?.score && (
        <div className="flex items-center gap-2 mb-3 p-2.5 rounded-lg" style={{ background: 'linear-gradient(135deg, hsl(0 0% 10%) 0%, hsl(0 0% 6%) 100%)' }}>
          <span className="text-white font-bold text-lg">{gameScore.score}</span>
          <span className={cn(
            "text-[9px] font-bold uppercase px-2 py-0.5 rounded-md",
            gameScore.status === 'Live' ? 'bg-red-500/20 text-red-400 animate-pulse' : 'bg-muted/50 text-muted-foreground'
          )}>
            {gameScore.status}
          </span>
        </div>
      )}
      
      {/* Bet info */}
      <div className="flex items-center justify-between p-3 rounded-xl border border-white/5" style={{ background: 'linear-gradient(135deg, hsl(0 0% 8%) 0%, hsl(0 0% 5%) 100%)' }}>
        <div>
          <span className="text-[10px] text-muted-foreground block uppercase tracking-wide">Stake ({unitPercent}%)</span>
          <span className="text-white font-bold text-lg">${betAmount}</span>
        </div>
        <div className="w-px h-8 bg-white/10" />
        <div className="text-right">
          <span className="text-[10px] text-muted-foreground block uppercase tracking-wide">To Win</span>
          <span className="text-green-400 font-bold text-lg">${payout}</span>
        </div>
      </div>
      
      {/* Expandable AI Reasoning */}
      {pick.reasoning && (
        <div className="mt-4">
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="flex items-center justify-between w-full p-3 rounded-lg bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors cursor-pointer"
            data-testid={`button-expand-reasoning-${pick.id}`}
          >
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">AI Analysis</span>
            <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform duration-200", isExpanded && "rotate-180")} />
          </button>
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <p className="text-[11px] text-muted-foreground leading-relaxed p-3 pt-2">
                  {pick.reasoning}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </>
  );

  if (insightsUrl) {
    return (
      <Link href={insightsUrl} data-testid={`link-pick-${pick.id}`}>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05, duration: 0.2 }}
          className="group relative rounded-2xl p-5 border border-white/10 hover:border-primary/40 transition-all cursor-pointer overflow-hidden"
          style={{ background: 'linear-gradient(145deg, hsl(0 0% 6%) 0%, hsl(0 0% 3%) 100%)' }}
        >
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: 'radial-gradient(circle at top right, hsl(25 95% 53% / 0.1) 0%, transparent 50%)' }} />
          <div className="relative">{cardInner}</div>
        </motion.div>
      </Link>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.2 }}
      className="group relative rounded-2xl p-5 border border-white/10 hover:border-primary/30 transition-all overflow-hidden"
      style={{ background: 'linear-gradient(145deg, hsl(0 0% 6%) 0%, hsl(0 0% 3%) 100%)' }}
    >
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, hsl(25 95% 53% / 0.3), transparent)' }} />
      <div className="relative">{cardInner}</div>
    </motion.div>
  );
}
