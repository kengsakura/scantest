/**
 * Keep the free Supabase project awake: Supabase pauses free projects after about
 * a week without database activity (e.g. over school holidays). A Vercel Cron Job
 * (see vercel.json) calls this once a day; it runs one tiny read query.
 *
 * Uses the same public (publishable) key as the web app, so no secret is needed.
 * Row Level Security returns no rows to an anonymous caller, but the query still
 * reaches Postgres, which is what counts as activity.
 */

// Same values as .env; Vercel functions don't read .env files, so keep a fallback here.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://hldawhdifjiepxyzmpbp.supabase.co'
const SUPABASE_KEY = process.env.VITE_SUPABASE_KEY || 'sb_publishable_Kzta8vgv2XdW9t2bjOVF-g_BUzWz3Eg'

export async function GET(): Promise<Response> {
  const started = Date.now()
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/settings?select=id&limit=1`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    })
    const body = { ok: res.ok, status: res.status, ms: Date.now() - started, at: new Date().toISOString() }
    console.log('supabase keepalive', body)
    return Response.json(body, { status: res.ok ? 200 : 502 })
  } catch (err) {
    const body = { ok: false, error: String(err), ms: Date.now() - started }
    console.error('supabase keepalive failed', body)
    return Response.json(body, { status: 502 })
  }
}
