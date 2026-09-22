drop policy if exists "suppliers_delete" on suppliers;
create policy "suppliers_delete" on suppliers for delete using (is_editor());
