
const properties = window.BALEVA_PROPERTIES || [];
let region = "all";
let selectedProperty = properties[0] || null;
let map, markersLayer;

const grid = document.getElementById("propertyGrid");
const resultCount = document.getElementById("resultCount");
const searchInput = document.getElementById("searchInput");
const typeFilter = document.getElementById("typeFilter");
const expFilter = document.getElementById("expFilter");

function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}

function card(p){
  return `<article class="card">
    <div class="card-media"><span class="badge">${esc(p.type)}</span><button class="fav" title="Simpan">♡</button></div>
    <div class="card-body">
      <h3>${esc(p.name)}</h3>
      <div class="meta">${esc(p.area)} • ${esc(p.region)}</div>
      <div class="exps">${p.exp.slice(0,2).map(x=>`<span class="exp">${esc(x)}</span>`).join("")}</div>
      <div class="near">📍 Dekat ${esc(p.near)}</div>
      <div class="card-actions">
        <a class="btn btn-outline" href="property.html?id=${p.id}">Lihat Detail</a>
        <button class="btn btn-primary availability" data-id="${p.id}">Cek Tersedia</button>
      </div>
    </div>
  </article>`
}

function filtered(){
  const q = searchInput.value.trim().toLowerCase();
  return properties.filter(p => {
    const text = [p.name,p.type,p.region,p.area,p.near,...p.exp].join(" ").toLowerCase();
    return (region==="all" || p.region===region)
      && (typeFilter.value==="all" || p.type===typeFilter.value)
      && (expFilter.value==="all" || p.exp.includes(expFilter.value))
      && (!q || text.includes(q));
  });
}
function render(){
  const data = filtered();
  grid.innerHTML = data.length ? data.map(card).join("") : `<div class="empty" style="grid-column:1/-1">Tidak ada property demo yang cocok dengan filter ini.</div>`;
  resultCount.textContent = `${data.length} property demo`;
  document.querySelectorAll(".availability").forEach(b=>b.addEventListener("click",()=>openAvailability(Number(b.dataset.id))));
  refreshMarkers(data);
}
document.querySelectorAll("#regionChips .chip").forEach(chip => {
  chip.addEventListener("click",()=>{
    document.querySelectorAll("#regionChips .chip").forEach(x=>x.classList.remove("active"));
    chip.classList.add("active");
    region=chip.dataset.region; render();
  });
});
document.getElementById("searchButton").addEventListener("click",render);
searchInput.addEventListener("keydown",e=>{if(e.key==="Enter")render()});
typeFilter.addEventListener("change",render);
expFilter.addEventListener("change",render);

const mapWrap = document.getElementById("peta");
document.getElementById("toggleMap").addEventListener("click",()=>{
  mapWrap.classList.toggle("show");
  const showing=mapWrap.classList.contains("show");
  document.getElementById("toggleMap").textContent=showing?"✕ Tutup Peta":"🗺 Lihat Peta";
  if(showing){
    initMap(); setTimeout(()=>map.invalidateSize(),100);
    mapWrap.scrollIntoView({behavior:"smooth",block:"center"});
  }
});

function initMap(){
  if(map) return;
  map=L.map("map").setView([-8.650979,116.324944],9);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
    maxZoom:18,attribution:'&copy; OpenStreetMap contributors'
  }).addTo(map);
  markersLayer=L.layerGroup().addTo(map);
  refreshMarkers(filtered());
}
function refreshMarkers(data){
  if(!markersLayer) return;
  markersLayer.clearLayers();
  data.forEach(p=>{
    const m=L.marker([p.lat,p.lng]).addTo(markersLayer);
    m.bindPopup(`<strong>${esc(p.name)}</strong><br>${esc(p.area)}<br><small>Marker demo — ganti koordinat real dari database.</small>`);
  });
}

const modal=document.getElementById("availabilityModal");
const modalName=document.getElementById("modalPropertyName");
function openAvailability(id){
  selectedProperty=properties.find(x=>x.id===id) || properties[0];
  modalName.textContent=selectedProperty?`${selectedProperty.name} • ${selectedProperty.area}`:"Permintaan umum BALEVA";
  modal.classList.add("show"); updateSummary();
}
document.getElementById("headerAvailability").addEventListener("click",()=>openAvailability(properties[0]?.id));
document.getElementById("closeModal").addEventListener("click",()=>modal.classList.remove("show"));
modal.addEventListener("click",e=>{if(e.target===modal)modal.classList.remove("show")});

["checkin","checkout","adults","children","rooms","concept","note"].forEach(id=>document.getElementById(id).addEventListener("input",updateSummary));
document.querySelectorAll("#extras input").forEach(x=>x.addEventListener("change",updateSummary));

function nights(){
  const a=document.getElementById("checkin").value,b=document.getElementById("checkout").value;
  if(!a||!b)return 0;
  const n=Math.round((new Date(b)-new Date(a))/86400000); return n>0?n:0;
}
function extras(){
  return [...document.querySelectorAll("#extras input:checked")].map(x=>x.value);
}
function requestCode(){
  const d=new Date(); const y=String(d.getFullYear()).slice(-2),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");
  return `LMB-${y}${m}${day}-DEMO`;
}
function payload(agent){
  const p=selectedProperty || {name:"Permintaan Umum BALEVA",area:"Lombok",region:""};
  const ci=document.getElementById("checkin").value||"-",co=document.getElementById("checkout").value||"-";
  const ex=extras();
  return `Halo Kak ${agent},

Saya ingin mengecek ketersediaan melalui BALEVA.

Kode Permintaan: ${requestCode()}

🏡 Properti:
${p.name}

📍 Lokasi:
${p.area}${p.region ? ", "+p.region : ""}

📅 Check-in:
${ci}

📅 Check-out:
${co}

🌙 Durasi:
${nights()} malam

👥 Tamu:
${document.getElementById("adults").value} Dewasa
${document.getElementById("children").value} Anak

🛏 Kamar:
${document.getElementById("rooms").value} kamar

🌿 Konsep Menginap:
${document.getElementById("concept").value}

✨ Kebutuhan Tambahan:
${ex.length?ex.join(", "):"Tidak ada"}

📝 Catatan:
${document.getElementById("note").value || "-"}

Mohon dibantu pengecekan ketersediaan, harga, dan detail pemesanannya. Terima kasih.`;
}
function updateSummary(){
  const p=selectedProperty || {name:"Permintaan Umum"};
  document.getElementById("summary").textContent =
`${p.name}
${document.getElementById("checkin").value||"-"} → ${document.getElementById("checkout").value||"-"} • ${nights()} malam
${document.getElementById("adults").value} dewasa • ${document.getElementById("children").value} anak • ${document.getElementById("rooms").value} kamar
Konsep: ${document.getElementById("concept").value}
Tambahan: ${extras().join(", ")||"-"}`;
}
document.querySelectorAll("[data-agent]").forEach(b=>{
  b.addEventListener("click",()=>{
    if(!document.getElementById("checkin").value || !document.getElementById("checkout").value || nights()<=0){
      alert("Isi check-in dan check-out yang valid terlebih dahulu."); return;
    }
    const url=`https://wa.me/${b.dataset.number}?text=${encodeURIComponent(payload(b.dataset.agent))}`;
    window.open(url,"_blank","noopener");
  });
});
render();
