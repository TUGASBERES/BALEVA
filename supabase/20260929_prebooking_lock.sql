-- Run immediately after 20260929_booking_foundation.sql, before deploying the panel.
-- This replaces the provisional payment-first workflow with partner-check-first.
create table if not exists public.baleva_inquiries (
  id bigint generated always as identity primary key,
  property_id bigint not null references public.properties(id),
  room_rate_id bigint not null references public.baleva_room_rates(id),
  guest_name text not null,
  guest_contact text not null,
  check_in date not null,
  check_out date not null,
  rooms integer not null check (rooms between 1 and 50),
  status text not null default 'requested' check (status in
    ('requested','checking_partner','available','unavailable','offered','declined','locked','expired','converted')),
  partner_verified_at timestamptz,
  customer_contacted_at timestamptz,
  lock_hours integer check (lock_hours in (2,6)),
  locked_at timestamptz,
  lock_expires_at timestamptz,
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_inquiry_stay check (check_out > check_in and check_out <= check_in + 90)
);
create index if not exists baleva_inquiries_status_idx on public.baleva_inquiries(status,lock_expires_at);
alter table public.baleva_inquiries enable row level security;
create policy "Staff read inquiries" on public.baleva_inquiries for select to authenticated
using (public.baleva_has_role(array['owner','admin','reservations','finance']));
create policy "Booking staff create inquiries" on public.baleva_inquiries for insert to authenticated
with check (public.baleva_has_role(array['owner','admin','reservations']) and created_by = (select auth.uid()));
create policy "Booking staff update inquiries" on public.baleva_inquiries for update to authenticated
using (public.baleva_has_role(array['owner','admin','reservations']))
with check (public.baleva_has_role(array['owner','admin','reservations']));

create or replace function public.baleva_inquiry_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare rate_property bigint;
begin
  if tg_op = 'INSERT' then
    select property_id into rate_property from public.baleva_room_rates where id = new.room_rate_id;
    if rate_property is distinct from new.property_id or new.status <> 'requested'
       or new.locked_at is not null or new.lock_expires_at is not null then
      raise exception 'Permintaan harus dimulai sebelum cek mitra dan sesuai tipe kamar.';
    end if;
    return new;
  end if;
  if row(new.property_id,new.room_rate_id,new.guest_name,new.guest_contact,new.check_in,new.check_out,new.rooms,new.created_by)
     is distinct from row(old.property_id,old.room_rate_id,old.guest_name,old.guest_contact,old.check_in,old.check_out,old.rooms,old.created_by) then
    raise exception 'Ubah detail dengan membuat permintaan baru.';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'requested' and new.status = 'checking_partner') or
    (old.status = 'checking_partner' and new.status in ('available','unavailable')) or
    (old.status = 'available' and new.status = 'offered') or
    (old.status = 'offered' and new.status in ('locked','declined')) or
    (old.status = 'locked' and new.status = 'expired') or
    (old.status = 'locked' and new.status = 'converted' and exists
      (select 1 from public.baleva_reservations where inquiry_id = new.id))
  ) then raise exception 'Urutan cek mitra, penawaran, dan lock tidak sesuai.'; end if;
  if new.status = 'available' and old.status <> 'available' then
    new.partner_verified_at := now();
  end if;
  if new.status = 'offered' and old.status <> 'offered' then
    if old.partner_verified_at is null then raise exception 'Mitra belum mengonfirmasi stok.'; end if;
    new.customer_contacted_at := now();
  end if;
  if new.status = 'locked' and old.status <> 'locked' then
    if old.customer_contacted_at is null then raise exception 'Pelanggan belum dihubungi.'; end if;
    if new.check_in < current_date or new.check_in > current_date + 30 then
      raise exception 'Lock hanya untuk check-in dalam 30 hari ke depan.';
    end if;
    if new.lock_hours not in (2,6) then raise exception 'Pilih lock 2 atau 6 jam.'; end if;
    new.locked_at := now();new.lock_expires_at := now() + make_interval(hours => new.lock_hours);
  end if;
  if new.status = 'expired' and old.status <> 'expired' and now() < old.lock_expires_at then
    raise exception 'Lock belum kedaluwarsa.';
  end if;
  if new.status <> 'locked' and new.lock_expires_at is distinct from old.lock_expires_at then
    raise exception 'Batas lock tidak boleh diubah langsung.';
  end if;
  new.updated_at := now();return new;
end $$;
create trigger baleva_inquiry_guard before insert or update on public.baleva_inquiries
for each row execute function public.baleva_inquiry_guard();

alter table public.baleva_reservations add column if not exists inquiry_id bigint unique references public.baleva_inquiries(id);
alter table public.baleva_reservations alter column inquiry_id set not null;
alter table public.baleva_reservations alter column status set default 'confirmed';
alter table public.baleva_reservations drop constraint if exists baleva_reservations_status_check;
alter table public.baleva_reservations add constraint baleva_reservations_status_check
check (status in ('confirmed','cancel_requested','refund_pending','refunded','checked_out','settled'));

create table if not exists public.baleva_cancellation_requests (
  id bigint generated always as identity primary key,
  reservation_id bigint not null references public.baleva_reservations(id),
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decision_note text,
  created_by uuid not null default auth.uid() references auth.users(id)
);
create unique index if not exists baleva_one_pending_cancellation
on public.baleva_cancellation_requests(reservation_id) where status = 'pending';
alter table public.baleva_cancellation_requests enable row level security;
create policy "Staff read cancellation requests" on public.baleva_cancellation_requests for select to authenticated
using (public.baleva_has_role(array['owner','admin','reservations','finance']));
create policy "Booking staff create cancellation requests" on public.baleva_cancellation_requests for insert to authenticated
with check (public.baleva_has_role(array['owner','admin','reservations']) and created_by = (select auth.uid()));
create policy "Managers decide cancellation requests" on public.baleva_cancellation_requests for update to authenticated
using (public.baleva_has_role(array['owner','admin'])) with check (public.baleva_has_role(array['owner','admin']));

create or replace function public.baleva_cancellation_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare current_status text;
begin
  select status into current_status from public.baleva_reservations where id = new.reservation_id;
  if tg_op = 'INSERT' then
    if current_status <> 'confirmed' or new.status <> 'pending' then
      raise exception 'Pembatalan hanya dapat diajukan untuk reservasi terkonfirmasi.';
    end if;
    return new;
  end if;
  if new.reservation_id <> old.reservation_id or new.reason <> old.reason or old.status <> 'pending'
     or new.status not in ('approved','rejected') or new.decided_at is null or nullif(trim(new.decision_note),'') is null then
    raise exception 'Keputusan pembatalan wajib disertai alasan dan tidak dapat ditimpa.';
  end if;
  return new;
end $$;
create trigger baleva_cancellation_guard before insert or update on public.baleva_cancellation_requests
for each row execute function public.baleva_cancellation_guard();

create or replace function public.baleva_reservation_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare rate_row public.baleva_room_rates%rowtype; inquiry_row public.baleva_inquiries%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into inquiry_row from public.baleva_inquiries where id = new.inquiry_id for update;
    if not found or inquiry_row.status <> 'locked' or now() > inquiry_row.lock_expires_at then
      raise exception 'Lock kamar tidak aktif atau sudah kedaluwarsa. Cek ulang ke mitra.';
    end if;
    select * into rate_row from public.baleva_room_rates where id = new.room_rate_id and active and verified_at is not null;
    if not found or row(new.property_id,new.room_rate_id,new.guest_name,new.guest_contact,new.check_in,new.check_out,new.rooms)
       is distinct from row(inquiry_row.property_id,inquiry_row.room_rate_id,inquiry_row.guest_name,inquiry_row.guest_contact,inquiry_row.check_in,inquiry_row.check_out,inquiry_row.rooms)
       or rate_row.property_id <> new.property_id or rate_row.net_rate <> new.net_rate or rate_row.markup <> new.markup then
      raise exception 'Tarif atau detail pesanan tidak cocok dengan kamar yang sudah dikunci.';
    end if;
    if new.status <> 'confirmed' or new.hotel_paid_at is not null or new.refund_at is not null
       or new.guest_paid_at > now() or new.guest_paid_at < inquiry_row.locked_at
       or new.guest_paid_at > inquiry_row.lock_expires_at then
      raise exception 'Konfirmasi memerlukan pembayaran tamu yang diverifikasi selama lock berlaku.';
    end if;
    new.hotel_confirmed_at := inquiry_row.partner_verified_at;
    return new;
  end if;
  if row(new.inquiry_id,new.property_id,new.room_rate_id,new.guest_name,new.guest_contact,new.check_in,new.check_out,new.rooms,new.net_rate,new.markup,new.guest_paid_at,new.guest_payment_reference,new.created_by)
    is distinct from row(old.inquiry_id,old.property_id,old.room_rate_id,old.guest_name,old.guest_contact,old.check_in,old.check_out,old.rooms,old.net_rate,old.markup,old.guest_paid_at,old.guest_payment_reference,old.created_by) then
    raise exception 'Data dan harga pesanan terkunci setelah pembayaran dicatat.';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'confirmed' and new.status in ('cancel_requested','checked_out')) or
    (old.status = 'cancel_requested' and new.status in ('confirmed','refund_pending')) or
    (old.status = 'checked_out' and new.status = 'settled') or
    (old.status = 'refund_pending' and new.status = 'refunded')
  ) then raise exception 'Perubahan status reservasi tidak sesuai alur.'; end if;
  if new.status = 'cancel_requested' and not exists (
    select 1 from public.baleva_cancellation_requests where reservation_id = new.id and status = 'pending') then
    raise exception 'Belum ada pengajuan pembatalan.';
  end if;
  if old.status = 'cancel_requested' and new.status in ('confirmed','refund_pending') and not exists (
    select 1 from public.baleva_cancellation_requests where reservation_id = new.id
      and status = case when new.status = 'confirmed' then 'rejected' else 'approved' end) then
    raise exception 'Keputusan pembatalan belum dicatat.';
  end if;
  if new.status = 'checked_out' and current_date < new.check_out then raise exception 'Tanggal checkout belum tiba.'; end if;
  if new.status = 'settled' and (new.hotel_paid_at is null or new.hotel_payment_reference is null
      or new.hotel_paid_at::date < new.check_out + 2) then
    raise exception 'Pelunasan hotel memerlukan bukti dan mulai hari kedua setelah checkout.';
  end if;
  if new.status = 'refunded' and new.refund_at is null then raise exception 'Bukti refund wajib dicatat.'; end if;
  if new.status is distinct from old.status and
     ((new.status = 'settled' and not public.baleva_has_role(array['owner','admin','finance'])) or
      (new.status <> 'settled' and not public.baleva_has_role(array['owner','admin','reservations']))) then
    raise exception 'Peran akun tidak diizinkan melakukan perubahan ini.';
  end if;
  new.updated_at := now();return new;
end $$;

create or replace function public.baleva_convert_inquiry()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.baleva_inquiries set status = 'converted', updated_at = now()
  where id = new.inquiry_id and status = 'locked';
  return new;
end $$;
create trigger baleva_convert_inquiry after insert on public.baleva_reservations
for each row execute function public.baleva_convert_inquiry();

grant select on public.baleva_inquiries,public.baleva_cancellation_requests to authenticated;
grant insert,update on public.baleva_inquiries,public.baleva_cancellation_requests to authenticated;
grant usage,select on sequence public.baleva_inquiries_id_seq,public.baleva_cancellation_requests_id_seq to authenticated;
