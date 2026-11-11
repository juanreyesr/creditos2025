-- Créditos: los comprobantes ya no son visibles para cualquier usuario con sesión
--
-- APLICADO en producción el 2026-11-11 (migración "creditos_comprobantes_lectura_segun_registro").
--
-- Problema: la regla "storage_comprobantes_select_auth" dejaba leer TODO el bucket
-- comprobantes a cualquier usuario con sesión. El proyecto de Supabase es compartido con
-- el aula virtual (donde cualquiera puede registrarse), así que cualquier persona podía
-- ver los certificados y documentos de todos los colegiados.
--
-- Solución (las reglas de "propios" y de superadmin existentes no se tocan):
--   1. comprobantes_lectura_segun_registro: se puede leer un comprobante si se puede leer
--      su registro en public.registros (misma regla de esa tabla: dueño, mismo número de
--      colegiado, superadmin de créditos y administradores del aula).
--   2. comprobantes_consolidado_propio_select: cada usuario lee su propio consolidado.
--   3. Se elimina storage_comprobantes_select_auth.
--
-- Ensayo con rollback sobre datos reales antes de aplicar:
--   colegiado: su archivo 1→1, total visible 695→1 · registro con archivo en carpeta de
--   otra cuenta 1→1 · usuario cualquiera del aula 695→0 · superadmin 695→695 ·
--   admin del aula 695→647 (todos los que tienen registro) · consolidado propio 1→1.
-- El modo "admin local" (contraseña) no se ve afectado: la tabla registros ya solo le
-- muestra los registros propios.

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'comprobantes_lectura_segun_registro') then
    create policy comprobantes_lectura_segun_registro on storage.objects for select to authenticated
      using (bucket_id = 'comprobantes' and exists (select 1 from public.registros r where r.archivo_url = objects.name));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'comprobantes_consolidado_propio_select') then
    create policy comprobantes_consolidado_propio_select on storage.objects for select to authenticated
      using (bucket_id = 'comprobantes' and (storage.foldername(name))[1] = 'consolidados' and (storage.foldername(name))[2] = (auth.uid())::text);
  end if;
end $$;

drop policy if exists storage_comprobantes_select_auth on storage.objects;

-- REVERTIR (vuelve a dejar el bucket legible para cualquier usuario con sesión):
--   create policy storage_comprobantes_select_auth on storage.objects for select to authenticated
--     using (bucket_id = 'comprobantes');
--   drop policy comprobantes_lectura_segun_registro on storage.objects;
--   drop policy comprobantes_consolidado_propio_select on storage.objects;
