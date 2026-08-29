// MCPE control relay — Cloudflare Worker
// Requires:
//   - KV namespace binding named "CTL" (stores {url, reg_time})
//   - Secrets: KAGGLE_USER, KAGGLE_KEY  (only used by /start)
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token, X-Register-Key",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const json = (code, obj) =>
      new Response(JSON.stringify(obj), {
        status: code,
        headers: { ...cors, "Content-Type": "application/json" },
      });

    try {
      return await route(url, request, env, json);
    } catch (e) {
      return json(500, { ok: false, error: String(e) });
    }
  },
};

async function route(url, request, env, json) {
  const p = url.pathname;

  if (p === "/register" && request.method === "POST") {
    // Called by the Kaggle notebook on every boot.
    try {
      const b = await request.json();
      const regKey = request.headers.get("X-Register-Key") || "";
      // Optional: require a register key to avoid junk writes.
      if (env.REGISTER_KEY && regKey !== env.REGISTER_KEY) return json(401, { ok: false, error: "bad register key" });
      if (!b.url) return json(400, { ok: false, error: "no url" });
      await env.CTL.put("url", b.url);
      await env.CTL.put("reg_time", String(Date.now()));
      if (b.notebook) await env.CTL.put("notebook", JSON.stringify(b.notebook));
      return json(200, { ok: true });
    } catch (e) {
      return json(400, { ok: false, error: "bad body" });
    }
  }

  if (p === "/bootstrap") {
    const urlVal = (await env.CTL.get("url")) || "";
    const regTime = (await env.CTL.get("reg_time")) || "0";
    return json(200, { ok: true, url: urlVal, reg_time: Number(regTime) });
  }

  if (p === "/start" && request.method === "POST") {
    // Trigger a run of the Kaggle kernel (auto-start the notebook).
    if (!env.KAGGLE_KEY) return json(400, { ok: false, error: "kaggle key not configured" });
    const auth = "Bearer " + env.KAGGLE_KEY;
    // Re-submit the kernel so Kaggle runs it. Source stored in KV as "notebook"
    // (registered by the notebook on boot, or set manually in the dashboard).
    const code = (await env.CTL.get("notebook")) || "";
    if (!code) return json(400, { ok: false, error: "notebook source not stored (see KV 'notebook')" });
    const payload = JSON.parse(code);
    const r = await fetch("https://www.kaggle.com/api/v1/kernels/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify(payload),
    });
    return json(200, { ok: r.ok, status: r.status, body: await r.text() });
  }

  if (p === "/health") return json(200, { ok: true });

  return json(404, { ok: false, error: "not found" });
}
