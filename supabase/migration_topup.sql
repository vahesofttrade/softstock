-- ============================================================
-- SoftStock — TOP-UP migration: 18 products present in the
-- 'September' tracking sheet but missing from 'Product Settings',
-- so the first migration.sql skipped them (explains the
-- 582,200.8 vs real 618,474.8 gap — 36,274.0 m).
-- Run ONCE, after migration.sql. Do not re-run migration.sql itself.
-- Adds: 18 products, 58 history rows, 6 deliveries
-- ============================================================

alter table products  add column if not exists import_key text;
alter table suppliers add column if not exists import_key text;

-- ---------------- MISSING PRODUCTS ----------------
-- Type for 'M-7' inferred as Toilet Paper, matching its other size variants
-- already in Product Settings (135/2/18 and 49/2/18) — please double check.
insert into products (name, type, width_cm, ply, gsm, balance, target_months, import_key) values ('Ռուլոն սպիտակ', 'Towels', 135.0, 1, 16.0, 0, 2, 'ռուլոն սպիտակ|towels|135.0|1.0|16.0');
insert into products (name, type, width_cm, ply, gsm, balance, target_months, import_key) values ('Ռուլոն սպիտակ', 'Towels', 135.0, 1, 17.0, 0, 2, 'ռուլոն սպիտակ|towels|135.0|1.0|17.0');
insert into products (name, type, width_cm, ply, gsm, balance, target_months, import_key) values ('Ռուլոն սպիտակ', 'Towels', 135.0, 2, 16.0, 0, 2, 'ռուլոն սպիտակ|towels|135.0|2.0|16.0');
insert into products (name, type, width_cm, ply, gsm, balance, target_months, import_key) values ('Ռուլոն սպիտակ', 'Towels', 135.0, 2, 17.0, 0, 2, 'ռուլոն սպիտակ|towels|135.0|2.0|17.0');
insert into products (name, type, width_cm, ply, gsm, balance, target_months, import_key) values ('Ռուլոն սպիտակ', 'Towels', 135.0, 3, 16.0, 0, 2, 'ռուլոն սպիտակ|towels|135.0|3.0|16.0');
insert into products (name, type, width_cm, ply, gsm, balance, target_months, import_key) values ('Ռուլոն սպիտակ', 'Towels', 135.0, 3, 17.0, 0, 2, 'ռուլոն սպիտակ|towels|135.0|3.0|17.0');
insert into products (name, type, width_cm, ply, gsm, balance, target_months, import_key) values ('M-7', 'Toilet Paper', 40.0, 1, 17.0, 0, 2, 'm-7|toilet paper|40.0|1.0|17.0');
insert into products (name, type, width_cm, ply, gsm, balance, target_months, import_key) values ('M-7', 'Toilet Paper', 40.0, 2, 17.0, 0, 2, 'm-7|toilet paper|40.0|2.0|17.0');
insert into products (name, type, width_cm, ply, gsm, balance, target_months, import_key) values ('M-7', 'Toilet Paper', 46.0, 2, 18.0, 0, 2, 'm-7|toilet paper|46.0|2.0|18.0');
insert into products (name, type, width_cm, ply, gsm, balance, target_months, import_key) values ('M-7', 'Toilet Paper', 46.0, 2, 20.0, 0, 2, 'm-7|toilet paper|46.0|2.0|20.0');
insert into products (name, type, width_cm, ply, gsm, balance, target_months, import_key) values ('M-7', 'Toilet Paper', 49.0, 1, 25.0, 0, 2, 'm-7|toilet paper|49.0|1.0|25.0');
insert into products (name, type, width_cm, ply, gsm, balance, target_months, import_key) values ('Ռուլոն սպիտակ', 'Facial Tissue', 80.0, 4, 14.0, 0, 2, 'ռուլոն սպիտակ|facial tissue|80.0|4.0|14.0');
insert into products (name, type, width_cm, ply, gsm, balance, target_months, import_key) values ('Ռուլոն սպիտակ', 'Facial Tissue', 37.0, 4, 14.0, 0, 2, 'ռուլոն սպիտակ|facial tissue|37.0|4.0|14.0');
insert into products (name, type, width_cm, ply, gsm, balance, target_months, import_key) values ('Ռուլոն սպիտակ', 'Facial Tissue', 72.0, 4, 14.0, 0, 2, 'ռուլոն սպիտակ|facial tissue|72.0|4.0|14.0');
insert into products (name, type, width_cm, ply, gsm, balance, target_months, import_key) values ('БУМАГА-ОСНОВА БС, 14 Г/М2, 1 СЛ., 240 ММ', 'Napkins', 24.0, 1, 14.0, 0, 2, 'бумага-основа бс, 14 г/м2, 1 сл., 240 мм|napkins|24.0|1.0|14.0');
insert into products (name, type, width_cm, ply, gsm, balance, target_months, import_key) values ('Нетканый материал Спанбейс 20/80 40 гр/м2 формат 190мм', 'Spunlace', 19.0, 2, 40.0, 0, 2, 'нетканый материал спанбейс 20/80 40 гр/м2 формат 190мм|spunlace|19.0|2.0|40.0');
insert into products (name, type, width_cm, ply, gsm, balance, target_months, import_key) values ('Нетканый материал Спанбейс 20/80 35 гр/м2 формат 140мм', 'Spunlace', 14.0, 2, 35.0, 0, 2, 'нетканый материал спанбейс 20/80 35 гр/м2 формат 140мм|spunlace|14.0|2.0|35.0');
insert into products (name, type, width_cm, ply, gsm, balance, target_months, import_key) values ('Нетканый материал Спанбейс 20/80 33 гр/м2 формат 190мм', 'Spunlace', 19.0, 2, 33.0, 0, 2, 'нетканый материал спанбейс 20/80 33 гр/м2 формат 190мм|spunlace|19.0|2.0|33.0');

-- ---------------- HISTORY ----------------
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-06-13', 'deduct', 5000.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-06-13', 'add', 5000.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-06-13', 'deduct', 10000.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-06-15', 'deduct', 460.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-06-15', 'add', 5751.0, 'Auto: receiving 1781616158774 · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-06-15', 'add', 435.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-06-15', 'add', 460.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-06-15', 'deduct', 460.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-06-16', 'add', 4957.0, 'Auto: receiving 1781616395819 · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-06-16', 'deduct', 435.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-06-17', 'update', 9961.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-06-17', 'update', 5210.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-06-17', 'update', 13599.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-06-22', 'deduct', 1299.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-06-22', 'update', 9961.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-06-25', 'deduct', 501.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-06-30', 'update', 8989.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-07-01', 'deduct', 471.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-07-02', 'deduct', 494.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-07-03', 'deduct', 447.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-07-04', 'add', 845.0, 'Auto: receiving 1783142357956 · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|facial tissue|80.0|4.0|14.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-07-04', 'deduct', 567.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|facial tissue|80.0|4.0|14.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-07-04', 'deduct', 1466.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-07-04', 'deduct', 460.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-07-04', 'deduct', 502.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-07-04', 'deduct', 502.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-07-04', 'update', 8958.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-07-06', 'deduct', 471.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-07-06', 'deduct', 915.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-07-13', 'deduct', 946.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-07-13', 'deduct', 499.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-07-14', 'deduct', 479.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-07-15', 'update', 18945.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-07-18', 'deduct', 445.0, 'Reservation #1784273559468 → production · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-07-28', 'deduct', 466.0, 'Reservation #1785147758384 → production · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-07-28', 'deduct', 533.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-07-29', 'deduct', 482.0, 'Reservation #1785161740449 → production · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-08-04', 'deduct', 503.0, 'Reservation #1785737125917 → production · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-08-04', 'add', 2852.0, 'Auto: receiving 1785560836636 · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|facial tissue|72.0|4.0|14.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-08-04', 'add', 6280.0, 'Auto: receiving 1785560838912 · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|facial tissue|80.0|4.0|14.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-08-04', 'add', 1438.0, 'Auto: receiving 1785560840933 · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|facial tissue|37.0|4.0|14.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-08-06', 'deduct', 533.0, 'Reservation #1785917426559 → production · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-08-08', 'deduct', 424.0, 'Reservation #1786111868890 → production · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-08-10', 'deduct', 422.0, 'Reservation #1786177461911 → production · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-08-13', 'deduct', 504.0, 'Reservation #1786512556886 → production · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-08-13', 'deduct', 485.0, 'Reservation #1786539334579 → production · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-08-17', 'deduct', 537.0, 'Reservation #1786788174337 → production · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-08-17', 'deduct', 449.0, 'Reservation #1786869518723 → production · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-08-17', 'deduct', 449.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-08-18', 'deduct', 521.0, 'Reservation #1786861412277 → production · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-08-21', 'deduct', 457.0, 'imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-08-27', 'deduct', 501.0, 'Reservation #1787752801286 → production · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-09-03', 'deduct', 533.0, 'Reservation #1788258110339 → production · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-09-03', 'deduct', 463.0, 'Reservation #1788327634980 → production · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-09-07', 'deduct', 493.0, 'Reservation #1788682200913 → production · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-09-08', 'deduct', 539.0, 'Reservation #1788759625312 → production · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-09-16', 'deduct', 479.0, 'Reservation #1789372156199 → production · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
insert into stock_log (product_id, date, operation, quantity, note) select id, '2026-09-16', 'deduct', 523.0, 'Reservation #1789366153283 → production · imported, by Vahe' from products where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';

-- ---------------- BALANCE CORRECTION ----------------
update products set balance = 4145.0 where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|16.0';
update products set balance = 0.0 where import_key = 'ռուլոն սպիտակ|towels|135.0|1.0|17.0';
update products set balance = 4750.0 where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|16.0';
update products set balance = 12496.0 where import_key = 'ռուլոն սպիտակ|towels|135.0|2.0|17.0';
update products set balance = 0.0 where import_key = 'ռուլոն սպիտակ|towels|135.0|3.0|16.0';
update products set balance = 0.0 where import_key = 'ռուլոն սպիտակ|towels|135.0|3.0|17.0';
update products set balance = 0.0 where import_key = 'm-7|toilet paper|40.0|1.0|17.0';
update products set balance = 0.0 where import_key = 'm-7|toilet paper|40.0|2.0|17.0';
update products set balance = 4035.0 where import_key = 'm-7|toilet paper|46.0|2.0|18.0';
update products set balance = 0.0 where import_key = 'm-7|toilet paper|46.0|2.0|20.0';
update products set balance = 0.0 where import_key = 'm-7|toilet paper|49.0|1.0|25.0';
update products set balance = 6558.0 where import_key = 'ռուլոն սպիտակ|facial tissue|80.0|4.0|14.0';
update products set balance = 1438.0 where import_key = 'ռուլոն սպիտակ|facial tissue|37.0|4.0|14.0';
update products set balance = 2852.0 where import_key = 'ռուլոն սպիտակ|facial tissue|72.0|4.0|14.0';
update products set balance = 0.0 where import_key = 'бумага-основа бс, 14 г/м2, 1 сл., 240 мм|napkins|24.0|1.0|14.0';
update products set balance = 0.0 where import_key = 'нетканый материал спанбейс 20/80 40 гр/м2 формат 190мм|spunlace|19.0|2.0|40.0';
update products set balance = 0.0 where import_key = 'нетканый материал спанбейс 20/80 35 гр/м2 формат 140мм|spunlace|14.0|2.0|35.0';
update products set balance = 0.0 where import_key = 'нетканый материал спанбейс 20/80 33 гр/м2 формат 190мм|spunlace|19.0|2.0|33.0';

-- ---------------- DELIVERIES ----------------
insert into deliveries (product_id, supplier_id, quantity, plate_no, expected_date, status) select id, (select id from suppliers where import_key = 'kostroma'), 70734.12698412698, 'MG100TR', '2026-08-10', 'arrived' from products where import_key = 'ռուլոն սպիտակ|facial tissue|72.0|4.0|14.0';
insert into deliveries (product_id, supplier_id, quantity, plate_no, expected_date, status) select id, (select id from suppliers where import_key = 'kostroma'), 140178.57142857142, 'MG100TR', '2026-08-10', 'arrived' from products where import_key = 'ռուլոն սպիտակ|facial tissue|80.0|4.0|14.0';
insert into deliveries (product_id, supplier_id, quantity, plate_no, expected_date, status) select id, (select id from suppliers where import_key = 'kostroma'), 69401.54440154441, 'MG100TR', '2026-08-10', 'arrived' from products where import_key = 'ռուլոն սպիտակ|facial tissue|37.0|4.0|14.0';
insert into deliveries (product_id, supplier_id, quantity, plate_no, expected_date, status) select id, (select id from suppliers where import_key = 'rio international'), 314274.322169059, 'originally 3941 kg', '2026-09-28', 'pending' from products where import_key = 'нетканый материал спанбейс 20/80 33 гр/м2 формат 190мм|spunlace|19.0|2.0|33.0';
insert into deliveries (product_id, supplier_id, quantity, plate_no, expected_date, status) select id, (select id from suppliers where import_key = 'rio international'), 118775.51020408163, 'originally 1164 kg', '2026-09-28', 'pending' from products where import_key = 'нетканый материал спанбейс 20/80 35 гр/м2 формат 140мм|spunlace|14.0|2.0|35.0';
insert into deliveries (product_id, supplier_id, quantity, plate_no, expected_date, status) select id, (select id from suppliers where import_key = 'rio international'), 104013.15789473684, 'originally 1581 kg', '2026-09-28', 'pending' from products where import_key = 'нетканый материал спанбейс 20/80 40 гр/м2 формат 190мм|spunlace|19.0|2.0|40.0';

-- ---------------- CLEANUP ----------------
alter table products  drop column import_key;
alter table suppliers drop column import_key;