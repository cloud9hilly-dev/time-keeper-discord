import { cleanDiscordId, cleanName, isValidWeekStart, MAX_EMPLOYEES_PER_STORE, normalizeHours } from "./domain";
import { SessionUser, signValue, verifyValue } from "./auth";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  ADMIN_DISCORD_IDS?: string;
  DEMO_MODE?: string;
}

interface AuthContext {
  user: SessionUser;
  admin: boolean;
  storeIds: number[];
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: jsonHeaders });

function adminIds(env: Env): string[] {
  return (env.ADMIN_DISCORD_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}

async function context(request: Request, env: Env): Promise<AuthContext> {
  const authorization = request.headers.get("Authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  const user = await verifyValue<SessionUser>(bearer, env.SESSION_SECRET);
  if (!user || user.exp <= Math.floor(Date.now() / 1000)) throw new HttpError(401, "Open Time Keeper from inside Discord.");
  const admin = user.demo || adminIds(env).includes(user.id) || false;
  const rows = await env.DB.prepare("SELECT store_id FROM store_managers WHERE discord_id = ?").bind(user.id).all<{ store_id: number }>();
  return { user, admin, storeIds: rows.results.map((row) => row.store_id) };
}

function canEditStore(auth: AuthContext, storeId: number): boolean {
  return auth.admin || auth.storeIds.includes(storeId);
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    throw new HttpError(415, "Send requests as JSON.");
  }
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
}

async function dashboard(request: Request, env: Env, auth: AuthContext): Promise<Response> {
  const url = new URL(request.url);
  const week = url.searchParams.get("week");
  if (!isValidWeekStart(week)) throw new HttpError(400, "Week must be a Monday in YYYY-MM-DD format.");

  const stores = auth.admin
    ? await env.DB.prepare("SELECT id, name FROM stores ORDER BY name").all<{ id: number; name: string }>()
    : await env.DB.prepare("SELECT s.id, s.name FROM stores s JOIN store_managers sm ON sm.store_id = s.id WHERE sm.discord_id = ? ORDER BY s.name").bind(auth.user.id).all<{ id: number; name: string }>();

  const output = [];
  for (const store of stores.results) {
    const managers = await env.DB.prepare("SELECT discord_id, display_name FROM store_managers WHERE store_id = ? ORDER BY display_name").bind(store.id).all<{ discord_id: string; display_name: string }>();
    const regular = await env.DB.prepare(`
      SELECT e.id, e.name, e.home_store_id, COALESCE(h.hours, 0) AS hours, h.updated_at
      FROM employees e
      LEFT JOIN hour_entries h ON h.employee_id = e.id AND h.store_id = ? AND h.week_start = ?
      WHERE e.home_store_id = ? AND e.active = 1
      ORDER BY e.name
    `).bind(store.id, week, store.id).all();
    const covers = await env.DB.prepare(`
      SELECT e.id, e.name, e.home_store_id, hs.name AS home_store_name, h.hours, h.updated_at
      FROM hour_entries h
      JOIN employees e ON e.id = h.employee_id
      JOIN stores hs ON hs.id = e.home_store_id
      WHERE h.store_id = ? AND h.week_start = ? AND e.home_store_id != ?
      ORDER BY e.name
    `).bind(store.id, week, store.id).all();
    output.push({ ...store, managers: managers.results, employees: regular.results, covers: covers.results });
  }

  const allEmployees = await env.DB.prepare(`
    SELECT e.id, e.name, e.home_store_id, s.name AS home_store_name
    FROM employees e JOIN stores s ON s.id = e.home_store_id
    WHERE e.active = 1 ORDER BY e.name
  `).all();

  return json({ week, stores: output, allEmployees: allEmployees.results });
}

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/api/config") {
    return json({ clientId: env.DISCORD_CLIENT_ID || null, demoMode: env.DEMO_MODE === "true" });
  }

  if (request.method === "POST" && path === "/api/auth/demo" && env.DEMO_MODE === "true") {
    const user: SessionUser = { id: "100000000000000001", username: "Demo Admin", exp: Math.floor(Date.now() / 1000) + 86400, demo: true };
    return json({ app_token: await signValue(user, env.SESSION_SECRET), user });
  }

  if (request.method === "POST" && path === "/api/token") {
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.SESSION_SECRET) throw new HttpError(503, "Discord Activity authentication is not configured yet.");
    const data = await body(request);
    if (typeof data.code !== "string" || data.code.length < 4 || data.code.length > 2048) throw new HttpError(400, "A Discord authorization code is required.");
    const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: "authorization_code", code: data.code }),
    });
    if (!tokenResponse.ok) throw new HttpError(502, "Discord authorization could not be completed.");
    const token = await tokenResponse.json<{ access_token: string; expires_in?: number }>();
    const profileResponse = await fetch("https://discord.com/api/v10/users/@me", { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (!profileResponse.ok) throw new HttpError(502, "Discord profile could not be loaded.");
    const profile = await profileResponse.json<{ id: string; username: string; global_name?: string; avatar?: string }>();
    const user: SessionUser = {
      id: profile.id,
      username: profile.global_name || profile.username,
      avatar: profile.avatar,
      exp: Math.floor(Date.now() / 1000) + Math.min(token.expires_in ?? 3600, 60 * 60 * 24),
    };
    return json({ access_token: token.access_token, app_token: await signValue(user, env.SESSION_SECRET), user });
  }

  const auth = await context(request, env);

  if (request.method === "GET" && path === "/api/me") {
    return json({ user: auth.user, admin: auth.admin, storeIds: auth.storeIds });
  }
  if (request.method === "GET" && path === "/api/dashboard") return dashboard(request, env, auth);

  if (request.method === "POST" && path === "/api/hours") {
    const data = await body(request);
    const storeId = Number(data.storeId);
    const employeeId = Number(data.employeeId);
    const hours = normalizeHours(data.hours);
    if (!Number.isInteger(storeId) || !Number.isInteger(employeeId) || hours === null || !isValidWeekStart(data.weekStart)) {
      throw new HttpError(400, "Store, employee, Monday week, and hours from 0 to 168 are required.");
    }
    if (!canEditStore(auth, storeId)) throw new HttpError(403, "You cannot edit this shop.");
    const employee = await env.DB.prepare("SELECT id FROM employees WHERE id = ? AND active = 1").bind(employeeId).first();
    if (!employee) throw new HttpError(404, "Employee not found.");
    await env.DB.prepare(`
      INSERT INTO hour_entries (store_id, employee_id, week_start, hours, updated_by_discord_id, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(store_id, employee_id, week_start) DO UPDATE SET
        hours = excluded.hours,
        updated_by_discord_id = excluded.updated_by_discord_id,
        updated_at = CURRENT_TIMESTAMP
    `).bind(storeId, employeeId, data.weekStart, hours, auth.user.id).run();
    return json({ ok: true, hours });
  }

  const coverMatch = path.match(/^\/api\/hours\/(\d+)\/cover$/);
  if (request.method === "DELETE" && coverMatch) {
    const storeId = Number(coverMatch[1]);
    const data = await body(request);
    const employeeId = Number(data.employeeId);
    if (!canEditStore(auth, storeId)) throw new HttpError(403, "You cannot edit this shop.");
    if (!Number.isInteger(employeeId) || !isValidWeekStart(data.weekStart)) throw new HttpError(400, "Employee and week are required.");
    await env.DB.prepare(`DELETE FROM hour_entries WHERE store_id = ? AND employee_id = ? AND week_start = ? AND employee_id IN (SELECT id FROM employees WHERE home_store_id != ?)`)
      .bind(storeId, employeeId, data.weekStart, storeId).run();
    return json({ ok: true });
  }

  if (!auth.admin) throw new HttpError(403, "Admin access required.");

  if (request.method === "POST" && path === "/api/stores") {
    const data = await body(request);
    const name = cleanName(data.name);
    if (!name) throw new HttpError(400, "Enter a shop name up to 80 characters.");
    const result = await env.DB.prepare("INSERT INTO stores (name) VALUES (?) RETURNING id, name").bind(name).first();
    return json(result, 201);
  }

  if (request.method === "POST" && path === "/api/employees") {
    const data = await body(request);
    const name = cleanName(data.name);
    const homeStoreId = Number(data.homeStoreId);
    if (!name || !Number.isInteger(homeStoreId)) throw new HttpError(400, "Employee name and home shop are required.");
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM employees WHERE home_store_id = ? AND active = 1").bind(homeStoreId).first<{ total: number }>();
    if ((count?.total ?? 0) >= MAX_EMPLOYEES_PER_STORE) throw new HttpError(409, `A shop can have up to ${MAX_EMPLOYEES_PER_STORE} regular employees.`);
    const result = await env.DB.prepare("INSERT INTO employees (name, home_store_id) VALUES (?, ?) RETURNING id, name, home_store_id").bind(name, homeStoreId).first();
    return json(result, 201);
  }

  const managerMatch = path.match(/^\/api\/stores\/(\d+)\/managers$/);
  if (request.method === "POST" && managerMatch) {
    const storeId = Number(managerMatch[1]);
    const data = await body(request);
    const discordId = cleanDiscordId(data.discordId);
    const displayName = cleanName(data.displayName);
    if (!discordId || !displayName) throw new HttpError(400, "A valid Discord user ID and manager name are required.");
    await env.DB.prepare(`INSERT INTO store_managers (store_id, discord_id, display_name) VALUES (?, ?, ?) ON CONFLICT(store_id, discord_id) DO UPDATE SET display_name = excluded.display_name`)
      .bind(storeId, discordId, displayName).run();
    return json({ ok: true }, 201);
  }

  throw new HttpError(404, "Not found.");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      if (path.startsWith("/api/")) return await api(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : "Unexpected error";
      if (status >= 500) console.error(error);
      return json({ error: message }, status);
    }
  },
} satisfies ExportedHandler<Env>;
