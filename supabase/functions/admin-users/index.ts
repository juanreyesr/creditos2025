// supabase/functions/admin-users/index.ts
// Edge Function para gestión de usuarios (solo superadmin)
// Acciones: resend (reenviar verificación), activate (activar manualmente)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1) Verificar que el request viene con un JWT válido (usuario autenticado)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No se proporcionó token de autenticación" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cliente con la clave anon para verificar al usuario que llama
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Obtener usuario autenticado
    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Usuario no autenticado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2) Verificar que el usuario es superadmin (tabla perfiles)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: perfil, error: perfilError } = await supabaseAdmin
      .from("perfiles")
      .select("is_admin")
      .eq("user_id", user.id)
      .maybeSingle();

    if (perfilError || !perfil?.is_admin) {
      return new Response(
        JSON.stringify({ error: "No tienes permisos de superadmin" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3) Leer body del request
    const { action, email } = await req.json();

    if (!email || typeof email !== "string") {
      return new Response(
        JSON.stringify({ error: "Se requiere un correo válido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cleanEmail = email.trim().toLowerCase();

    // 4) Ejecutar acción solicitada
    if (action === "resend") {
      // Reenviar correo de verificación usando el Admin API
      // Primero buscar el usuario por email
      const { data: userList, error: listErr } =
        await supabaseAdmin.auth.admin.listUsers();

      if (listErr) {
        return new Response(
          JSON.stringify({ error: "Error listando usuarios: " + listErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const targetUser = userList.users.find(
        (u: any) => u.email?.toLowerCase() === cleanEmail
      );

      if (!targetUser) {
        return new Response(
          JSON.stringify({ error: `No se encontró usuario con correo: ${cleanEmail}` }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Generar un nuevo enlace de verificación vía invite
      // (esto reenvía el correo de confirmación)
      const { error: inviteErr } =
        await supabaseAdmin.auth.admin.inviteUserByEmail(cleanEmail);

      if (inviteErr) {
        // Si ya está confirmado, informar
        if (inviteErr.message?.includes("already confirmed")) {
          return new Response(
            JSON.stringify({
              message: `El usuario ${cleanEmail} ya está verificado. No necesita reenvío.`,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({ error: "Error al reenviar: " + inviteErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          message: `Correo de verificación reenviado a ${cleanEmail}`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else if (action === "activate") {
      // Activar manualmente: buscar usuario y confirmar su email
      const { data: userList, error: listErr } =
        await supabaseAdmin.auth.admin.listUsers();

      if (listErr) {
        return new Response(
          JSON.stringify({ error: "Error listando usuarios: " + listErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const targetUser = userList.users.find(
        (u: any) => u.email?.toLowerCase() === cleanEmail
      );

      if (!targetUser) {
        return new Response(
          JSON.stringify({ error: `No se encontró usuario con correo: ${cleanEmail}` }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Actualizar: confirmar email y marcar como verificado
      const { error: updateErr } =
        await supabaseAdmin.auth.admin.updateUserById(targetUser.id, {
          email_confirm: true,
        });

      if (updateErr) {
        return new Response(
          JSON.stringify({ error: "Error al activar: " + updateErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          message: `Usuario ${cleanEmail} activado manualmente (email confirmado)`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else {
      return new Response(
        JSON.stringify({ error: `Acción no reconocida: ${action}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (err) {
    console.error("Edge Function error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Error interno del servidor" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
