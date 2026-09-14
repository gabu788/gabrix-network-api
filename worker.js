 export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
if (url.pathname === "/api/admin-config-check" && request.method === "GET") {
  return json({
    ok: true,
    adminConfigured: Boolean(env.ADMIN_CODE),
    secretName: "ADMIN_CODE"
  });
}
    try {
      await initDatabase(env.DB);

      if (url.pathname === "/" && request.method === "GET") {
        return json({
          ok: true,
          service: "GABRIX NETWORK API",
          status: "online"
        });
      }

      if (url.pathname === "/api/admin-login" && request.method === "POST") {
        const body = await request.json();
        const accessCode = String(body.accessCode || "");

        if (!/^\d{4}$/.test(accessCode)) {
          return json({ error: "Enter all 4 digits." }, 400);
        }

        const adminCode =
          env.ADMIN_CODE ||
          env.GABRIX_ADMIN_CODE ||
          env.ADMIN_SECRET;

        if (!adminCode) {
          return json({
            error: "Admin authentication is not configured on the GABRIX server."
          }, 500);
        }

        if (accessCode !== String(adminCode)) {
          return json({ error: "Access denied." }, 401);
        }

        return json({
          ok: true,
          token: await createToken(env)
        });
      }

      if (url.pathname === "/api/client-login" && request.method === "POST") {
        const body = await request.json();
        const code = String(body.code || "");

        if (!/^\d{4}$/.test(code)) {
          return json({ error: "Enter all 4 digits." }, 400);
        }

        const client = await env.DB
          .prepare(`SELECT * FROM clients WHERE code=? LIMIT 1`)
          .bind(code)
          .first();

        if (!client) {
          return json({ error: "Invalid client code." }, 401);
        }

        return json({
          ok: true,
          client: formatClient(client)
        });
      }

      if (
        url.pathname === "/api/admin-create-client" &&
        request.method === "POST"
      ) {
        await requireAdmin(request, env);

        const body = await request.json();

        const name = clean(body.name);
        const project = clean(body.project);
        const packageName = clean(body.package);
        const campaign = clean(body.campaign);
        const code = clean(body.code);

        if (!name || !project || !packageName || !campaign) {
          return json({
            error: "Complete all client fields."
          }, 400);
        }

        if (!/^\d{4}$/.test(code)) {
          return json({
            error: "Client code must contain exactly 4 digits."
          }, 400);
        }

        const existing = await env.DB
          .prepare(
            `SELECT id FROM clients
             WHERE code=? OR campaign=?
             LIMIT 1`
          )
          .bind(code, campaign)
          .first();

        if (existing) {
          return json({
            error: "That client code or campaign ID is already in use."
          }, 409);
        }

        const id =
          "CLI-" +
          Date.now().toString(36).toUpperCase();

        const now = new Date().toISOString();

        await env.DB
          .prepare(
            `INSERT INTO clients
            (
              id,
              name,
              project,
              package,
              campaign,
              code,
              target_subs,
              target_likes,
              target_comments,
              target_watch,
              status,
              progress,
              update_note,
              created_at,
              updated_at
            )
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
          )
          .bind(
            id,
            name,
            project,
            packageName,
            campaign,
            code,
            number(body.targetSubs),
            number(body.targetLikes),
            number(body.targetComments),
            number(body.targetWatch),
            "ACTIVE",
            0,
            "",
            now,
            now
          )
          .run();

        const client = await env.DB
          .prepare(`SELECT * FROM clients WHERE id=?`)
          .bind(id)
          .first();

        return json({
          ok: true,
          message: "Client created successfully.",
          client: formatClient(client)
        });
      }

      if (
        url.pathname === "/api/admin-clients" &&
        request.method === "GET"
      ) {
        await requireAdmin(request, env);

        const result = await env.DB
          .prepare(`SELECT * FROM clients ORDER BY created_at DESC`)
          .all();

        return json({
          ok: true,
          clients: (result.results || []).map(formatClient)
        });
      }
if (
  url.pathname === "/api/admin-delete-client" &&
  request.method === "POST"
) {
  await requireAdmin(request, env);

  const body = await request.json();
  const clientId = clean(body.clientId);

  if (!clientId) {
    return json({ error: "Client ID is required." }, 400);
  }

  const client = await env.DB
    .prepare(`SELECT * FROM clients WHERE id=? LIMIT 1`)
    .bind(clientId)
    .first();

  if (!client) {
    return json({ error: "Client not found." }, 404);
  }

  await env.DB
    .prepare(`DELETE FROM work_updates WHERE client_id=?`)
    .bind(clientId)
    .run();

  await env.DB
    .prepare(`DELETE FROM clients WHERE id=?`)
    .bind(clientId)
    .run();

  return json({
    ok: true,
    message: "Client and client code deleted successfully."
  });
}
      if (
        url.pathname === "/api/admin-work-update" &&
        request.method === "POST"
      ) {
        await requireAdmin(request, env);

        const body = await request.json();

        const clientId = clean(body.clientId);

        const client = await env.DB
          .prepare(`SELECT * FROM clients WHERE id=? LIMIT 1`)
          .bind(clientId)
          .first();

        if (!client) {
          return json({
            error: "Client not found."
          }, 404);
        }

        const subsDone = number(body.subsDone);
        const likesDone = number(body.likesDone);
        const commentsDone = number(body.commentsDone);
        const watchDone = number(body.watchDone);

        const status =
          clean(body.status) || "IN PROGRESS";

        const round =
          clean(body.round) || "Round 01";

        const details = clean(body.details);

        const progress = calculateProgress(
          client,
          subsDone,
          likesDone,
          commentsDone,
          watchDone
        );

        const now = new Date().toISOString();

        await env.DB
          .prepare(
            `INSERT INTO work_updates
            (
              id,
              client_id,
              subs_done,
              likes_done,
              comments_done,
              watch_done,
              status,
              round,
              details,
              created_at
            )
            VALUES (?,?,?,?,?,?,?,?,?,?)`
          )
          .bind(
            "UPD-" +
              Date.now().toString(36).toUpperCase(),
            clientId,
            subsDone,
            likesDone,
            commentsDone,
            watchDone,
            status,
            round,
            details,
            now
          )
          .run();

        await env.DB
          .prepare(
            `UPDATE clients
             SET
               status=?,
               progress=?,
               update_note=?,
               updated_at=?
             WHERE id=?`
          )
          .bind(
            status,
            progress,
            details,
            now,
            clientId
          )
          .run();

        const updated = await env.DB
          .prepare(`SELECT * FROM clients WHERE id=?`)
          .bind(clientId)
          .first();

        return json({
          ok: true,
          message: "Work update posted successfully.",
          client: formatClient(updated)
        });
      }

      if (
        url.pathname === "/api/admin-reports" &&
        request.method === "GET"
      ) {
        await requireAdmin(request, env);

        const result = await env.DB
          .prepare(
            `SELECT
              work_updates.*,
              clients.name AS client_name,
              clients.campaign AS campaign
             FROM work_updates
             JOIN clients
             ON work_updates.client_id=clients.id
             ORDER BY work_updates.created_at DESC`
          )
          .all();

        return json({
          ok: true,
          reports: result.results || []
        });
      }

      return json({
        error: "GABRIX API route not found."
      }, 404);

    } catch (error) {
      console.error(error);

      return json({
        error:
          error?.message ||
          "GABRIX server error."
      }, 500);
    }
  }
};


async function initDatabase(db) {

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS clients(
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        project TEXT NOT NULL,
        package TEXT NOT NULL,
        campaign TEXT NOT NULL UNIQUE,
        code TEXT NOT NULL UNIQUE,
        target_subs INTEGER DEFAULT 0,
        target_likes INTEGER DEFAULT 0,
        target_comments INTEGER DEFAULT 0,
        target_watch INTEGER DEFAULT 0,
        status TEXT DEFAULT 'ACTIVE',
        progress INTEGER DEFAULT 0,
        update_note TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS work_updates(
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        subs_done INTEGER DEFAULT 0,
        likes_done INTEGER DEFAULT 0,
        comments_done INTEGER DEFAULT 0,
        watch_done INTEGER DEFAULT 0,
        status TEXT DEFAULT 'IN PROGRESS',
        round TEXT DEFAULT 'Round 01',
        details TEXT DEFAULT '',
        created_at TEXT NOT NULL
      )`
    )
    .run();
}


async function requireAdmin(request, env) {

  const h =
    request.headers.get("Authorization") || "";

  if (!h.startsWith("Bearer ")) {
    throw new Error(
      "Admin authentication required."
    );
  }

  if (
    !(await verifyToken(
      h.slice(7),
      env
    ))
  ) {
    throw new Error(
      "Admin session expired or invalid."
    );
  }
}


async function createToken(env) {

  const secret =
    env.ADMIN_TOKEN_SECRET ||
    env.ADMIN_CODE ||
    env.GABRIX_ADMIN_CODE ||
    env.ADMIN_SECRET;

  if (!secret) {
    throw new Error(
      "Admin token secret is not configured."
    );
  }

  const payload = {
    role: "admin",
    issued: Date.now(),
    expires: Date.now() + 86400000
  };

  const encoded =
    base64url(
      JSON.stringify(payload)
    );

  return (
    encoded +
    "." +
    await hmac(encoded, secret)
  );
}


async function verifyToken(token, env) {

  try {

    const p = token.split(".");

    if (p.length !== 2) {
      return false;
    }

    const secret =
      env.ADMIN_TOKEN_SECRET ||
      env.ADMIN_CODE ||
      env.GABRIX_ADMIN_CODE ||
      env.ADMIN_SECRET;

    if (!secret) {
      return false;
    }

    if (
      await hmac(p[0], secret) !== p[1]
    ) {
      return false;
    }

    const payload =
      JSON.parse(
        new TextDecoder().decode(
          base64urlDecode(p[0])
        )
      );

    return (
      payload.role === "admin" &&
      Date.now() < Number(payload.expires)
    );

  } catch {
    return false;
  }
}


async function hmac(text, secret) {

  const key =
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      {
        name: "HMAC",
        hash: "SHA-256"
      },
      false,
      ["sign"]
    );

  const sig =
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(text)
    );

  return base64url(
    String.fromCharCode(
      ...new Uint8Array(sig)
    )
  );
}


function clean(v) {
  return String(v ?? "").trim();
}


function number(v) {

  const n = Number(v);

  return Number.isFinite(n) && n >= 0
    ? Math.floor(n)
    : 0;
}


function calculateProgress(
  c,
  s,
  l,
  m,
  w
) {

  const vals = [];

  const a =
    Number(c.target_subs || 0);

  const b =
    Number(c.target_likes || 0);

  const d =
    Number(c.target_comments || 0);

  const e =
    Number(c.target_watch || 0);

  if (a > 0) {
    vals.push((s / a) * 100);
  }

  if (b > 0) {
    vals.push((l / b) * 100);
  }

  if (d > 0) {
    vals.push((m / d) * 100);
  }

  if (e > 0) {
    vals.push((w / e) * 100);
  }

  return vals.length
    ? Math.max(
        0,
        Math.min(
          100,
          Math.round(
            vals.reduce(
              (x, y) => x + y,
              0
            ) / vals.length
          )
        )
      )
    : 0;
}


function formatClient(c) {

  return {
    id: c.id,
    name: c.name,
    project: c.project,
    package: c.package,
    campaign: c.campaign,
    code: c.code,

    target_subs:
      Number(c.target_subs || 0),

    target_likes:
      Number(c.target_likes || 0),

    target_comments:
      Number(c.target_comments || 0),

    target_watch:
      Number(c.target_watch || 0),

    status:
      c.status || "ACTIVE",

    progress:
      Number(c.progress || 0),

    update_note:
      c.update_note || "",

    created_at:
      c.created_at,

    updated_at:
      c.updated_at
  };
}


function base64url(v) {

  const bytes =
    typeof v === "string"
      ? new TextEncoder().encode(v)
      : new Uint8Array(v);

  let b = "";

  for (const x of bytes) {
    b += String.fromCharCode(x);
  }

  return btoa(b)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}


function base64urlDecode(v) {

  const p =
    v.replace(/-/g, "+")
     .replace(/_/g, "/") +
    "===".slice(
      (v.length + 3) % 4
    );

  const b = atob(p);

  const x =
    new Uint8Array(b.length);

  for (let i = 0; i < b.length; i++) {
    x[i] = b.charCodeAt(i);
  }

  return x;
}


function corsHeaders() {

  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods":
      "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization",
    "Access-Control-Max-Age":
      "86400"
  };
}


function json(data, status = 200) {

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        ...corsHeaders()
      }
    }
  );
}
 
