import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Trophy, 
  Brain, 
  Activity,
  BarChart3,
  Layers
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUser } from "@/hooks/use-betting";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: user } = useUser();
  
  const bankroll = user?.bankroll || 1000;
  const profitPercent = ((bankroll - 1000) / 1000 * 100).toFixed(1);

  const navItems = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/" },
    { icon: Trophy, label: "My Picks", href: "/picks" },
    { icon: BarChart3, label: "NHL Insights", href: "/insights" },
    { icon: Layers, label: "Parlays", href: "/parlays" },
    { icon: Activity, label: "History", href: "/history" },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b border-white/5 bg-card/30 backdrop-blur-sm sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary" />
          <span className="font-display font-bold text-lg text-white">TyveMind<span className="text-primary">.xyz</span></span>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Bankroll</p>
          <p className="text-sm font-bold text-primary" data-testid="text-bankroll-mobile">${bankroll.toLocaleString()}</p>
        </div>
      </header>

      {/* Desktop Sidebar */}
      <aside className="w-64 border-r border-white/5 hidden md:flex flex-col fixed h-full z-10 overflow-hidden" style={{ background: 'linear-gradient(180deg, hsl(0 0% 4%) 0%, hsl(0 0% 2%) 100%)' }}>
        <div className="absolute inset-0 opacity-30" style={{ background: 'radial-gradient(ellipse at top left, hsl(25 95% 53% / 0.1) 0%, transparent 50%)' }} />
        
        <div className="relative p-6 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center border border-primary/30 pulse-glow" style={{ background: 'linear-gradient(135deg, hsl(25 95% 53% / 0.3) 0%, hsl(25 95% 53% / 0.1) 100%)' }}>
              <Brain className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="font-display font-bold text-xl tracking-tight text-white">TyveMind<span className="glow-text">.xyz</span></h1>
              <p className="text-xs text-muted-foreground">Strategic Analytics</p>
            </div>
          </div>
        </div>

        <nav className="relative flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <div
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer group relative overflow-hidden",
                  location === item.href
                    ? "text-primary border border-primary/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                )}
                style={location === item.href ? { background: 'linear-gradient(90deg, hsl(25 95% 53% / 0.15) 0%, transparent 100%)' } : {}}
                data-testid={`nav-${item.label.toLowerCase().replace(' ', '-')}`}
              >
                {location === item.href && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r bg-primary" />
                )}
                <item.icon className={cn(
                  "w-5 h-5 transition-transform group-hover:scale-110",
                  location === item.href ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                )} />
                <span className="font-medium text-sm">{item.label}</span>
              </div>
            </Link>
          ))}
        </nav>

        <div className="relative p-4 border-t border-white/5">
          <div className="stat-card-glow">
            <div className="absolute top-0 right-0 w-20 h-20 opacity-20" style={{ background: 'radial-gradient(circle, hsl(25 95% 53% / 0.5) 0%, transparent 70%)' }} />
            <h4 className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">Bankroll</h4>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold font-display glow-text" data-testid="text-bankroll-sidebar">${bankroll.toLocaleString()}</span>
            </div>
            <div className={cn("text-sm font-bold mt-1", Number(profitPercent) >= 0 ? "text-green-400" : "text-red-400")}>
              {Number(profitPercent) >= 0 ? "+" : ""}{profitPercent}% from start
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 md:ml-64 p-4 md:p-8 pb-20 md:pb-8 overflow-y-auto">
        <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {children}
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden grid grid-cols-5 p-2 border-t border-white/5 bg-card/80 backdrop-blur-md fixed bottom-0 left-0 right-0 z-50">
        {navItems.map((item) => (
          <Link key={item.href} href={item.href}>
            <div
              className={cn(
                "flex flex-col items-center justify-center gap-1 py-2 rounded-lg transition-all",
                location === item.href
                  ? "text-primary"
                  : "text-muted-foreground"
              )}
              data-testid={`nav-mobile-${item.label.toLowerCase().replace(' ', '-')}`}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-[9px] font-medium text-center">{item.label}</span>
            </div>
          </Link>
        ))}
      </nav>
    </div>
  );
}
