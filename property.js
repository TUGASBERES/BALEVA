const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const photos=p=>[p.image_url,...(Array.isArray(p.image_urls)?p.image_urls:[]),...(Array.isArray(p.uploaded_image_urls)?p.uploaded_image_urls:[])].filter(url=>typeof url==='string'&&/^https:\/\//i.test(url)).filter((url,i,a)=>a.indexOf(url)===i);
const id=new URLSearchParams(location.search).get('id');

function fail(message){$('content').innerHTML=`<div class="error"><h1>Penginapan tidak ditemukan</h1><p>${esc(message)}</p><a class="btn" href="index.html#property">Kembali ke katalog</a></div>`;}
function nights(){const a=$('checkin').value,b=$('checkout').value;if(!a||!b)return 0;return Math.round((new Date(b)-new Date(a))/86400000);}
function message(p,agent){return `Halo Kak ${agent}, saya ingin mengecek ketersediaan melalui BALEVA.\n\nPenginapan: ${p.name}\nLokasi: ${p.area||p.address||''}, ${p.region||''}\nCheck-in: ${$('checkin').value}\nCheck-out: ${$('checkout').value}\nJumlah kamar: ${$('rooms').value}\nDewasa: ${$('adults').value}\nAnak: ${$('children').value}\nCatatan: ${$('note').value||'-'}\n\nMohon informasi ketersediaan dan harga. Terima kasih.`;}

function render(p){
  const name=p.name||'Penginapan',area=p.area||p.address||'',region=p.region||'',type=p.property_type||p.type||'Penginapan';
  document.title=`${name} di ${area||region||'Lombok'} — BALEVA`;
  $('description').content=`Lihat foto, lokasi, fasilitas dan cek ketersediaan ${name} di ${area||region||'Lombok'} melalui BALEVA.`;
  $('canonical').href=new URL(`property.html?id=${encodeURIComponent(id)}`,location.href).href;
  $('robots').content='index,follow';
  const images=photos(p),rawCoords=[p.latitude??p.lat,p.longitude??p.lng],coords=rawCoords.map(Number);
  const hasCoords=rawCoords.every(x=>x!==null&&x!==undefined&&x!=='')&&Number.isFinite(coords[0])&&Number.isFinite(coords[1])&&Math.abs(coords[0])<=90&&Math.abs(coords[1])<=180;
  const tags=[...(Array.isArray(p.experiences)?p.experiences:[]),...(Array.isArray(p.extra_facilities)?p.extra_facilities:[])].filter(Boolean);
  $('content').innerHTML=`<h1>${esc(name)}</h1><p class="muted">${esc(type)} • ${esc([area,region].filter(Boolean).join(' • '))}</p>
    <div class="gallery"><div>${images[0]?`<img src="${esc(images[0])}" alt="${esc(name)} - foto utama">`:'<div class="empty">Foto belum tersedia</div>'}</div><div class="gallery-side">${[1,2].map(i=>images[i]?`<img src="${esc(images[i])}" alt="${esc(name)} - foto ${i+1}" loading="lazy">`:'<div class="empty">Foto belum tersedia</div>').join('')}</div></div>
    <div class="content"><div><section class="panel"><h2>Tentang penginapan</h2><p>${esc(p.description||p.desc||'Deskripsi penginapan belum tersedia.')}</p></section>
    <section class="panel"><h2>Fasilitas dan pengalaman</h2>${tags.length?`<div class="tags">${tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>`:'<p class="muted">Informasi fasilitas belum tersedia.</p>'}</section>
    <section class="panel"><h2>Lokasi</h2><p class="muted">${esc([area,region].filter(Boolean).join(', '))}</p>${hasCoords?'<div id="map" role="img" aria-label="Peta lokasi penginapan"></div>':'<p>Koordinat lokasi belum tersedia.</p>'}</section></div>
    <aside><section class="panel"><h2>Cek ketersediaan</h2><p class="notice">Ketersediaan dan harga dikonfirmasi oleh tim BALEVA. Permintaan ini belum merupakan reservasi yang dikonfirmasi.</p>
    <div class="field"><label for="checkin">Check-in</label><input type="date" id="checkin"></div><div class="field"><label for="checkout">Check-out</label><input type="date" id="checkout"></div>
    <div class="field"><label for="rooms">Jumlah kamar</label><input type="number" id="rooms" min="1" value="1"></div><div class="field"><label for="adults">Dewasa</label><input type="number" id="adults" min="1" value="2"></div><div class="field"><label for="children">Anak</label><input type="number" id="children" min="0" value="0"></div>
    <div class="field"><label for="note">Catatan</label><textarea id="note" rows="3"></textarea></div><div class="contacts"><button class="btn" data-agent="Aldi" data-number="6287781998529">Hubungi Aldi</button><button class="btn" data-agent="Hendra" data-number="6287740137252">Hubungi Hendra</button></div></section></aside></div>`;
  if(hasCoords){const map=L.map('map').setView(coords,13);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);L.marker(coords).addTo(map).bindPopup(esc(name));}
  document.querySelectorAll('[data-agent]').forEach(button=>button.addEventListener('click',()=>{if(nights()<=0||Number($('rooms').value)<1||Number($('adults').value)<1||Number($('children').value)<0){alert('Isi tanggal dan jumlah tamu yang valid.');return;}window.open(`https://wa.me/${button.dataset.number}?text=${encodeURIComponent(message(p,button.dataset.agent))}`,'_blank','noopener');}));
}

(async()=>{
  if(!id||!/^[0-9]+$/.test(id)){fail('Alamat properti tidak valid.');return;}
  const config=window.BALEVA_CONFIG||{};
  if(!config.SUPABASE_URL||!config.SUPABASE_PUBLISHABLE_KEY){fail('Layanan katalog belum tersedia.');return;}
  try{
    const db=supabase.createClient(config.SUPABASE_URL,config.SUPABASE_PUBLISHABLE_KEY);
    const {data,error}=await db.from('properties').select('*').eq('id',Number(id)).eq('status','published').maybeSingle();
    if(error||!data){fail('Properti ini belum tersedia untuk ditampilkan.');return;}
    render(data);
  }catch(error){console.error('Gagal memuat detail properti:',error);fail('Detail properti tidak dapat dimuat saat ini.');}
})();
