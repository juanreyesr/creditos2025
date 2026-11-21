// Consulta del estado de un colegiado en el directorio oficial del CPG
// (https://pagos.cpg.org.gt/document/directorio), con respaldo en
// public.cpg_colegiados_cache cuando el sistema del CPG no responde.
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
const TIMEOUT_MS = 9000; // si se agota, se usa el respaldo
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

// ── Respaldo local (nunca debe romper la consulta en vivo) ───────────────────

function clienteDb() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function guardarRespaldo(id: string, d: Datos) {
  try {
    const sb = clienteDb();
    if (!sb) return;
    const ahora = new Date().toISOString();
    const { error } = await sb.from("cpg_colegiados_cache").upsert(
      { numero: id, ...d, fuente: "cpg_directorio", verificado_en: ahora, updated_at: ahora },
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

    const origen = await consultarOrigen(numero);

    if (debug) return json({ origen: origen.tipo, motivo: (origen as any).motivo ?? null });

    if (origen.tipo === "ok") {
      await guardarRespaldo(numero, origen.datos);
      return json({ numero, ...origen.datos, fuente: "cpg_en_vivo", desactualizado: false });
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
