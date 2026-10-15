// Route-level access declaration (S1.8, docs/02 §5). Every route must say who may call it; apps that
// enforce RBAC reject routes without it at registration time (default deny).
declare module 'fastify' {
  interface FastifyContextConfig {
    /** `public`, `session` (signed in, no organisation needed), or a tenant permission such as `audience:write`. */
    permission?: string;
  }
}

export const PUBLIC_ROUTE = { permission: 'public' } as const;
