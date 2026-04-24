import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CPG_PAGE = "https://www.colegiodepsicologos.org.gt/consulta-saldos/";
const CPG_AJAX = "https://www.colegiodepsicologos.org.gt/wp-admin/admin-ajax.php";

// Intenta extraer el nonce con múltiples patrones
function extractNonce(html: string): string {
  const patterns = [
    /"nonce"\s*:\s*"([a-z0-9]+)"/i,
    /"security"\s*:\s*"([a-z0-9]+)"/i,
    /'nonce'\s*:\s*'([a-z0-9]+)'/i,
    /'security'\s*:\s*'([a-z0-9]+)'/i,
    /nonce['":\s]+([a-f0-9]{10})/i,
    /security['":\s]+([a-f0-9]{10})/i,
    /ajax_nonce['":\s]+([a-z0-9]+)/i,
    /(?:nonce|security).{0,30}?([a-f0-9]{10})/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return m[1];
  }
  return "";
}

// Limpia texto HTML
const clean = (s: string) =>
  s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

function parseHtml(html: string) {
  const nombre =
    html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1]?.let?.(clean) ??
    clean(html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "");

  const estatus =
    html.match(/<b>\s*(ACTIVO|INACTIVO|SUSPENDIDO|MOROSO)\s*<\/b>/i)?.[1]?.trim() ?? "";

  const field = (label: string) => {
    const re = new RegExp(label + "[^<]*<\\/b>(?:&nbsp;|\\s)*([^<]+)", "i");
    return clean(html.match(re)?.[1] ?? "");
  };

  return {
    nombre:              clean(html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? ""),
    estatus,
    fecha_colegiacion:   field("Fecha de colegiaci"),
    ultimo_pago:         field("ltimo pago"),       // cubre Último y Ultimo
    cuota_congreso:      field("Cuota congreso"),
    creditos_academicos: field("ditos acad"),        // cubre Créditos académicos
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { id, debug = false } = body;

    if (!id || !/^\d+$/.test(String(id))) {
      return new Response(
        JSON.stringify({ error: "Número de colegiado inválido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Paso 1: cargar página para obtener nonce y cookies ────────────────
    const pageRes = await fetch(CPG_PAGE, {
      headers: {
        "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-GT,es;q=0.9,en;q=0.8",
      },
    });

    const rawCookies = pageRes.headers.get("set-cookie") ?? "";
    // Extraer solo nombre=valor de cada cookie (sin flags)
    const cookieHeader = rawCookies
      .split(",")
      .map(c => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");

    const pageHtml = await pageRes.text();
    const nonce    = extractNonce(pageHtml);

    // ── Modo DEBUG: devuelve info intermedia sin llegar al AJAX ───────────
    if (debug) {
      const contexts = (pageHtml.match(/.{0,60}(?:nonce|security).{0,60}/gi) ?? []).slice(0, 8);
      return new Response(
        JSON.stringify({
          page_status:    pageRes.status,
          nonce_found:    nonce || null,
          nonce_contexts: contexts,
          cookies:        cookieHeader || null,
          page_length:    pageHtml.length,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!nonce) {
      return new Response(
        JSON.stringify({ error: "No se pudo obtener el token de seguridad. Llama con debug:true para diagnosticar." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Paso 2: llamar a admin-ajax.php ───────────────────────────────────
    const formBody = new URLSearchParams({
      action:   "consultar_saldo",
      security: nonce,
      id:       String(id),
    });

    const ajaxRes = await fetch(CPG_AJAX, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":   "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Referer":      CPG_PAGE,
        "Origin":       "https://www.colegiodepsicologos.org.gt",
        ...(cookieHeader ? { "Cookie": cookieHeader } : {}),
      },
      body: formBody.toString(),
    });

    const responseText = (await ajaxRes.text()).trim();

    // WordPress AJAX falla con "0" o "-1"
    if (!responseText || responseText === "0" || responseText === "-1") {
      return new Response(
        JSON.stringify({ error: "Colegiado no encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Paso 3: intentar JSON (WP AJAX) antes que HTML ────────────────────
    try {
      const wpJson = JSON.parse(responseText);
      if (wpJson && typeof wpJson === "object" && "success" in wpJson) {
        if (!wpJson.success) {
          const msg = typeof wpJson.data === "string" ? wpJson.data : "Colegiado no encontrado";
          return new Response(
            JSON.stringify({ error: msg }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        // success:true — extraer campos del objeto data
        const d = wpJson.data ?? {};
        const nombre              = String(d.nombre ?? d.name ?? "").trim();
        const estatus             = String(d.estatus ?? d.status ?? d.estado ?? "").trim().toUpperCase();
        const fecha_colegiacion   = String(d.fecha_colegiacion ?? d.fecha ?? "").trim();
        const ultimo_pago         = String(d.ultimo_pago ?? d.pago ?? "").trim();
        const cuota_congreso      = String(d.cuota_congreso ?? d.cuota ?? "").trim();
        const creditos_academicos = String(d.creditos_academicos ?? d.creditos ?? "").trim();

        if (!nombre && !estatus) {
          return new Response(
            JSON.stringify({ error: "Colegiado no encontrado", raw: responseText.slice(0, 200) }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({ numero: id, nombre, estatus, fecha_colegiacion, ultimo_pago, cuota_congreso, creditos_academicos }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } catch {
      // No es JSON válido — caer en parseo HTML
    }

    // ── Paso 4: parsear como HTML (formato legado) ────────────────────────
    const parsed = parseHtml(responseText);

    if (!parsed.nombre && !parsed.estatus) {
      return new Response(
        JSON.stringify({ error: "Colegiado no encontrado", raw: responseText.slice(0, 200) }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ numero: id, ...parsed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message ?? "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
