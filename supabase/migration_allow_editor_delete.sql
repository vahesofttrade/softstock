-- Lets any editor (admin or user role, not just admin) delete a product,
-- matching the "✕" button now shown on the Products page.
drop policy if exists "products_delete" on products;
create policy "products_delete" on products for delete using (is_editor());
