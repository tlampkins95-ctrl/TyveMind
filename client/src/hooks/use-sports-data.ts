import { useQuery } from "@tanstack/react-query";

interface SportMatch {
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
}

interface SportsSchedule {
  nhl: SportMatch[];
  tennis: SportMatch[];
}

export interface PlayerWinStreak {
  name: string;
  league: string;
  winStreak: number;
  lastMatches: string[];
  ranking?: string;
  surface?: string;
  profileUrl: string;
}

async function fetchSportsSchedule(): Promise<SportsSchedule> {
  const response = await fetch("/api/sports/schedule");
  if (!response.ok) {
    throw new Error("Failed to fetch sports schedule");
  }
  return response.json();
}

export function useSportsSchedule() {
  return useQuery<SportsSchedule>({
    queryKey: ["/api/sports/schedule"],
    queryFn: fetchSportsSchedule,
    refetchInterval: 60000,
    staleTime: 30000,
  });
}

async function fetchTennisWinStreaks(): Promise<PlayerWinStreak[]> {
  const response = await fetch("/api/sports/win-streaks");
  if (!response.ok) {
    throw new Error("Failed to fetch win streaks");
  }
  return response.json();
}

export function useTennisWinStreaks() {
  return useQuery<PlayerWinStreak[]>({
    queryKey: ["/api/sports/win-streaks"],
    queryFn: fetchTennisWinStreaks,
    refetchInterval: 300000, // 5 minutes
    staleTime: 120000, // 2 minutes
  });
}

export interface TeamWinStreak {
  name: string;
  abbreviation: string;
  winStreak: number;
  record: string;
  logo?: string;
}

async function fetchNHLTeamStreaks(): Promise<TeamWinStreak[]> {
  const response = await fetch("/api/sports/nhl-streaks");
  if (!response.ok) {
    throw new Error("Failed to fetch NHL team streaks");
  }
  return response.json();
}

export function useNHLTeamStreaks() {
  return useQuery<TeamWinStreak[]>({
    queryKey: ["/api/sports/nhl-streaks"],
    queryFn: fetchNHLTeamStreaks,
    refetchInterval: 300000, // 5 minutes
    staleTime: 120000, // 2 minutes
  });
}
