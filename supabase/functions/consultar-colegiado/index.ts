// Consulta del estado de un colegiado en el directorio oficial del CPG
// (https://pagos.cpg.org.gt/document/directorio), con respaldo en
// public.cpg_colegiados_cache cuando el sistema del CPG no responde.
//
// Orden de consulta:
//   1. Directorio nuevo (pagos.cpg.org.gt). Limita peticiones por IP (HTTP 429)
//      y la IP de salida de Supabase es compartida, así que puede rechazarnos.
//   2. Consulta anterior en WordPress (colegiodepsicologos.org.gt), mientras exista.
//   3. Respaldo local en cpg_colegiados_cache.
//
// Contrato de respuesta (compatible con la versión anterior basada en WordPress):
//   { numero, nombre, estatus, estado_cpg, activo_hasta, carrera,
//     fecha_colegiacion, ultimo_pago, cuota_congreso, creditos_academicos,
//     fuente, desactualizado }
//
// * estatus: "ACTIVO" o "INACTIVO". Los colegiados EXENTOS se tratan como ACTIVO
//   (así los reconocen el aula, créditos y la aprobación automática).
// * estado_cpg: estado tal como lo reporta el CPG (ACTIVO, INACTIVO, EXENTO, …).
// * fecha_colegiacion, ultimo_pago, cuota_congreso, creditos_academicos: el
//   directorio nuevo ya no los publica; se devuelven vacíos por compatibilidad.
// * El DPI que expone el directorio NUNCA se reenvía ni se guarda.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CPG_API = "https://pagos.cpg.org.gt/api/colegiados/buscar";
const TIMEOUT_MS = 6000; // por fuente; si se agota, se pasa a la siguiente
const WP_PAGE = "https://www.colegiodepsicologos.org.gt/consulta-saldos/";
const WP_AJAX = "https://www.colegiodepsicologos.org.gt/wp-admin/admin-ajax.php";
const WP_ORIGIN = "https://www.colegiodepsicologos.org.gt";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

// status_Colegiado_Id del CPG → estatus que entiende el sistema
const ESTADOS_ACTIVOS = new Set(["ACTIVO", "EXENTO"]);

type Datos = {
  nombre: string;
  estatus: string;
  estado_cpg: string;
  activo_hasta: string;
  carrera: string;
  fecha_colegiacion: string;
  ultimo_pago: string;
  cuota_congreso: string;
  creditos_academicos: string;
};

type Origen =
  | { tipo: "ok"; datos: Datos }
  | { tipo: "no_encontrado"; mensaje: string }
  | { tipo: "origen_caido"; motivo: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// "2027-03-01T00:00:00" → "01/03/2027"
function fechaLegible(iso: unknown): string {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

function normalizarEstado(d: any): string {
  const texto = String(d?.estado ?? "").trim().toUpperCase();
  if (texto) return texto === "NO" ? "SIN ESTADO" : texto;
  switch (Number(d?.status_Colegiado_Id)) {
    case 1: return "ACTIVO";
    case 2: return "INACTIVO";
    case 3: return "EXENTO";
    default: return "SIN ESTADO";
  }
}

async function consultarOrigen(id: string): Promise<Origen> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const url = `${CPG_API}?codigo=${encodeURIComponent(id)}&documento=`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      signal: ctrl.signal,
    });
    const texto = (await res.text()).trim();

    if (res.status === 404) {
      return { tipo: "no_encontrado", mensaje: "Colegiado no encontrado" };
    }
    if (!res.ok) return { tipo: "origen_caido", motivo: `http_${res.status}` };

    let d: any;
    try {
      d = JSON.parse(texto);
    } catch {
      return { tipo: "origen_caido", motivo: "respuesta_no_json" };
    }

    const nombre = String(d?.nombre_Completo ?? "").replace(/\s+/g, " ").trim();
    if (!nombre && !d?.codigo) return { tipo: "no_encontrado", mensaje: "Colegiado no encontrado" };

    const estado_cpg = normalizarEstado(d);
    return {
      tipo: "ok",
      datos: {
        nombre,
        estatus: ESTADOS_ACTIVOS.has(estado_cpg) ? "ACTIVO" : "INACTIVO",
        estado_cpg,
        activo_hasta: fechaLegible(d?.activo_Hasta),
        carrera: String(d?.carrera ?? "").trim(),
        fecha_colegiacion: "",
        ultimo_pago: "",
        cuota_congreso: "",
        creditos_academicos: "",
      },
    };
  } catch (err) {
    const e = err as Error;
    return { tipo: "origen_caido", motivo: e.name === "AbortError" ? "timeout" : `error_red:${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

// ── Fuente 2: consulta anterior en WordPress (v7) ───────────────────────────

const clean = (s: string) =>
  s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

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

function cookiesDe(headers: Headers): string {
  const lista: string[] =
    typeof (headers as any).getSetCookie === "function"
      ? (headers as any).getSetCookie()
      : (headers.get("set-cookie") ?? "").split(",");
  return lista.map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
}

function datosWp(nombre: string, estatusRaw: string, extra: Partial<Datos>): Datos {
  const estado_cpg = estatusRaw.trim().toUpperCase();
  return {
    nombre: nombre.trim(),
    estatus: ESTADOS_ACTIVOS.has(estado_cpg) ? "ACTIVO" : (estado_cpg ? "INACTIVO" : ""),
    estado_cpg,
    activo_hasta: "",
    carrera: "",
    fecha_colegiacion: extra.fecha_colegiacion ?? "",
    ultimo_pago: extra.ultimo_pago ?? "",
    cuota_congreso: extra.cuota_congreso ?? "",
    creditos_academicos: extra.creditos_academicos ?? "",
  };
}

async function consultarWordPress(id: string): Promise<Origen> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const page = await fetch(WP_PAGE, {
      headers: { "User-Agent": UA, "Accept": "text/html", "Accept-Language": "es-GT,es;q=0.9" },
      signal: ctrl.signal,
    });
    const html = await page.text();
    if (page.status >= 400) return { tipo: "origen_caido", motivo: `wp_pagina_http_${page.status}` };
    const nonce = extractNonce(html);
    if (!nonce) return { tipo: "origen_caido", motivo: "wp_sin_nonce" };
    const cookie = cookiesDe(page.headers);

    const ajax = await fetch(WP_AJAX, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": UA,
        "Referer": WP_PAGE,
        "Origin": WP_ORIGIN,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: new URLSearchParams({ action: "consultar_saldo", security: nonce, id }).toString(),
      signal: ctrl.signal,
    });
    const texto = (await ajax.text()).trim();
    if (ajax.status >= 500) return { tipo: "origen_caido", motivo: `wp_ajax_http_${ajax.status}` };
    if (!texto || texto === "0" || texto === "-1") return { tipo: "origen_caido", motivo: "wp_respuesta_vacia" };

    let wp: any = null;
    try { wp = JSON.parse(texto); } catch { /* HTML */ }
    if (wp && typeof wp === "object" && "success" in wp) {
      if (!wp.success) {
        const msg = typeof wp.data === "string" ? wp.data : "Colegiado no encontrado";
        if (/nonce|security|seguridad|token|expir/i.test(msg)) return { tipo: "origen_caido", motivo: "wp_rechazo_seguridad" };
        return { tipo: "no_encontrado", mensaje: msg };
      }
      const d = wp.data ?? {};
      const datos = datosWp(String(d.nombre ?? d.name ?? ""), String(d.estatus ?? d.status ?? d.estado ?? ""), {
        fecha_colegiacion: String(d.fecha_colegiacion ?? d.fecha ?? "").trim(),
        ultimo_pago: String(d.ultimo_pago ?? d.pago ?? "").trim(),
        cuota_congreso: String(d.cuota_congreso ?? d.cuota ?? "").trim(),
        creditos_academicos: String(d.creditos_academicos ?? d.creditos ?? "").trim(),
      });
      if (!datos.nombre && !datos.estatus) return { tipo: "no_encontrado", mensaje: "Colegiado no encontrado" };
      return { tipo: "ok", datos };
    }

    const field = (label: string) => {
      const re = new RegExp(label + "[^<]*<\\/b>([\\s\\S]*?)(?:<\\/span>|<\\/h[1-6]>|<br\\s*\\/?>)", "i");
      return clean(texto.match(re)?.[1] ?? "");
    };
    const nombre = clean(texto.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "");
    const estatus = texto.match(/<b>\s*(ACTIVO|INACTIVO|SUSPENDIDO|MOROSO|EXENTO)\s*<\/b>/i)?.[1] ?? "";
    if (nombre || estatus) {
      return {
        tipo: "ok",
        datos: datosWp(nombre, estatus, {
          fecha_colegiacion: field("Fecha de colegiaci"),
          ultimo_pago: field("ltimo pago"),
          cuota_congreso: field("Cuota congreso"),
          creditos_academicos: field("ditos acad"),
        }),
      };
    }
    if (/no\s+(se\s+)?encontr|no\s+existe|inexistente|no\s+hay\s+registro/i.test(clean(texto))) {
      return { tipo: "no_encontrado", mensaje: "Colegiado no encontrado" };
    }
    return { tipo: "origen_caido", motivo: "wp_formato_desconocido" };
  } catch (err) {
    const e = err as Error;
    return { tipo: "origen_caido", motivo: e.name === "AbortError" ? "wp_timeout" : `wp_error_red:${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

// ── Respaldo local (nunca debe romper la consulta en vivo) ───────────────────

function clienteDb() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function guardarRespaldo(id: string, d: Datos, fuente = "cpg_directorio") {
  try {
    const sb = clienteDb();
    if (!sb) return;
    const ahora = new Date().toISOString();
    const { error } = await sb.from("cpg_colegiados_cache").upsert(
      { numero: id, ...d, fuente, verificado_en: ahora, updated_at: ahora },
      { onConflict: "numero" },
    );
    if (error) console.error(JSON.stringify({ evento: "respaldo_no_guardado", error: error.message }));
  } catch (e) {
    console.error(JSON.stringify({ evento: "respaldo_no_guardado", error: (e as Error).message }));
  }
}

async function leerRespaldo(id: string) {
  try {
    const sb = clienteDb();
    if (!sb) return null;
    const { data, error } = await sb
      .from("cpg_colegiados_cache")
      .select("*")
      .eq("numero", id)
      .maybeSingle();
    if (error) {
      console.error(JSON.stringify({ evento: "respaldo_no_leido", error: error.message }));
      return null;
    }
    return data;
  } catch (e) {
    console.error(JSON.stringify({ evento: "respaldo_no_leido", error: (e as Error).message }));
    return null;
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { id, debug = false } = body;

    if (!id || !/^\d+$/.test(String(id).trim())) {
      return json({ error: "Número de colegiado inválido" }, 400);
    }
    const numero = String(id).trim();

    let origen = await consultarOrigen(numero);
    let fuente = "cpg_directorio";
    const motivoDirectorio = origen.tipo === "origen_caido" ? origen.motivo : null;
    if (origen.tipo === "origen_caido") {
      // El directorio nuevo no respondió (p. ej. 429): probar la consulta anterior
      origen = await consultarWordPress(numero);
      fuente = "cpg_wordpress";
    }

    if (debug) {
      return json({ origen: origen.tipo, fuente, motivo_directorio: motivoDirectorio, motivo: (origen as any).motivo ?? null });
    }

    if (origen.tipo === "ok") {
      const datos = { ...origen.datos };
      const previo = await leerRespaldo(numero);
      if (fuente === "cpg_directorio" && previo) {
        // El directorio no publica estos datos: conservar los que dio WordPress antes
        datos.fecha_colegiacion = previo.fecha_colegiacion ?? "";
        datos.ultimo_pago = previo.ultimo_pago ?? "";
        datos.cuota_congreso = previo.cuota_congreso ?? "";
        datos.creditos_academicos = previo.creditos_academicos ?? "";
      }
      if (fuente === "cpg_wordpress") {
        // Conservar los datos del directorio que ya teníamos (activo hasta, profesión, exento)
        if (previo) {
          datos.activo_hasta = previo.activo_hasta ?? "";
          datos.carrera = previo.carrera ?? "";
          if (String(previo.estado_cpg ?? "").toUpperCase() === "EXENTO") {
            datos.estado_cpg = "EXENTO";
            datos.estatus = "ACTIVO";
          }
        }
      }
      await guardarRespaldo(numero, datos, fuente);
      return json({ numero, ...datos, fuente: "cpg_en_vivo", origen: fuente, desactualizado: false });
    }

    if (origen.tipo === "no_encontrado") return json({ error: origen.mensaje }, 404);

    // El sistema del CPG no respondió bien → usar respaldo local
    console.error(JSON.stringify({ evento: "cpg_origen_caido", motivo: origen.motivo, numero }));
    const r = await leerRespaldo(numero);
    if (r && (r.nombre || r.estatus)) {
      const estado_cpg = String(r.estado_cpg ?? r.estatus ?? "").toUpperCase();
      return json({
        numero,
        nombre: r.nombre ?? "",
        estatus: ESTADOS_ACTIVOS.has(estado_cpg) || r.estatus === "ACTIVO" ? "ACTIVO" : (r.estatus ?? ""),
        estado_cpg,
        activo_hasta: r.activo_hasta ?? "",
        carrera: r.carrera ?? "",
        fecha_colegiacion: r.fecha_colegiacion ?? "",
        ultimo_pago: r.ultimo_pago ?? "",
        cuota_congreso: r.cuota_congreso ?? "",
        creditos_academicos: r.creditos_academicos ?? "",
        fuente: "respaldo",
        desactualizado: true,
        verificado_en: r.verificado_en,
        aviso: "El sistema del CPG no respondió; se muestran los últimos datos guardados.",
      });
    }

    return json(
      { error: "El sistema del CPG no está disponible y no hay datos de respaldo para este colegiado.", origen_caido: true },
      502,
    );
  } catch (err) {
    return json({ error: (err as Error).message ?? "Error interno" }, 500);
  }
});
