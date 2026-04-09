import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CPG_BASE = "https://www.colegiodepsicologos.org.gt/wp-json/rapi/v1";

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

    // Llamada servidor → CPG WordPress API (sin CORS)
    const cpgRes = await fetch(`${CPG_BASE}/colegiado?id=${id}`, {
      method: "GET",
      headers: { "Accept": "application/json" },
    });

    if (!cpgRes.ok) {
      return new Response(
        JSON.stringify({ error: "Colegiado no encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await cpgRes.json();

    // Normalizar respuesta
    return new Response(
      JSON.stringify({
        numero:            data.numero      || data.id       || id,
        nombre:            data.nombre      || data.name     || "",
        estatus:           data.estatus     || data.status   || "",
        fecha_colegiacion: data.fecha_colegiacion            || "",
        ultimo_pago:       data.ultimo_pago || data.last_payment || "",
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
