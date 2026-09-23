-- Fixes 5 M-7 (Toilet Paper) products the previous refresh missed
-- (their September-sheet row had a blank Type column, so they
-- didn't match and kept their old, stale balance).
update products set balance = 0.0 where name = 'M-7' and type = 'Toilet Paper' and width_cm = 40.0 and ply = 1 and gsm = 17.0;
update products set balance = 0.0 where name = 'M-7' and type = 'Toilet Paper' and width_cm = 40.0 and ply = 2 and gsm = 17.0;
update products set balance = 4035.0 where name = 'M-7' and type = 'Toilet Paper' and width_cm = 46.0 and ply = 2 and gsm = 18.0;
update products set balance = 0.0 where name = 'M-7' and type = 'Toilet Paper' and width_cm = 46.0 and ply = 2 and gsm = 20.0;
update products set balance = 0.0 where name = 'M-7' and type = 'Toilet Paper' and width_cm = 49.0 and ply = 1 and gsm = 25.0;
