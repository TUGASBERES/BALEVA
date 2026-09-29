const cfg=window.BALEVA_CONFIG||{};
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rupiah=x=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(x||0);
const prettyDate=x=>x?new Date(`${x}T12:00:00`).toLocaleDateString('id-ID'):'—';
const roles=['owner','admin','reservations','finance'];
const labels={confirmed:'Dikonfirmasi',cancel_requested:'Pembatalan diajukan',refund_pending:'Proses refund',refunded:'Refund selesai',checked_out:'Checkout',settled:'Hotel lunas'};
const inquiryLabels={requested:'Permintaan masuk',checking_partner:'Cek ke mitra',available:'Tersedia menurut mitra',unavailable:'Tidak tersedia',offered:'Pelanggan dihubungi',declined:'Tidak jadi',locked:'Kamar di-lock',expired:'Lock kedaluwarsa',converted:'Sudah dipesan'};
const inquiryNext={requested:['checking_partner'],checking_partner:['available','unavailable'],available:['offered'],offered:['locked','declined'],locked:['expired']};
const next={confirmed:['checked_out'],cancel_requested:[],checked_out:['settled'],refund_pending:['refunded']};
let db,user,role,properties=[],rates=[],inquiries=[],bookings=[],cancellations=[];
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
  if(role==='finance'){$('createPanel').hidden=true;$('inquiryForm').hidden=true;}
  $('guestPaidAt').value=localNow();$('app').hidden=false;await load();
}
async function load(){
  const [pr,ra,iq,bo,ca]=await Promise.all([
    db.from('properties').select('id,name').order('name'),
    db.from('baleva_room_rates').select('*').order('updated_at',{ascending:false}),
    db.from('baleva_inquiries').select('*').order('created_at',{ascending:false}),
    db.from('baleva_reservations').select('*').order('created_at',{ascending:false}),
    db.from('baleva_cancellation_requests').select('*').order('requested_at',{ascending:false})
  ]);
  const failed=[pr,ra,iq,bo,ca].find(x=>x.error);if(failed){$('actionMessage').textContent=`Gagal memuat data: ${errorMessage(failed.error)}`;return;}
  properties=pr.data||[];rates=ra.data||[];inquiries=iq.data||[];bookings=bo.data||[];cancellations=ca.data||[];
  $('rateProperty').innerHTML=properties.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('inquiryRate').innerHTML='<option value="">Pilih kamar</option>'+rates.filter(r=>r.active).map(r=>`<option value="${r.id}">${esc(nameOf(r.property_id))} · ${esc(r.room_type)} ${r.verified_at?'':'(tarif belum diverifikasi)'}</option>`).join('');
  $('bookingInquiry').innerHTML='<option value="">Pilih lock aktif</option>'+inquiries.filter(i=>i.status==='locked'&&Date.parse(i.lock_expires_at)>Date.now()).map(i=>`<option value="${i.id}">#${i.id} · ${esc(i.guest_name)} · ${esc(nameOf(i.property_id))} · sampai ${new Date(i.lock_expires_at).toLocaleString('id-ID')}</option>`).join('');
  $('rateRows').innerHTML=rates.map(r=>`<tr><td>${esc(nameOf(r.property_id))}</td><td>${esc(r.room_type)}</td><td>${rupiah(r.net_rate)}</td><td>${rupiah(r.markup)}</td><td>${rupiah(r.net_rate+r.markup)}</td><td>${(r.markup/r.net_rate*100).toFixed(1)}%</td><td>${r.verified_at?'Terverifikasi':'Belum diverifikasi'} ${['owner','admin'].includes(role)?`<button class="quiet editRate" data-id="${r.id}">Edit</button>`:''}</td></tr>`).join('')||'<tr><td colspan="7">Tarif belum diisi.</td></tr>';
  document.querySelectorAll('.editRate').forEach(button=>button.onclick=()=>{
    const r=rates.find(item=>item.id===Number(button.dataset.id));if(!r)return;
    $('rateProperty').value=r.property_id;$('roomType').value=r.room_type;
    $('netRate').value=r.net_rate;$('markup').value=r.markup;$('verified').checked=!!r.verified_at;
    previewRate();$('ratesPanel').scrollIntoView({behavior:'smooth'});
  });
  renderInquiries();renderBookings();renderCancellations();previewBooking();
}
function nameOf(id){return properties.find(p=>p.id===id)?.name||`ID ${id}`}
function days(a,b){if(!a||!b)return 0;return Math.round((Date.parse(`${b}T00:00:00Z`)-Date.parse(`${a}T00:00:00Z`))/86400000)}
function dueDate(booking){const d=new Date(`${booking.check_out}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+7);return d.toISOString().slice(0,10)}
function offsetDate(date,days){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
function previewRate(){let net=Number($('netRate').value),markup=Number($('markup').value);$('ratePreview').textContent=net>0&&markup>=50000&&markup<=150000?`Tamu: ${rupiah(net+markup)} / malam · Komisi: ${(markup/net*100).toFixed(1)}% dari NET`:''}
function activeLock(i){return i?.status==='locked'&&Date.parse(i.lock_expires_at)>Date.now()}
function previewBooking(){const i=inquiries.find(x=>x.id===Number($('bookingInquiry').value)),r=rates.find(x=>x.id===i?.room_rate_id),n=i?days(i.check_in,i.check_out):0;$('bookingPreview').textContent=activeLock(i)&&r?.verified_at&&n>0?`${i.guest_name} · ${n} malam × ${i.rooms} kamar · Tamu membayar ${rupiah((r.net_rate+r.markup)*n*i.rooms)} · NET hotel ${rupiah(r.net_rate*n*i.rooms)} · Komisi ${rupiah(r.markup*n*i.rooms)}`:'Pilih lock aktif dengan tarif terverifikasi untuk melihat total.'}
function renderInquiries(){
  const now=Date.now(),today=localNow().slice(0,10);
  $('pending').textContent=inquiries.filter(i=>['requested','checking_partner'].includes(i.status)).length;
  $('locks').textContent=inquiries.filter(activeLock).length;
  $('inquiryRows').innerHTML=inquiries.map(i=>{
    const isExpired=i.status==='locked'&&Date.parse(i.lock_expires_at)<=now;
    const actions=role==='finance'?[]:(inquiryNext[i.status]||[]).filter(s=>
      s!=='expired'||isExpired).filter(s=>s!=='locked'||(i.check_in>=today&&i.check_in<=offsetDate(today,30)))
      .map(s=>`<button class="quiet inquiryAction" data-id="${i.id}" data-next="${s}">${esc(inquiryLabels[s])}</button>`);
    return `<tr><td>#${i.id}<br>${esc(i.guest_name)}<br>${esc(i.guest_contact)}</td><td>${esc(nameOf(i.property_id))} · ${esc(rates.find(r=>r.id===i.room_rate_id)?.room_type||'')}</td><td>${prettyDate(i.check_in)}–${prettyDate(i.check_out)}<br>${i.rooms} kamar</td><td>${esc(isExpired?'Lock habis':inquiryLabels[i.status])}</td><td>${i.lock_expires_at?new Date(i.lock_expires_at).toLocaleString('id-ID'):'—'}</td><td>${actions.join('')||'—'}</td></tr>`;
  }).join('')||'<tr><td colspan="6">Belum ada permintaan.</td></tr>';
  document.querySelectorAll('.inquiryAction').forEach(button=>button.onclick=()=>advanceInquiry(Number(button.dataset.id),button.dataset.next));
}
async function advanceInquiry(id,status){
  const i=inquiries.find(x=>x.id===id);if(!i||!(inquiryNext[i.status]||[]).includes(status))return;
  const update={status};
  if(status==='locked'){
    const hours=Number(prompt('Berapa jam mitra menahan kamar? Isi 2 atau 6:', '2'));
    if(![2,6].includes(hours)){if(!Number.isNaN(hours))$('inquiryMessage').textContent='Pilih 2 atau 6 jam.';return;}
    update.lock_hours=hours;
  }else if(!confirm(`Ubah permintaan #${id} menjadi “${inquiryLabels[status]}”? Pastikan informasi mitra/pelanggan sudah benar.`))return;
  const result=await db.from('baleva_inquiries').update(update).eq('id',id).eq('status',i.status).select('id');
  $('inquiryMessage').textContent=result.error?errorMessage(result.error):result.data?.length?'Status permintaan diperbarui.':'Status sudah berubah; segarkan data.';
  await load();
}
function renderBookings(){
  const active=bookings.filter(b=>!['refunded','settled'].includes(b.status));
  $('due').textContent=active.filter(b=>b.status==='checked_out').length;
  const today=localNow().slice(0,10);
  $('overdue').textContent=active.filter(b=>b.status==='checked_out'&&dueDate(b)<today).length;
  $('bookingRows').innerHTML=bookings.map(b=>{
    const actions=(next[b.status]||[]).filter(s=>{
      if(s==='checked_out'&&today<b.check_out)return false;
      if(s==='settled'&&(today<offsetDate(b.check_out,2)||!['owner','admin','finance'].includes(role)))return false;
      return s==='settled'||role!=='finance';
    }).map(s=>`<button class="quiet statusAction" data-id="${b.id}" data-next="${s}">${esc(labels[s])}</button>`).join('');
    const requestButton=b.status==='confirmed'&&role!=='finance'?`<button class="quiet cancelAction" data-id="${b.id}">Catat pengajuan pembatalan</button>`:'';
    return `<tr><td>#${b.id}<br><strong>${esc(b.guest_name)}</strong><br>${esc(b.guest_contact)}</td><td>${esc(nameOf(b.property_id))}</td><td>${prettyDate(b.check_in)}–${prettyDate(b.check_out)}<br>${b.rooms} kamar · ${b.nights} malam</td><td>${rupiah(b.guest_total)}</td><td>${rupiah(b.hotel_total)}</td><td>${rupiah(b.markup*b.rooms*b.nights)}</td><td>${esc(labels[b.status]||b.status)}</td><td>${b.status==='checked_out'?prettyDate(dueDate(b)):'—'}</td><td>${actions}${requestButton||''}</td></tr>`;
  }).join('')||'<tr><td colspan="9">Belum ada reservasi.</td></tr>';
  document.querySelectorAll('.statusAction').forEach(button=>button.onclick=()=>advance(Number(button.dataset.id),button.dataset.next));
  document.querySelectorAll('.cancelAction').forEach(button=>button.onclick=()=>requestCancellation(Number(button.dataset.id)));
}
async function advance(id,status){
  const b=bookings.find(x=>x.id===id);if(!b||!(next[b.status]||[]).includes(status))return;
  const update={status};
  if(status==='settled'){
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
async function requestCancellation(id){
  const reason=prompt(`Tuliskan alasan pengajuan pembatalan pelanggan untuk pesanan #${id}:`);
  if(!reason?.trim())return;
  const result=await db.from('baleva_cancellation_requests').insert({reservation_id:id,reason:reason.trim(),created_by:user.id});
  if(result.error){$('cancellationMessage').textContent=errorMessage(result.error);return;}
  const moved=await db.from('baleva_reservations').update({status:'cancel_requested'}).eq('id',id).eq('status','confirmed');
  $('cancellationMessage').textContent=moved.error?`Pengajuan tercatat, tetapi penandaan pesanan gagal: ${errorMessage(moved.error)}`:'Pengajuan tercatat. Reservasi tetap berlaku sambil menunggu keputusan.';
  await load();
}
function renderCancellations(){
  $('cancellationRows').innerHTML=cancellations.map(c=>`<tr><td>#${c.reservation_id}</td><td>${esc(c.reason)}</td><td>${esc(c.status)}</td><td>${c.status==='pending'&&['owner','admin'].includes(role)?`<button class="quiet cancellationDecision" data-id="${c.id}" data-decision="approved">Setujui proses</button><button class="quiet cancellationDecision" data-id="${c.id}" data-decision="rejected">Tolak</button>`:esc(c.decision_note||'—')}</td></tr>`).join('')||'<tr><td colspan="4">Belum ada pengajuan pembatalan.</td></tr>';
  document.querySelectorAll('.cancellationDecision').forEach(button=>button.onclick=()=>decideCancellation(Number(button.dataset.id),button.dataset.decision));
}
async function decideCancellation(id,status){
  const c=cancellations.find(x=>x.id===id);if(!c||c.status!=='pending')return;
  const note=prompt(`Alasan keputusan ${status==='approved'?'setuju proses pembatalan':'tolak pembatalan'} untuk pesanan #${c.reservation_id}:`);
  if(!note?.trim())return;
  const result=await db.from('baleva_cancellation_requests').update({status,decision_note:note.trim(),decided_at:new Date().toISOString()}).eq('id',id).eq('status','pending').select('id');
  if(result.error||!result.data?.length){$('cancellationMessage').textContent=errorMessage(result.error)||'Keputusan telah berubah.';return;}
  const moved=await db.from('baleva_reservations').update({status:status==='approved'?'refund_pending':'confirmed'}).eq('id',c.reservation_id).eq('status','cancel_requested');
  $('cancellationMessage').textContent=moved.error?`Keputusan tersimpan, status pesanan perlu diperiksa: ${errorMessage(moved.error)}`:'Keputusan tersimpan. Refund, bila disetujui, diproses manual.';
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
$('inquiryForm').onsubmit=async event=>{
  event.preventDefault();const r=rates.find(x=>x.id===Number($('inquiryRate').value)),n=days($('inquiryCheckIn').value,$('inquiryCheckOut').value),rooms=Number($('inquiryRooms').value);
  if(!r||n<1||n>90||!Number.isInteger(rooms)||rooms<1||rooms>50){$('inquiryMessage').textContent='Pilih kamar, tanggal, dan jumlah kamar yang valid.';return;}
  const payload={property_id:r.property_id,room_rate_id:r.id,guest_name:$('inquiryName').value.trim(),guest_contact:$('inquiryContact').value.trim(),check_in:$('inquiryCheckIn').value,check_out:$('inquiryCheckOut').value,rooms,notes:$('inquiryNotes').value.trim(),created_by:user.id};
  const result=await db.from('baleva_inquiries').insert(payload);
  $('inquiryMessage').textContent=result.error?errorMessage(result.error):'Permintaan masuk. Hubungi mitra untuk memeriksa stok sebelum menawarkan kepada pelanggan.';
  if(!result.error){$('inquiryForm').reset();await load();}
};
$('bookingForm').onsubmit=async event=>{
  event.preventDefault();const i=inquiries.find(x=>x.id===Number($('bookingInquiry').value)),r=rates.find(x=>x.id===i?.room_rate_id),n=i?days(i.check_in,i.check_out):0;
  if(!activeLock(i)||!r?.verified_at||n<1){$('bookingMessage').textContent='Lock masih berlaku dan tarif terverifikasi wajib tersedia. Jika kedaluwarsa, cek ulang ke mitra.';return;}
  if(!confirm(`Pastikan dana tamu ${rupiah((r.net_rate+r.markup)*n*i.rooms)} telah diterima dalam masa lock dan bukti pembayaran cocok. Konfirmasikan pesanan?`))return;
  const payload={inquiry_id:i.id,property_id:i.property_id,room_rate_id:r.id,guest_name:i.guest_name,guest_contact:i.guest_contact,check_in:i.check_in,check_out:i.check_out,rooms:i.rooms,net_rate:r.net_rate,markup:r.markup,guest_paid_at:new Date($('guestPaidAt').value).toISOString(),guest_payment_reference:$('guestReference').value.trim(),notes:$('notes').value.trim(),created_by:user.id};
  const result=await db.from('baleva_reservations').insert(payload);
  $('bookingMessage').textContent=result.error?errorMessage(result.error):'Pembayaran tercatat dan reservasi dikonfirmasi.';
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
$('bookingInquiry').addEventListener('change',previewBooking);
start().catch(e=>block(errorMessage(e)));
