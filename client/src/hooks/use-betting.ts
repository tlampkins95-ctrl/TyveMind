import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type UpdateStrategyInput, type GeneratePicksInput } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

// GET /api/user - Fetch user profile & strategy
export function useUser() {
  return useQuery({
    queryKey: [api.users.get.path],
    queryFn: async () => {
      const res = await fetch(api.users.get.path);
      if (res.status === 404) return null; // Handle case where user doesn't exist yet
      if (!res.ok) throw new Error("Failed to fetch user");
      return api.users.get.responses[200].parse(await res.json());
    },
  });
}

// POST /api/user/strategy - Update betting strategy
export function useUpdateStrategy() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: UpdateStrategyInput) => {
      const validated = api.users.updateStrategy.input.parse(data);
      const res = await fetch(api.users.updateStrategy.path, {
        method: api.users.updateStrategy.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to update strategy");
      }
      return api.users.updateStrategy.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.users.get.path] });
      toast({
        title: "Strategy Updated",
        description: "Your betting strategy has been saved successfully.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    },
  });
}

// GET /api/picks - List all picks
export function usePicks() {
  return useQuery({
    queryKey: [api.picks.list.path],
    queryFn: async () => {
      const res = await fetch(api.picks.list.path);
      if (!res.ok) throw new Error("Failed to fetch picks");
      return api.picks.list.responses[200].parse(await res.json());
    },
  });
}

// PATCH /api/picks/:id/status - Update pick status (won/lost/push)
export function useUpdatePickStatus() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ pickId, status }: { pickId: number; status: string }) => {
      const res = await fetch(`/api/picks/${pickId}/status`, {
        method: 'PATCH',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update pick status");
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.picks.list.path] });
      toast({
        title: "Pick Updated",
        description: `Pick marked as ${variables.status}.`,
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    },
  });
}

// POST /api/picks/generate - Generate new picks using AI
export function useGeneratePicks() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: GeneratePicksInput) => {
      const validated = api.picks.generate.input.parse(data);
      const res = await fetch(api.picks.generate.path, {
        method: api.picks.generate.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
      });

      if (!res.ok) {
        throw new Error("Failed to generate picks. Please try again.");
      }
      return api.picks.generate.responses[200].parse(await res.json());
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [api.picks.list.path] });
      toast({
        title: "Picks Generated",
        description: `Successfully analyzed and generated ${data.length} new picks based on your strategy.`,
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Analysis Failed",
        description: error.message,
      });
    },
  });
}
