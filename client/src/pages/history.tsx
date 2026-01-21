import { useState } from "react";
import { Layout } from "@/components/layout";
import { usePicks, useUpdatePickStatus } from "@/hooks/use-betting";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, CheckCircle, XCircle, Clock, TrendingUp, TrendingDown, Filter, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Pick } from "@shared/schema";

interface OutcomeResult {
  pickId: number;
  event: string;
  score: string;
  suggestedStatus: string;
  betTeam: string;
}

function HistoryCard({ pick, isAuthenticated }: { pick: Pick; isAuthenticated: boolean }) {
  const updateStatus = useUpdatePickStatus();
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'won': return 'text-green-400 bg-green-500/20';
      case 'lost': return 'text-red-400 bg-red-500/20';
      default: return 'text-muted-foreground bg-secondary';
    }
  };
  
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'won': return <CheckCircle className="w-4 h-4" />;
      case 'lost': return <XCircle className="w-4 h-4" />;
      default: return <Clock className="w-4 h-4" />;
    }
  };

  const handleMarkResult = (result: 'won' | 'lost') => {
    updateStatus.mutate({ pickId: pick.id, status: result });
  };

  return (
    <Card className="p-4 bg-card/50 border-white/5">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant="outline" className="text-xs">{pick.sport}</Badge>
              <Badge className={`text-xs ${getStatusColor(pick.status || 'pending')}`}>
                {getStatusIcon(pick.status || 'pending')}
                <span className="ml-1 capitalize">{pick.status || 'pending'}</span>
              </Badge>
              {pick.odds && pick.odds !== 'null' && (
                <Badge variant="secondary" className="text-xs font-mono">{pick.odds}</Badge>
              )}
            </div>
            <p className="text-sm font-bold text-white truncate" data-testid={`text-event-${pick.id}`}>{pick.event}</p>
            <p className="text-sm text-primary font-medium" data-testid={`text-prediction-${pick.id}`}>{pick.prediction}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-muted-foreground">{pick.scheduledTime}</p>
            <p className="text-lg font-bold text-white">{pick.confidence}/10</p>
          </div>
        </div>
        
        <p className="text-xs text-muted-foreground line-clamp-2">{pick.reasoning}</p>
        
        {isAuthenticated && pick.status === 'pending' && (
          <div className="flex gap-2 pt-2 border-t border-white/5">
            <Button 
              size="sm" 
              variant="outline"
              className="flex-1 text-green-400 border-green-500/30"
              onClick={() => handleMarkResult('won')}
              disabled={updateStatus.isPending}
              data-testid={`button-mark-won-${pick.id}`}
            >
              <CheckCircle className="w-4 h-4 mr-1" /> Won
            </Button>
            <Button 
              size="sm" 
              variant="outline"
              className="flex-1 text-red-400 border-red-500/30"
              onClick={() => handleMarkResult('lost')}
              disabled={updateStatus.isPending}
              data-testid={`button-mark-lost-${pick.id}`}
            >
              <XCircle className="w-4 h-4 mr-1" /> Lost
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function History() {
  const { data: picks, isLoading } = usePicks();
  const { isAuthenticated } = useAuth();
  const canManagePicks = isAuthenticated;
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isChecking, setIsChecking] = useState(false);
  const [detectedOutcomes, setDetectedOutcomes] = useState<OutcomeResult[]>([]);
  const [isApplying, setIsApplying] = useState(false);
  const { toast } = useToast();
  
  const wonPicks = picks?.filter(p => p.status === 'won') || [];
  const lostPicks = picks?.filter(p => p.status === 'lost') || [];
  const pendingPicks = picks?.filter(p => p.status === 'pending' || !p.status) || [];
  
  const winRate = wonPicks.length + lostPicks.length > 0 
    ? Math.round((wonPicks.length / (wonPicks.length + lostPicks.length)) * 100)
    : 0;

  const filteredPicks = picks?.filter(pick => {
    if (statusFilter === "all") return true;
    if (statusFilter === "pending") return pick.status === "pending" || !pick.status;
    return pick.status === statusFilter;
  }).sort((a, b) => {
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateB - dateA;
  }) || [];

  const handleCheckOutcomes = async () => {
    setIsChecking(true);
    try {
      const response = await fetch('/api/picks/check-outcomes');
      const data = await response.json();
      
      if (data.outcomes && data.outcomes.length > 0) {
        setDetectedOutcomes(data.outcomes);
        toast({
          title: "Outcomes Detected",
          description: `Found ${data.outcomes.length} finished games to update`,
        });
      } else {
        toast({
          title: "No Updates",
          description: "No finished NHL games found for pending picks",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to check outcomes",
        variant: "destructive",
      });
    } finally {
      setIsChecking(false);
    }
  };

  const handleApplyOutcomes = async () => {
    setIsApplying(true);
    try {
      await apiRequest('POST', '/api/picks/apply-outcomes', {
        outcomes: detectedOutcomes.map(o => ({ pickId: o.pickId, status: o.suggestedStatus }))
      });
      
      toast({
        title: "Outcomes Applied",
        description: `Updated ${detectedOutcomes.length} picks`,
      });
      setDetectedOutcomes([]);
      queryClient.invalidateQueries({ queryKey: ['/api/picks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to apply outcomes. Make sure you're logged in.",
        variant: "destructive",
      });
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Layout>
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold text-white mb-2">Pick History</h1>
        <p className="text-muted-foreground">Track your betting performance over time</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="stat-card text-center">
          <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-2">Total Picks</p>
          <p className="text-3xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>{picks?.length || 0}</p>
        </div>
        <div className="stat-card text-center relative overflow-hidden" style={{ background: 'linear-gradient(135deg, hsl(142 71% 45% / 0.1) 0%, hsl(0 0% 3%) 100%)' }}>
          <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, hsl(142 71% 45% / 0.5), transparent)' }} />
          <div className="flex items-center justify-center gap-1 mb-2">
            <TrendingUp className="w-3 h-3 text-green-400" />
            <p className="text-xs text-green-400 uppercase font-bold tracking-wider">Won</p>
          </div>
          <p className="text-3xl font-bold text-green-400" style={{ fontFamily: 'var(--font-display)' }}>{wonPicks.length}</p>
        </div>
        <div className="stat-card text-center relative overflow-hidden" style={{ background: 'linear-gradient(135deg, hsl(0 84% 60% / 0.1) 0%, hsl(0 0% 3%) 100%)' }}>
          <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, hsl(0 84% 60% / 0.5), transparent)' }} />
          <div className="flex items-center justify-center gap-1 mb-2">
            <TrendingDown className="w-3 h-3 text-red-400" />
            <p className="text-xs text-red-400 uppercase font-bold tracking-wider">Lost</p>
          </div>
          <p className="text-3xl font-bold text-red-400" style={{ fontFamily: 'var(--font-display)' }}>{lostPicks.length}</p>
        </div>
        <div className="stat-card-glow text-center">
          <p className="text-xs text-primary uppercase font-bold tracking-wider mb-2">Win Rate</p>
          <p className="text-3xl font-bold glow-text">{winRate}%</p>
        </div>
      </div>

      {/* Detected Outcomes Banner */}
      {detectedOutcomes.length > 0 && canManagePicks && (
        <Card className="p-4 mb-6 bg-primary/10 border-primary/30">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              Auto-Detected Outcomes
            </h3>
            <Button 
              size="sm" 
              onClick={handleApplyOutcomes}
              disabled={isApplying}
              data-testid="button-apply-outcomes"
            >
              {isApplying ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}
              Apply All
            </Button>
          </div>
          <div className="space-y-2">
            {detectedOutcomes.map((outcome) => (
              <div key={outcome.pickId} className="flex items-center justify-between text-sm p-2 rounded bg-card/50">
                <span className="text-white">{outcome.event}</span>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground font-mono">{outcome.score}</span>
                  <Badge className={outcome.suggestedStatus === 'won' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}>
                    {outcome.suggestedStatus === 'won' ? <CheckCircle className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
                    {outcome.suggestedStatus}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Filter and Check Outcomes */}
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40" data-testid="select-status-filter">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Picks</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="won">Won</SelectItem>
              <SelectItem value="lost">Lost</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {filteredPicks.length} pick{filteredPicks.length !== 1 ? 's' : ''}
          </span>
        </div>
        
        {canManagePicks && pendingPicks.length > 0 && (
          <Button 
            variant="outline" 
            size="sm"
            onClick={handleCheckOutcomes}
            disabled={isChecking}
            data-testid="button-check-outcomes"
          >
            {isChecking ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Zap className="w-4 h-4 mr-1" />}
            Check NHL Scores
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : filteredPicks.length > 0 ? (
        <div className="grid gap-4">
          {filteredPicks.map((pick) => (
            <HistoryCard 
              key={pick.id} 
              pick={pick} 
              isAuthenticated={canManagePicks}
            />
          ))}
        </div>
      ) : (
        <Card className="p-12 text-center bg-card/50 border-white/5">
          <Clock className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-bold text-white mb-2">No Picks Found</h3>
          <p className="text-muted-foreground">
            {statusFilter === "all" 
              ? "Start generating picks to build your history"
              : `No ${statusFilter} picks yet`
            }
          </p>
        </Card>
      )}
    </Layout>
  );
}
