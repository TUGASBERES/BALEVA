const cfg=window.BALEVA_CONFIG||{};
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rupiah=x=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(x||0);
const prettyDate=x=>x?new Date(`${x}T12:00:00`).toLocaleDateString('id-ID'):'—';
const roles=['owner','admin','reservations','finance'];
const labels={payment_verified:'Dana diterima',checking_hotel:'Cek hotel',confirmed:'Dikonfirmasi',alternative_offered:'Tawarkan alternatif',refund_pending:'Proses refund',refunded:'Refund selesai',cancelled:'Dibatalkan',checked_out:'Checkout',settled:'Hotel lunas'};
const next={payment_verified:['checking_hotel','refund_pending'],checking_hotel:['confirmed','alternative_offered','refund_pending'],alternative_offered:['confirmed','refund_pending'],confirmed:['checked_out','refund_pending'],checked_out:['settled'],refund_pending:['refunded']};
let db,user,role,properties=[],rates=[],bookings=[];
const localNow=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)};
function block(reason){$('app').hidden=true;$('blocked').hidden=false;$('blockedReason').textContent=reason;}
function errorMessage(e){return e?.message||'Terjadi kesalahan. Silakan coba lagi.'}
async function start(){
  if(!cfg.SUPABASE_URL||!cfg.SUPABASE_PUBLISHABLE_KEY||!window.supabase){block('Konfigurasi layanan belum tersedia.');return;}
  db=supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY);
  const session=await db.auth.getUser();user=session.data?.user;
  if(!user){location.href='login.html';return;}
  const membership=await db.from('baleva_staff').select('role,active,display_name').eq('user_id',user.id).maybeSingle();
  if(membership.error||!membership.data?.active||!roles.includes(membership.data.role)){
    block('Akun belum menjadi staf BALEVA. Admin utama perlu mendaftarkan peran Anda di sistem.');return;
  }
  role=membership.data.role;
  $('identity').textContent=`${membership.data.display_name} · ${role} · ${user.email}`;
  if(!['owner','admin'].includes(role)){$('ratesPanel').querySelector('form').hidden=true;$('propertyLink').hidden=true;}
  if(role==='finance')$('createPanel').hidden=true;
  $('guestPaidAt').value=localNow();$('app').hidden=false;await load();
}
async function load(){
  const [pr,ra,bo]=await Promise.all([
    db.from('properties').select('id,name').order('name'),
    db.from('baleva_room_rates').select('*').order('updated_at',{ascending:false}),
    db.from('baleva_reservations').select('*').order('created_at',{ascending:false})
  ]);
  const failed=[pr,ra,bo].find(x=>x.error);if(failed){$('actionMessage').textContent=`Gagal memuat data: ${errorMessage(failed.error)}`;return;}
  properties=pr.data||[];rates=ra.data||[];bookings=bo.data||[];
  $('rateProperty').innerHTML=properties.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('bookingRate').innerHTML='<option value="">Pilih tarif terverifikasi</option>'+rates.filter(r=>r.active&&r.verified_at).map(r=>`<option value="${r.id}">${esc(nameOf(r.property_id))} · ${esc(r.room_type)} · ${rupiah(r.net_rate+r.markup)}/malam</option>`).join('');
  $('rateRows').innerHTML=rates.map(r=>`<tr><td>${esc(nameOf(r.property_id))}</td><td>${esc(r.room_type)}</td><td>${rupiah(r.net_rate)}</td><td>${rupiah(r.markup)}</td><td>${rupiah(r.net_rate+r.markup)}</td><td>${(r.markup/r.net_rate*100).toFixed(1)}%</td><td>${r.verified_at?'Terverifikasi':'Belum diverifikasi'} ${['owner','admin'].includes(role)?`<button class="quiet editRate" data-id="${r.id}">Edit</button>`:''}</td></tr>`).join('')||'<tr><td colspan="7">Tarif belum diisi.</td></tr>';
  document.querySelectorAll('.editRate').forEach(button=>button.onclick=()=>{
    const r=rates.find(item=>item.id===Number(button.dataset.id));if(!r)return;
    $('rateProperty').value=r.property_id;$('roomType').value=r.room_type;
    $('netRate').value=r.net_rate;$('markup').value=r.markup;$('verified').checked=!!r.verified_at;
    previewRate();$('ratesPanel').scrollIntoView({behavior:'smooth'});
  });
  renderBookings();previewBooking();
}
function nameOf(id){return properties.find(p=>p.id===id)?.name||`ID ${id}`}
function days(a,b){if(!a||!b)return 0;return Math.round((Date.parse(`${b}T00:00:00Z`)-Date.parse(`${a}T00:00:00Z`))/86400000)}
function dueDate(booking){const d=new Date(`${booking.check_out}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+7);return d.toISOString().slice(0,10)}
function offsetDate(date,days){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
function previewRate(){let net=Number($('netRate').value),markup=Number($('markup').value);$('ratePreview').textContent=net>0&&markup>=50000&&markup<=150000?`Tamu: ${rupiah(net+markup)} / malam · Komisi: ${(markup/net*100).toFixed(1)}% dari NET`:''}
function previewBooking(){let r=rates.find(x=>x.id===Number($('bookingRate').value)),n=days($('checkIn').value,$('checkOut').value),rooms=Number($('rooms').value);$('bookingPreview').textContent=r&&n>0&&rooms>0?`${n} malam × ${rooms} kamar · Tamu membayar ${rupiah((r.net_rate+r.markup)*n*rooms)} · NET hotel ${rupiah(r.net_rate*n*rooms)} · Komisi ${rupiah(r.markup*n*rooms)}`:'Pilih tarif dan tanggal untuk melihat total.'}
function renderBookings(){
  const active=bookings.filter(b=>!['refunded','cancelled','settled'].includes(b.status));
  $('received').textContent=bookings.length;
  $('pending').textContent=active.filter(b=>['payment_verified','checking_hotel','alternative_offered'].includes(b.status)).length;
  $('due').textContent=active.filter(b=>b.status==='checked_out').length;
  const today=localNow().slice(0,10);
  $('overdue').textContent=active.filter(b=>b.status==='checked_out'&&dueDate(b)<today).length;
  $('bookingRows').innerHTML=bookings.map(b=>{
    const actions=(next[b.status]||[]).filter(s=>{
      if(s==='checked_out'&&today<b.check_out)return false;
      if(s==='settled'&&(today<offsetDate(b.check_out,2)||!['owner','admin','finance'].includes(role)))return false;
      return s==='settled'||role!=='finance';
    }).map(s=>`<button class="quiet statusAction" data-id="${b.id}" data-next="${s}">${esc(labels[s])}</button>`).join('');
    return `<tr><td>#${b.id}<br><strong>${esc(b.guest_name)}</strong><br>${esc(b.guest_contact)}</td><td>${esc(nameOf(b.property_id))}</td><td>${prettyDate(b.check_in)}–${prettyDate(b.check_out)}<br>${b.rooms} kamar · ${b.nights} malam</td><td>${rupiah(b.guest_total)}</td><td>${rupiah(b.hotel_total)}</td><td>${rupiah(b.markup*b.rooms*b.nights)}</td><td>${esc(labels[b.status]||b.status)}</td><td>${b.status==='checked_out'?prettyDate(dueDate(b)):'—'}</td><td>${actions||'—'}</td></tr>`;
  }).join('')||'<tr><td colspan="9">Belum ada reservasi.</td></tr>';
  document.querySelectorAll('.statusAction').forEach(button=>button.onclick=()=>advance(Number(button.dataset.id),button.dataset.next));
}
async function advance(id,status){
  const b=bookings.find(x=>x.id===id);if(!b||!(next[b.status]||[]).includes(status))return;
  const update={status};
  if(status==='confirmed'){
    if(!confirm(`Hotel sudah mengonfirmasi pesanan #${id}?`))return;
    update.hotel_confirmed_at=new Date().toISOString();
  }else if(status==='settled'){
    const ref=prompt(`Masukkan referensi bukti pembayaran NET hotel ${rupiah(b.hotel_total)} untuk pesanan #${id}:`);
    if(!ref?.trim())return;
    update.hotel_payment_reference=ref.trim();update.hotel_paid_at=new Date().toISOString();
  }else if(status==='refunded'){
    if(!confirm(`Dana tamu untuk pesanan #${id} sudah dikembalikan?`))return;
    update.refund_at=new Date().toISOString();
  }else if(!confirm(`Ubah pesanan #${id} menjadi “${labels[status]}”?`))return;
  const result=await db.from('baleva_reservations').update(update).eq('id',id).eq('status',b.status).select('id');
  $('actionMessage').textContent=result.error?errorMessage(result.error):result.data?.length?'Status berhasil diperbarui.':'Status berubah oleh staf lain. Segarkan data.';
  await load();
}
$('rateForm').onsubmit=async event=>{
  event.preventDefault();let net=Number($('netRate').value),markup=Number($('markup').value);
  if(!Number.isInteger(net)||net<=0||!Number.isInteger(markup)||markup<50000||markup>150000){$('rateMessage').textContent='Periksa nilai NET RATE dan markup.';return;}
  const payload={property_id:Number($('rateProperty').value),room_type:$('roomType').value.trim(),net_rate:net,markup,verified_at:$('verified').checked?new Date().toISOString():null,updated_at:new Date().toISOString()};
  const result=await db.from('baleva_room_rates').upsert(payload,{onConflict:'property_id,room_type'});
  $('rateMessage').textContent=result.error?errorMessage(result.error):'Tarif disimpan.';
  if(!result.error)await load();
};
$('bookingForm').onsubmit=async event=>{
  event.preventDefault();let r=rates.find(x=>x.id===Number($('bookingRate').value)),n=days($('checkIn').value,$('checkOut').value),rooms=Number($('rooms').value);
  if(!r?.verified_at||n<1||n>90||!Number.isInteger(rooms)||rooms<1||rooms>50){$('bookingMessage').textContent='Tarif terverifikasi, tanggal, atau jumlah kamar tidak valid.';return;}
  if(!confirm(`Pastikan dana tamu ${rupiah((r.net_rate+r.markup)*n*rooms)} telah diterima dan bukti pembayaran cocok. Catat pesanan?`))return;
  const payload={property_id:r.property_id,room_rate_id:r.id,guest_name:$('guestName').value.trim(),guest_contact:$('guestContact').value.trim(),check_in:$('checkIn').value,check_out:$('checkOut').value,rooms,net_rate:r.net_rate,markup:r.markup,guest_paid_at:new Date($('guestPaidAt').value).toISOString(),guest_payment_reference:$('guestReference').value.trim(),notes:$('notes').value.trim(),created_by:user.id};
  const result=await db.from('baleva_reservations').insert(payload);
  $('bookingMessage').textContent=result.error?errorMessage(result.error):'Pesanan tersimpan. Lanjutkan pengecekan ketersediaan hotel.';
  if(!result.error){$('bookingForm').reset();$('guestPaidAt').value=localNow();await load();}
};
$('export').onclick=()=>{
  const headings=['ID','Akomodasi','Tamu','Kontak','Check-in','Check-out','Kamar','Malam','Total tamu','NET hotel','Komisi','Status','Jatuh tempo','Referensi tamu','Referensi hotel'];
  const cell=x=>`"${String(x??'').replace(/^[\s]*[=+@-]/,"'$&").replace(/"/g,'""')}"`;
  const rows=bookings.map(b=>[b.id,nameOf(b.property_id),b.guest_name,b.guest_contact,b.check_in,b.check_out,b.rooms,b.nights,b.guest_total,b.hotel_total,b.markup*b.rooms*b.nights,b.status,dueDate(b),b.guest_payment_reference,b.hotel_payment_reference]);
  const blob=new Blob(['\ufeff'+[headings,...rows].map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='baleva-reservasi.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('logout').onclick=async()=>{if(db)await db.auth.signOut();location.href='login.html'};
$('reload').onclick=load;
['netRate','markup'].forEach(id=>$(id).addEventListener('input',previewRate));
['bookingRate','checkIn','checkOut','rooms'].forEach(id=>$(id).addEventListener('input',previewBooking));
start().catch(e=>block(errorMessage(e)));
