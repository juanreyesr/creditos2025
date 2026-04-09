import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CPG_PAGE  = "https://www.colegiodepsicologos.org.gt/consulta-saldos/";
const CPG_AJAX  = "https://www.colegiodepsicologos.org.gt/wp-admin/admin-ajax.php";

// Extraer texto entre dos cadenas
function between(html: string, before: string, after: string): string {
  const start = html.indexOf(before);
  if (start === -1) return "";
  const from = start + before.length;
  const end = html.indexOf(after, from);
  if (end === -1) return "";
  return html.slice(from, end).replace(/&nbsp;/g, "").trim();
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { id } = await req.json();

    if (!id || !/^\d+$/.test(String(id))) {
      return new Response(
        JSON.stringify({ error: "Número de colegiado inválido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Paso 1: obtener el nonce desde la página ──────────────────────────
    const pageRes = await fetch(CPG_PAGE, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!pageRes.ok) {
      return new Response(
        JSON.stringify({ error: "No se pudo cargar la página de consulta" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const pageHtml = await pageRes.text();

    // El nonce está en un wp_localize_script, buscar patrón "nonce":"VALOR"
    const nonceMatch = pageHtml.match(/"nonce"\s*:\s*"([a-f0-9]+)"/);
    const nonce = nonceMatch?.[1] ?? "";

    if (!nonce) {
      return new Response(
        JSON.stringify({ error: "No se pudo obtener el token de seguridad" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Paso 2: llamar a admin-ajax.php ───────────────────────────────────
    const body = new URLSearchParams({
      action:   "consultar_saldo",
      security: nonce,
      id:       String(id),
    });

    const ajaxRes = await fetch(CPG_AJAX, {
      method:  "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":   "Mozilla/5.0",
        "Referer":      CPG_PAGE,
      },
      body: body.toString(),
    });

    if (!ajaxRes.ok) {
      return new Response(
        JSON.stringify({ error: "Colegiado no encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const html = await ajaxRes.text();

    // Si la respuesta está vacía o es "0" (WordPress AJAX failure)
    if (!html || html.trim() === "0" || html.trim() === "") {
      return new Response(
        JSON.stringify({ error: "Colegiado no encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Paso 3: parsear el HTML de respuesta ──────────────────────────────
    // Nombre: <h3 style="...">Juan José Reyes Rodríguez</h3>
    const nombreMatch = html.match(/<h3[^>]*>\s*([\s\S]*?)\s*<\/h3>/);
    const nombre = nombreMatch?.[1]?.trim() ?? "";

    // Estatus: <b> ACTIVO </b>  (segunda <b> dentro del <h4> de estatus)
    const estatusMatch = html.match(/<h4[^>]*color:\s*#29295F[^>]*>\s*<b>\s*(.*?)\s*<\/b>/);
    const estatus = estatusMatch?.[1]?.trim() ?? "";

    const fecha_colegiacion = between(html, "Fecha de colegiación:</b>", "</span>")
      .replace(/<[^>]+>/g, "").trim();

    const ultimo_pago = between(html, "Último pago:</b>", "</span>")
      .replace(/<[^>]+>/g, "").trim();

    const cuota_congreso = between(html, "Cuota congreso anual:</b>", "</span>")
      .replace(/<[^>]+>/g, "").replace(/<br>/g, "").trim();

    const creditos_academicos = between(html, "Créditos académicos:</b>", "</span>")
      .replace(/<[^>]+>/g, "").replace(/<br>/g, "").trim();

    // ── Paso 4: devolver JSON estructurado ────────────────────────────────
    return new Response(
      JSON.stringify({
        numero:              id,
        nombre,
        estatus,
        fecha_colegiacion,
        ultimo_pago,
        cuota_congreso,
        creditos_academicos,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
