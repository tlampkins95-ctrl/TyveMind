# TyveMind

## Overview
TyveMind is an AI-powered sports betting analytics platform designed to generate betting picks based on user-defined strategies. It leverages artificial intelligence to analyze sports events and provide predictions with confidence ratings, helping users make informed betting decisions. The application aims to offer a sophisticated yet user-friendly tool for sports bettors, focusing on strategic advantage and predictive accuracy.

## User Preferences
Preferred communication style: Simple, everyday language.
Design: Orange theme (HSL 25 95% 53%), true black background.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack React Query
- **Styling**: Tailwind CSS with CSS variables
- **UI Components**: shadcn/ui (Radix UI primitives)
- **Animations**: Framer Motion
- **Build Tool**: Vite

The frontend uses a standard React SPA pattern, optimized with a dark theme suitable for analytics.

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **API Pattern**: RESTful endpoints
- **Database ORM**: Drizzle ORM for type-safe queries
- **AI Integration**: OpenAI API via Replit AI Integrations

The backend handles API requests, serves static files, and integrates with AI services for pick generation.

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM
- **Schema**: Defined in `shared/schema.ts`
- **Migrations**: Handled by Drizzle Kit

Key tables include `users`, `picks`, `conversations`, and `messages`.

### Shared Code Structure
The `shared/` directory contains common code for both frontend and backend, including database schemas, API contract definitions, and chat models.

### Build System
- **Development**: `tsx` and Vite dev server
- **Production**: Custom build script using esbuild for the server and Vite for the client, with dependency bundling for performance.

### Core Features
- **AI Pick Generation**: Generates picks with confidence ratings.
- **Advanced Edge Factors (v2 - Jan 20, 2026)**: 
  - **Starting Goalies**: NHL Official API gamecenter data (shows projected starters with SV%, record)
  - **Home/Away Splits**: Team performance by venue (strong home 60%+, weak road <35%)
  - **Power Play / Penalty Kill**: Real PP/PK stats from NHL Stats API (elite PP 25%+ vs weak PK <75% = +1 bonus)
  - **Scoring Trends**: Hot offense (3.5+ GF/G), weak defense (3.5+ GA/G), matchup bonuses
  - **Line Movement**: Sharp money detection (>10 pt movement)
  - **Travel Fatigue**: Cross-country trip detection (2000+ miles, 3+ timezones)
  - **API Endpoints**: /api/sports/nhl-stats, /api/sports/nhl-trends, /api/sports/nhl-edge/:home/:away, /api/sports/nhl-line-movement
- **Rest/Fatigue Tracking**: Flags back-to-back games and well-rested teams, impacting confidence scores.
- **Injury Tracking**: Integrates NHL injury data to inform AI predictions.
- **Team Flagging System**: Tracks and blocks teams based on consecutive losses or historically poor performance.
- **Strict Pick Validation**: Ensures all generated picks are valid against live schedules before saving.
- **Betting Strategy**: Supports NHL pucklines and Tennis favorites with specific odds targets.
- **Bet Sizing**: Implements Kelly Criterion-based bet sizing (half-Kelly with a 5% bankroll cap) based on pick confidence.
- **Parlay Builder**: Allows users to create multi-leg parlays with odds calculation and suggested stake.
- **Hourly Maintenance**: Automated task for pick outcome updates, bankroll adjustments, and duplicate pick detection.
- **Improved Outcome Polling**: Fetches completed games from the past 7 days to ensure accurate pick outcome updates.
- **Tennis Analysis Service**: Pre-analyzes tennis matches, considering recent form (surface-specific and quality-adjusted), rest, and market edge.

## External Dependencies

### AI Services
- **OpenAI API**: For AI-driven pick generation and chat responses.

### Database
- **PostgreSQL**: Primary database for all application data.
- **connect-pg-simple**: Used for Express session storage.

### Key NPM Packages
- **drizzle-orm**, **drizzle-zod**: Type-safe database interactions and schema validation.
- **@tanstack/react-query**: Frontend server state management.
- **framer-motion**: For UI animations.
- **zod**: Runtime type validation.
- **shadcn/ui** / **Radix UI primitives**: UI component library.