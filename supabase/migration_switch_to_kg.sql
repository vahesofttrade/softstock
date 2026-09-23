-- ============================================================
-- SoftStock — SWITCH ENTIRE APP FROM METERS TO KILOGRAMS
-- ============================================================
-- Converts every existing quantity (product balances, manual rates,
-- stock_log entries, reservations, and any delivery still in meters)
-- from running-metres to kilograms using the standard paper-industry
-- formula:  kg = metres × width_cm × gsm × ply / 100,000
-- (1 running metre of a width_cm-wide, ply-layer sheet at gsm grams/m²
--  weighs width_cm/100 × gsm × ply grams = width_cm × gsm × ply / 100 g
--  = width_cm × gsm × ply / 100000 kg.)
--
-- Run this ONCE. It is not safe to re-run (it would convert already-kg
-- numbers a second time). Take a Supabase backup/snapshot first if
-- unsure.
-- ============================================================

-- 1) Product balances
update products
set balance = round((balance * width_cm * gsm * ply / 100000)::numeric, 2)
where width_cm is not null and gsm is not null and width_cm > 0 and gsm > 0;

-- 2) Manual monthly rate (was m/month -> kg/month)
update products
set manual_monthly_rate = round((manual_monthly_rate * width_cm * gsm * ply / 100000)::numeric, 2)
where manual_monthly_rate is not null and width_cm is not null and gsm is not null and width_cm > 0 and gsm > 0;

-- 3) Stock log history (each row converted using its OWN product's spec)
update stock_log sl
set quantity = round((sl.quantity * p.width_cm * p.gsm * p.ply / 100000)::numeric, 2)
from products p
where sl.product_id = p.id and p.width_cm is not null and p.gsm is not null and p.width_cm > 0 and p.gsm > 0;

-- 4) Reservations (quantity + actual_qty)
update reservations r
set quantity = round((r.quantity * p.width_cm * p.gsm * p.ply / 100000)::numeric, 2),
    actual_qty = case when r.actual_qty is not null
                 then round((r.actual_qty * p.width_cm * p.gsm * p.ply / 100000)::numeric, 2)
                 else null end
from products p
where r.product_id = p.id and p.width_cm is not null and p.gsm is not null and p.width_cm > 0 and p.gsm > 0;

-- 5) Deliveries still recorded in metres (unit='m') — convert; ones already
--    in kg (from the earlier kg-fix) are left untouched.
update deliveries d
set quantity = round((d.quantity * p.width_cm * p.gsm * p.ply / 100000)::numeric, 2)
from products p
where d.product_id = p.id and d.unit = 'm' and p.width_cm is not null and p.gsm is not null and p.width_cm > 0 and p.gsm > 0;

-- 6) Everything is kg now — drop the unit column entirely
alter table deliveries drop column if exists unit;

-- 7) Anything that COULDN'T be converted (missing width/gsm) — check this
--    list and fix those products' width/gsm manually, then re-run just
--    the relevant UPDATE above for them.
select id, name, type, width_cm, gsm, ply, balance
from products
where width_cm is null or gsm is null or width_cm <= 0 or gsm <= 0;
