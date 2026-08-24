// Shared server-side identity + throttling for edge functions.
//
// Phase 2a of the contribution pipeline: identity is DERIVED FROM THE
// VERIFIED SESSION, never from the request body. A client-supplied
// `submittedBy` is not trusted anywhere — the field is gone, and every
// attribution string in a GitHub issue/PR now comes from the JWT the
// caller presented.
//
// Two shapes of caller:
//   requireUser(req) — content writes (song submission/correction, tab
//     submission/correction). 401 when there is no valid user token.
//   optionalUser(req) — report/request flows (flag a problem, request a
//     song). Anonymous is fine; a signed-in caller still gets attributed.

import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2"

/** Attribution shown in issue/PR bodies. Never client-supplied. */
export function attributionFor(user: User | null): string {
  if (!user) return 'Anonymous'
  return user.user_metadata?.full_name || user.email || `user:${user.id}`
}

export interface Caller {
  user: User | null
  admin: SupabaseClient
}

function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) throw new Error('Supabase credentials not configured')
  return createClient(url, serviceKey)
}

/**
 * Resolve the caller's verified identity, if any.
 *
 * The frontend sends the anon key as the bearer token when nobody is
 * signed in; that is a valid project JWT but resolves to no user, so it
 * lands here as `user: null` — exactly the anonymous case.
 */
export async function optionalUser(req: Request): Promise<Caller> {
  const admin = adminClient()
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return { user: null, admin }

  const token = authHeader.replace(/^Bearer\s+/i, '')
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) return { user: null, admin }
  return { user: data.user, admin }
}

/**
 * Resolve the caller's verified identity, or return the 401 to send back.
 * Callers: `const { user, admin, response } = await requireUser(req, cors)`
 */
export async function requireUser(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<{ user: User | null; admin: SupabaseClient | null; response: Response | null }> {
  let caller: Caller
  try {
    caller = await optionalUser(req)
  } catch (_e) {
    return {
      user: null,
      admin: null,
      response: new Response(
        JSON.stringify({ error: 'Server auth not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      ),
    }
  }

  if (!caller.user) {
    return {
      user: null,
      admin: caller.admin,
      response: new Response(
        JSON.stringify({ error: 'Sign in to submit — authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      ),
    }
  }
  return { user: caller.user, admin: caller.admin, response: null }
}

/** Client IP for throttling (best effort; behind Supabase's proxy). */
export function callerIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('cf-connecting-ip')
    || 'unknown'
}

// Best-effort per-isolate throttle (resets on cold start) — the same
// limiter create-tab-pr has always used, lifted here so the anonymous
// report/request paths get the identical guard.
const buckets = new Map<string, number[]>()

export function rateLimited(
  key: string,
  { windowMs = 60 * 60 * 1000, max = 5 }: { windowMs?: number; max?: number } = {},
): boolean {
  const now = Date.now()
  const hits = (buckets.get(key) ?? []).filter(t => now - t < windowMs)
  const limited = hits.length >= max
  if (!limited) hits.push(now)
  buckets.set(key, hits)
  return limited
}
