-- Run in the Supabase SQL Editor before opening operations.html.
-- Existing properties and booking_requests are deliberately preserved.
create table if not exists public.baleva_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','reservations','finance','partner')),
  display_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.baleva_has_role(allowed text[])
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.baleva_staff
  where user_id = (select auth.uid()) and active and role = any(allowed)); $$;
revoke all on function public.baleva_has_role(text[]) from public;
grant execute on function public.baleva_has_role(text[]) to authenticated;

alter table public.baleva_staff enable row level security;
drop policy if exists "Read own staff membership" on public.baleva_staff;
create policy "Read own staff membership" on public.baleva_staff for select to authenticated
using (user_id = (select auth.uid()));
-- Provision staff through the SQL Editor or a trusted server, never from a browser.

create table if not exists public.baleva_room_rates (
  id bigint generated always as identity primary key,
  property_id bigint not null references public.properties(id) on delete cascade,
  room_type text not null,
  net_rate integer not null check (net_rate > 0),
  markup integer not null check (markup between 50000 and 150000),
  currency text not null default 'IDR' check (currency = 'IDR'),
  active boolean not null default true,
  verified_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(property_id, room_type)
);
alter table public.baleva_room_rates enable row level security;
drop policy if exists "Staff read rates" on public.baleva_room_rates;
create policy "Staff read rates" on public.baleva_room_rates for select to authenticated
using (public.baleva_has_role(array['owner','admin','reservations','finance']));
drop policy if exists "Managers write rates" on public.baleva_room_rates;
create policy "Managers write rates" on public.baleva_room_rates for all to authenticated
using (public.baleva_has_role(array['owner','admin']))
with check (public.baleva_has_role(array['owner','admin']));

-- Initial editable estimates for every existing accommodation; not verified/bookable.
insert into public.baleva_room_rates(property_id,room_type,net_rate,markup,active)
select id,'Kamar Standar',500000,50000,true from public.properties
on conflict (property_id,room_type) do nothing;

create table if not exists public.baleva_reservations (
  id bigint generated always as identity primary key,
  property_id bigint not null references public.properties(id),
  room_rate_id bigint not null references public.baleva_room_rates(id),
  guest_name text not null,
  guest_contact text not null,
  check_in date not null,
  check_out date not null,
  rooms integer not null check (rooms between 1 and 50),
  nights integer generated always as (check_out - check_in) stored,
  net_rate integer not null check (net_rate > 0),
  markup integer not null check (markup between 50000 and 150000),
  guest_total bigint generated always as ((net_rate::bigint + markup::bigint) * rooms * (check_out - check_in)) stored,
  hotel_total bigint generated always as (net_rate::bigint * rooms * (check_out - check_in)) stored,
  status text not null default 'payment_verified' check (status in
    ('payment_verified','checking_hotel','confirmed','alternative_offered','refund_pending','refunded','cancelled','checked_out','settled')),
  guest_paid_at timestamptz not null,
  guest_payment_reference text not null,
  hotel_confirmed_at timestamptz,
  hotel_paid_at timestamptz,
  hotel_payment_reference text,
  refund_at timestamptz,
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_stay check (check_out > check_in and check_out <= check_in + 90),
  constraint hotel_payment_requires_checkout check (hotel_paid_at is null or (hotel_payment_reference is not null and status = 'settled')),
  constraint settled_requires_payment check (status <> 'settled' or hotel_paid_at is not null),
  constraint refunded_requires_timestamp check (status <> 'refunded' or refund_at is not null)
);
create index if not exists baleva_reservations_checkout_idx on public.baleva_reservations(check_out, status);
alter table public.baleva_reservations enable row level security;
drop policy if exists "Staff read reservations" on public.baleva_reservations;
create policy "Staff read reservations" on public.baleva_reservations for select to authenticated
using (public.baleva_has_role(array['owner','admin','reservations','finance']));
drop policy if exists "Staff create reservations" on public.baleva_reservations;
create policy "Staff create reservations" on public.baleva_reservations for insert to authenticated
with check (public.baleva_has_role(array['owner','admin','reservations']) and created_by = (select auth.uid()));
drop policy if exists "Staff update reservations" on public.baleva_reservations;
create policy "Staff update reservations" on public.baleva_reservations for update to authenticated
using (public.baleva_has_role(array['owner','admin','reservations','finance']))
with check (public.baleva_has_role(array['owner','admin','reservations','finance']));

create table if not exists public.baleva_reservation_events (
  id bigint generated always as identity primary key,
  reservation_id bigint not null references public.baleva_reservations(id) on delete cascade,
  actor uuid references auth.users(id),
  old_status text,
  new_status text not null,
  happened_at timestamptz not null default now()
);
alter table public.baleva_reservation_events enable row level security;
drop policy if exists "Staff read events" on public.baleva_reservation_events;
create policy "Staff read events" on public.baleva_reservation_events for select to authenticated
using (public.baleva_has_role(array['owner','admin','reservations','finance']));

create or replace function public.baleva_reservation_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare rate_row public.baleva_room_rates%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into rate_row from public.baleva_room_rates where id = new.room_rate_id and active and verified_at is not null;
    if not found or rate_row.property_id <> new.property_id
       or rate_row.net_rate <> new.net_rate or rate_row.markup <> new.markup then
      raise exception 'Tarif belum diverifikasi atau tidak sesuai dengan akomodasi.';
    end if;
    if new.status <> 'payment_verified' or new.hotel_paid_at is not null or new.refund_at is not null then
      raise exception 'Pesanan baru harus dimulai dari pembayaran tamu terverifikasi.';
    end if;
    return new;
  end if;
  if row(new.property_id,new.room_rate_id,new.guest_name,new.guest_contact,new.check_in,new.check_out,new.rooms,new.net_rate,new.markup,new.guest_paid_at,new.guest_payment_reference,new.created_by)
    is distinct from row(old.property_id,old.room_rate_id,old.guest_name,old.guest_contact,old.check_in,old.check_out,old.rooms,old.net_rate,old.markup,old.guest_paid_at,old.guest_payment_reference,old.created_by) then
    raise exception 'Data dan harga pesanan terkunci setelah pembayaran dicatat.';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'payment_verified' and new.status in ('checking_hotel','refund_pending')) or
    (old.status = 'checking_hotel' and new.status in ('confirmed','alternative_offered','refund_pending')) or
    (old.status = 'alternative_offered' and new.status in ('confirmed','refund_pending')) or
    (old.status = 'confirmed' and new.status in ('checked_out','refund_pending')) or
    (old.status = 'checked_out' and new.status = 'settled') or
    (old.status = 'refund_pending' and new.status = 'refunded')
  ) then raise exception 'Perubahan status reservasi tidak sesuai alur.'; end if;
  if new.status = 'confirmed' and new.hotel_confirmed_at is null then
    raise exception 'Waktu konfirmasi hotel wajib dicatat.';
  end if;
  if new.status = 'checked_out' and current_date < new.check_out then
    raise exception 'Tanggal checkout belum tiba.';
  end if;
  if new.status = 'settled' and (new.hotel_paid_at is null or new.hotel_payment_reference is null) then
    raise exception 'Bukti pelunasan hotel wajib dicatat.';
  end if;
  if new.status = 'settled' and new.status is distinct from old.status
     and new.hotel_paid_at::date < new.check_out + 2 then
    raise exception 'Pelunasan hotel mulai hari kedua setelah checkout.';
  end if;
  if new.status is distinct from old.status and
     ((new.status = 'settled' and not public.baleva_has_role(array['owner','admin','finance'])) or
      (new.status <> 'settled' and not public.baleva_has_role(array['owner','admin','reservations']))) then
    raise exception 'Peran akun tidak diizinkan melakukan perubahan ini.';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists baleva_guard on public.baleva_reservations;
create trigger baleva_guard before insert or update on public.baleva_reservations
for each row execute function public.baleva_reservation_guard();

create or replace function public.baleva_log_reservation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.baleva_reservation_events(reservation_id,actor,old_status,new_status)
    values(new.id,auth.uid(),case when tg_op = 'INSERT' then null else old.status end,new.status);
  end if;
  return new;
end $$;
drop trigger if exists baleva_log on public.baleva_reservations;
create trigger baleva_log after insert or update on public.baleva_reservations
for each row execute function public.baleva_log_reservation();

grant select on public.baleva_staff,public.baleva_room_rates,public.baleva_reservations,public.baleva_reservation_events to authenticated;
grant insert,update on public.baleva_room_rates,public.baleva_reservations to authenticated;
grant usage,select on sequence public.baleva_room_rates_id_seq,public.baleva_reservations_id_seq to authenticated;

-- Activate the first owner after the account exists in Authentication:
-- insert into public.baleva_staff(user_id, role, display_name)
-- select id, 'owner', 'Aldi Nurrasyid' from auth.users where email = 'YOUR_EMAIL_HERE';
-- Review existing properties and booking_requests RLS separately before granting new accounts access.
