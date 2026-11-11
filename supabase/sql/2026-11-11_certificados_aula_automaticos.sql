-- Créditos Académicos: los certificados del Aula Virtual se suman solos al registro.
--
-- APLICADO en producción el 2026-11-11 (migración "creditos_certificados_aula_automaticos")
-- tras un ensayo con reversión.
--
-- Proyecto Supabase compartido (aula, créditos, gestiones). Solo AGREGA funciones y
-- un disparador; no modifica ni borra datos existentes.
--
-- Nota: search_path = public (no vacío) porque el disparador existente de correlativos
-- (auto_set_correlativo) usa correlativo_contadores sin esquema.
--
-- 1. public.creditos_registrar_certificado(code, usuario): crea el registro de créditos
--    de UN certificado del aula si aún no existe (ni activo ni retirado). Si el usuario
--    lo retiró (deleted_at), NO lo vuelve a crear.
-- 2. Disparador en aulacaeduc.cpg_certificates: al emitirse un certificado se registra
--    al instante para el colegiado que ya tiene perfil en créditos. Cualquier error se
--    ignora (aviso en el log) para NUNCA impedir que el aula emita el certificado.
-- 3. public.creditos_sincronizar_aula(): el usuario con sesión trae los certificados de
--    SU colegiado que falten (p. ej. emitidos antes de crear su perfil). Lo llama la app
--    al abrir créditos, en lugar del botón "Importar".

create or replace function public.creditos_registrar_certificado(p_code text, p_usuario uuid default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  c aulacaeduc.cpg_certificates%rowtype;
  p public.perfiles%rowtype;
  v_horas numeric;
begin
  if coalesce(trim(p_code), '') = '' then return false; end if;
  -- Evita duplicados si el disparador y la app corren al mismo tiempo.
  perform pg_advisory_xact_lock(hashtext('creditos_cert:' || p_code));
  if exists (select 1 from public.registros r where r.hash = p_code) then return false; end if;

  select * into c from aulacaeduc.cpg_certificates where certificate_code = p_code limit 1;
  if not found or coalesce(c.collegiate_number, '') = '' then return false; end if;

  if p_usuario is not null then
    select * into p from public.perfiles where user_id = p_usuario and colegiado_numero = c.collegiate_number;
  else
    select * into p from public.perfiles where colegiado_numero = c.collegiate_number
      order by created_at desc nulls last limit 1;
  end if;
  if not found then return false; end if;

  v_horas := case when c.video_duration ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then trim(c.video_duration)::numeric else 1 end;
  if v_horas < 0.5 or v_horas > 500 then return false; end if;

  insert into public.registros (usuario_id, nombre, telefono, colegiado_numero, colegiado_activo,
      actividad, institucion, tipo, fecha, horas, creditos, observaciones, hash, archivo_url, archivo_mime)
  values (p.user_id,
      coalesce(nullif(trim(p.nombre), ''), nullif(trim(c.recipient_name), ''), '—'),
      coalesce(p.telefono, ''),
      c.collegiate_number,
      case when p.colegiado_activo then 'Sí' else 'No' end,
      coalesce(nullif(trim(c.video_title), ''), 'Actividad del Aula Virtual CPG'),
      'CAEDUC - Aula Virtual CPG',
      case when c.cert_type = 'volunteer' then 'Voluntariado profesional' else 'Teórica' end,
      coalesce((c.issued_at at time zone 'America/Guatemala')::date, (now() at time zone 'America/Guatemala')::date),
      v_horas,
      round(v_horas / 16, 2),
      'Agregado automáticamente desde Aula Virtual CPG',
      p_code, null, null);
  return true;
end $$;

revoke all on function public.creditos_registrar_certificado(text, uuid) from public, anon, authenticated;

create or replace function public.creditos_sincronizar_aula()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_col text;
  v_code text;
  n integer := 0;
begin
  if auth.uid() is null then return 0; end if;
  select colegiado_numero into v_col from public.perfiles where user_id = auth.uid();
  if coalesce(v_col, '') = '' then return 0; end if;
  for v_code in
    select c.certificate_code from aulacaeduc.cpg_certificates c
     where c.collegiate_number = v_col and coalesce(c.certificate_code, '') <> ''
       and not exists (select 1 from public.registros r where r.hash = c.certificate_code)
     order by c.issued_at
  loop
    begin
      if public.creditos_registrar_certificado(v_code, auth.uid()) then n := n + 1; end if;
    exception when others then
      raise warning 'creditos_sincronizar_aula %: %', v_code, sqlerrm;
    end;
  end loop;
  return n;
end $$;

revoke all on function public.creditos_sincronizar_aula() from public, anon;
grant execute on function public.creditos_sincronizar_aula() to authenticated;

create or replace function public.creditos_certificado_emitido()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.creditos_registrar_certificado(new.certificate_code, null);
  exception when others then
    raise warning 'creditos_certificado_emitido %: %', new.certificate_code, sqlerrm;
  end;
  return null;
end $$;

revoke all on function public.creditos_certificado_emitido() from public, anon, authenticated;

drop trigger if exists creditos_registrar_al_emitir on aulacaeduc.cpg_certificates;
create trigger creditos_registrar_al_emitir
  after insert on aulacaeduc.cpg_certificates
  for each row execute function public.creditos_certificado_emitido();

notify pgrst, 'reload schema';

-- ── REVERTIR ────────────────────────────────────────────────────────────────
--   drop trigger if exists creditos_registrar_al_emitir on aulacaeduc.cpg_certificates;
--   drop function if exists public.creditos_certificado_emitido();
--   drop function if exists public.creditos_sincronizar_aula();
--   drop function if exists public.creditos_registrar_certificado(text, uuid);
