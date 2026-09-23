drop policy if exists "deliveries_delete" on deliveries;
create policy "deliveries_delete" on deliveries for delete using (is_editor());
