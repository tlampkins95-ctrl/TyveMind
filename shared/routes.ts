import { z } from 'zod';
import { insertUserSchema, insertPickSchema, users, picks } from './schema';

// ============================================
// SHARED ERROR SCHEMAS
// ============================================
export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

// ============================================
// API CONTRACT
// ============================================
export const api = {
  users: {
    get: {
      method: 'GET' as const,
      path: '/api/user', // Mocking single user for MVP simplicity
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    updateStrategy: {
      method: 'POST' as const,
      path: '/api/user/strategy',
      input: z.object({ strategy: z.string() }),
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
  },
  picks: {
    generate: {
      method: 'POST' as const,
      path: '/api/picks/generate',
      input: z.object({
        sport: z.string().optional(),
        context: z.string().optional(),
      }),
      responses: {
        200: z.array(z.custom<typeof picks.$inferSelect>()), // Returns generated picks
        500: errorSchemas.internal,
      },
    },
    list: {
      method: 'GET' as const,
      path: '/api/picks',
      responses: {
        200: z.array(z.custom<typeof picks.$inferSelect>()),
      },
    },
  },
};

// ============================================
// REQUIRED: buildUrl helper
// ============================================
export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

// ============================================
// TYPE HELPERS
// ============================================
export type UpdateStrategyInput = z.infer<typeof api.users.updateStrategy.input>;
export type GeneratePicksInput = z.infer<typeof api.picks.generate.input>;
