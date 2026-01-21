import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Layers, Plus, Trash2, Calculator, DollarSign, TrendingUp, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Pick, Parlay, ParlayLeg } from "@shared/schema";

interface ParlayLegInput {
  id: string;
  sport: string;
  event: string;
  prediction: string;
  odds: string;
  confidence: number;
  pickId?: number;
}

interface CalculationResult {
  combinedOdds: string;
  combinedDecimalOdds: string;
  suggestedStake: number;
  potentialPayout: number;
  profit: number;
  bankroll: number;
  avgConfidence: number;
  legCount: number;
  breakdown: Array<{
    event: string;
    prediction: string;
    odds: string;
    decimalOdds: string;
    confidence: number;
  }>;
}

export default function ParlaysPage() {
  const { toast } = useToast();
  const [legs, setLegs] = useState<ParlayLegInput[]>([
    { id: "1", sport: "NHL", event: "", prediction: "", odds: "", confidence: 7 },
    { id: "2", sport: "NHL", event: "", prediction: "", odds: "", confidence: 7 },
  ]);
  const [customStake, setCustomStake] = useState<string>("");
  const [calculationResult, setCalculationResult] = useState<CalculationResult | null>(null);

  const { data: picks } = useQuery<Pick[]>({
    queryKey: ["/api/picks"],
  });

  const { data: parlays, isLoading: parlaysLoading } = useQuery<Array<Parlay & { legs: ParlayLeg[] }>>({
    queryKey: ["/api/parlays"],
  });

  const calculateMutation = useMutation({
    mutationFn: async (legData: ParlayLegInput[]) => {
      const response = await apiRequest("POST", "/api/parlays/calculate", {
        legs: legData.filter(l => l.odds && l.event && l.prediction)
      });
      return response.json();
    },
    onSuccess: (data) => {
      setCalculationResult(data);
    },
    onError: (error: Error) => {
      toast({
        title: "Calculation failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const createParlayMutation = useMutation({
    mutationFn: async (data: { legs: ParlayLegInput[]; stake: number }) => {
      const response = await apiRequest("POST", "/api/parlays", {
        name: `${data.legs.length}-Leg Parlay`,
        legs: data.legs.filter(l => l.odds && l.event && l.prediction).map(l => ({
          sport: l.sport,
          event: l.event,
          prediction: l.prediction,
          odds: l.odds,
          confidence: l.confidence,
          pickId: l.pickId
        })),
        stake: data.stake
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Parlay created",
        description: "Your parlay has been saved",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/parlays"] });
      setLegs([
        { id: "1", sport: "NHL", event: "", prediction: "", odds: "", confidence: 7 },
        { id: "2", sport: "NHL", event: "", prediction: "", odds: "", confidence: 7 },
      ]);
      setCalculationResult(null);
      setCustomStake("");
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create parlay",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const pendingPicks = (picks?.filter(p => p.status === "pending") || []).sort((a, b) => {
    // Sort by odds from lowest to highest (e.g., -200 before -150) - more juice first
    const parseOdds = (odds: string | null) => {
      if (!odds) return -999;
      const num = parseInt(odds.replace(/[^-\d]/g, ''));
      return isNaN(num) ? -999 : num;
    };
    return parseOdds(a.odds) - parseOdds(b.odds);
  });

  const addLeg = () => {
    setLegs([...legs, { 
      id: Date.now().toString(), 
      sport: "NHL", 
      event: "", 
      prediction: "", 
      odds: "", 
      confidence: 7 
    }]);
  };

  const removeLeg = (id: string) => {
    if (legs.length > 2) {
      setLegs(legs.filter(l => l.id !== id));
    }
  };

  const updateLeg = (id: string, field: keyof ParlayLegInput, value: string | number) => {
    setLegs(legs.map(l => l.id === id ? { ...l, [field]: value } : l));
  };

  const selectPick = (legId: string, pick: Pick) => {
    setLegs(legs.map(l => l.id === legId ? {
      ...l,
      sport: pick.sport,
      event: pick.event,
      prediction: pick.prediction,
      odds: pick.odds || "",
      confidence: pick.confidence,
      pickId: pick.id
    } : l));
  };

  const handleCalculate = () => {
    const validLegs = legs.filter(l => l.odds && l.event && l.prediction);
    if (validLegs.length < 2) {
      toast({
        title: "Need more legs",
        description: "A parlay requires at least 2 legs with valid odds",
        variant: "destructive"
      });
      return;
    }
    calculateMutation.mutate(legs);
  };

  const handleCreateParlay = () => {
    if (!calculationResult) {
      toast({
        title: "Calculate first",
        description: "Please calculate the parlay odds before saving",
        variant: "destructive"
      });
      return;
    }
    
    const stake = customStake ? parseInt(customStake) : calculationResult.suggestedStake;
    createParlayMutation.mutate({ legs, stake });
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center border border-primary/30" style={{ background: 'linear-gradient(135deg, hsl(25 95% 53% / 0.3) 0%, hsl(25 95% 53% / 0.1) 100%)' }}>
            <Layers className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Parlay Builder</h1>
            <p className="text-muted-foreground text-sm">Combine picks for higher payouts</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Card className="border-white/10 bg-card/50 backdrop-blur">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
                <CardTitle className="text-lg">Build Your Parlay</CardTitle>
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={addLeg}
                  data-testid="button-add-leg"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add Leg
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {legs.map((leg, index) => (
                  <div 
                    key={leg.id} 
                    className="p-4 rounded-lg border border-white/10 bg-black/20 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-muted-foreground">Leg {index + 1}</span>
                      {legs.length > 2 && (
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          onClick={() => removeLeg(leg.id)}
                          className="h-8 w-8 text-muted-foreground hover:text-red-400"
                          data-testid={`button-remove-leg-${index}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>

                    {pendingPicks.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <span className="text-xs text-muted-foreground">Quick add from pending picks:</span>
                        {pendingPicks.slice(0, 5).map(pick => (
                          <Button
                            key={pick.id}
                            size="sm"
                            variant={leg.pickId === pick.id ? "default" : "outline"}
                            onClick={() => selectPick(leg.id, pick)}
                            className="text-xs h-auto py-2 px-3 text-left justify-start whitespace-normal"
                            data-testid={`button-select-pick-${pick.id}`}
                          >
                            <span className="flex flex-col items-start gap-0.5">
                              <span className="font-medium">{pick.event}</span>
                              <span className="text-muted-foreground">
                                {pick.prediction} ({pick.odds})
                              </span>
                            </span>
                          </Button>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs text-muted-foreground">Event</Label>
                        <Input
                          value={leg.event}
                          onChange={(e) => updateLeg(leg.id, "event", e.target.value)}
                          placeholder="e.g., Panthers @ Lightning"
                          className="mt-1"
                          data-testid={`input-event-${index}`}
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Sport</Label>
                        <Input
                          value={leg.sport}
                          onChange={(e) => updateLeg(leg.id, "sport", e.target.value)}
                          placeholder="NHL"
                          className="mt-1"
                          data-testid={`input-sport-${index}`}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs text-muted-foreground">Prediction</Label>
                        <Input
                          value={leg.prediction}
                          onChange={(e) => updateLeg(leg.id, "prediction", e.target.value)}
                          placeholder="e.g., Panthers +1.5"
                          className="mt-1"
                          data-testid={`input-prediction-${index}`}
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Odds</Label>
                        <Input
                          value={leg.odds}
                          onChange={(e) => updateLeg(leg.id, "odds", e.target.value)}
                          placeholder="-227"
                          className="mt-1"
                          data-testid={`input-odds-${index}`}
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs text-muted-foreground">Confidence (1-10)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={10}
                        value={leg.confidence}
                        onChange={(e) => updateLeg(leg.id, "confidence", parseInt(e.target.value) || 5)}
                        className="mt-1 w-24"
                        data-testid={`input-confidence-${index}`}
                      />
                    </div>
                  </div>
                ))}

                <div className="flex gap-3 pt-2">
                  <Button 
                    onClick={handleCalculate} 
                    disabled={calculateMutation.isPending}
                    className="flex-1"
                    data-testid="button-calculate-parlay"
                  >
                    <Calculator className="w-4 h-4 mr-2" />
                    {calculateMutation.isPending ? "Calculating..." : "Calculate Parlay"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            {calculationResult && (
              <Card className="border-primary/30 bg-card/50 backdrop-blur">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-primary" />
                    Parlay Analysis
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg bg-black/30 border border-white/5">
                      <p className="text-xs text-muted-foreground">Combined Odds</p>
                      <p className="text-xl font-bold text-primary" data-testid="text-combined-odds">
                        {calculationResult.combinedOdds}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-black/30 border border-white/5">
                      <p className="text-xs text-muted-foreground">Avg Confidence</p>
                      <p className="text-xl font-bold text-white">
                        {calculationResult.avgConfidence}/10
                      </p>
                    </div>
                  </div>

                  <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                    <div className="flex items-center gap-2 mb-3">
                      <DollarSign className="w-5 h-5 text-primary" />
                      <span className="font-medium text-white">Suggested Bet</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground">Stake</p>
                        <p className="text-lg font-bold text-white" data-testid="text-suggested-stake">
                          ${calculationResult.suggestedStake}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Potential Payout</p>
                        <p className="text-lg font-bold text-green-400" data-testid="text-potential-payout">
                          ${calculationResult.potentialPayout}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Profit: ${calculationResult.profit} (from ${calculationResult.bankroll} bankroll)
                    </p>
                  </div>

                  <div>
                    <Label className="text-sm">Custom Stake (optional)</Label>
                    <Input
                      type="number"
                      value={customStake}
                      onChange={(e) => setCustomStake(e.target.value)}
                      placeholder={`${calculationResult.suggestedStake}`}
                      className="mt-1"
                      data-testid="input-custom-stake"
                    />
                  </div>

                  <Button 
                    onClick={handleCreateParlay}
                    disabled={createParlayMutation.isPending}
                    className="w-full"
                    data-testid="button-save-parlay"
                  >
                    {createParlayMutation.isPending ? "Saving..." : "Save Parlay"}
                  </Button>
                </CardContent>
              </Card>
            )}

            <Card className="border-white/10 bg-card/50 backdrop-blur">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Saved Parlays</CardTitle>
              </CardHeader>
              <CardContent>
                {parlaysLoading ? (
                  <p className="text-muted-foreground text-sm">Loading...</p>
                ) : parlays && parlays.length > 0 ? (
                  <div className="space-y-3">
                    {parlays.map((parlay) => (
                      <div 
                        key={parlay.id}
                        className="p-3 rounded-lg border border-white/10 bg-black/20"
                        data-testid={`parlay-item-${parlay.id}`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-sm">{parlay.name}</span>
                          <Badge 
                            variant={parlay.status === "won" ? "default" : parlay.status === "lost" ? "destructive" : "secondary"}
                            className={cn(
                              parlay.status === "won" && "bg-green-600",
                              parlay.status === "pending" && "bg-yellow-600/50"
                            )}
                          >
                            {parlay.status}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground space-y-1">
                          <p>{parlay.legs.length} legs @ {parlay.combinedOdds}</p>
                          <p>Stake: ${parlay.stake} → ${parlay.potentialPayout}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-muted-foreground text-sm">No parlays yet</p>
                    <p className="text-xs text-muted-foreground">Build your first parlay above</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}
