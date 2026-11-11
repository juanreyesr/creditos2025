-- Créditos: permitir guardar el "Registro unificado de créditos" de cada colegiado
--
-- APLICADO en producción el 2026-11-11 (migración "creditos_consolidado_propio_insert").
--
-- Problema: script.js guarda una copia del consolidado en
--   comprobantes/consolidados/<id del usuario>/registro_unificado_creditos.pdf
-- pero la única regla de subida del bucket ("comprobantes insert own") exige que la
-- PRIMERA carpeta sea el id del usuario. Por eso nunca se pudo guardar (0 consolidados
-- en el bucket); el colegiado recibía su PDF pero la pantalla mostraba
-- "Consolidado generado (sin subir)".
--
-- Solución: se AGREGA una regla que permite a cada usuario con sesión subir solo en
-- consolidados/<su propio id>/. No se modifica ninguna regla existente: reemplazar
-- (upsert) ya lo cubre "storage_comprobantes_update_owner" y leer ya estaba permitido.
--
-- Ensayo con rollback antes de aplicar: subir/reemplazar/leer el propio ✔; subir en la
-- carpeta de otro usuario ✘; fuera de consolidados/<id> ✘; sin sesión ✘; comprobantes
-- normales sin cambios ✔.

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'comprobantes_consolidado_propio_insert') then
    create policy comprobantes_consolidado_propio_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'comprobantes'
                  and (storage.foldername(name))[1] = 'consolidados'
                  and (storage.foldername(name))[2] = (auth.uid())::text);
  end if;
end $$;

-- REVERTIR:
--   drop policy comprobantes_consolidado_propio_insert on storage.objects;
