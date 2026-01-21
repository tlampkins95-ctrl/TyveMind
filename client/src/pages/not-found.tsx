import { Link } from "wouter";
import { AlertTriangle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
      <div className="bg-card w-full max-w-md p-8 rounded-2xl border border-white/5 shadow-2xl text-center">
        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-red-500/20">
          <AlertTriangle className="w-8 h-8 text-red-500" />
        </div>
        
        <h1 className="text-4xl font-display font-bold text-white mb-2">404</h1>
        <p className="text-xl font-semibold text-muted-foreground mb-6">Page Not Found</p>
        
        <p className="text-sm text-muted-foreground/60 mb-8">
          The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.
        </p>

        <Link href="/">
          <div className="w-full py-3 rounded-xl font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer">
            Return Home
          </div>
        </Link>
      </div>
    </div>
  );
}
