# BALEVA

Katalog akomodasi Lombok dengan halaman detail, peta, dan panel staf. Katalog yang sudah ada tetap memakai tabel `properties` di Supabase. Beranda dan halaman detail masih menerima **permintaan informasi lewat WhatsApp**, bukan pembayaran otomatis.

## Mengaktifkan panel reservasi

1. Cadangkan basis data Supabase, lalu jalankan [`supabase/20260929_booking_foundation.sql`](supabase/20260929_booking_foundation.sql) dalam SQL Editor proyek yang sama dengan `config.js`. Migrasi menambahkan tabel baru, kebijakan akses staf, perhitungan tarif, serta catatan perubahan status; tidak menghapus data lama.
2. Pastikan akun Aldi sudah ada di Supabase Authentication. Ganti `YOUR_EMAIL_HERE` pada contoh `insert` di bagian bawah migrasi dengan email akun tersebut dan jalankan perintahnya di SQL Editor. Tambahkan staf lain dengan peran `owner`, `admin`, `reservations`, atau `finance` sesuai kebutuhan. Peran `partner` disiapkan tetapi belum memiliki panel atau akses data pemesanan.
3. Audit kebijakan RLS tabel lama `properties`, `booking_requests`, dan bucket foto sebelum mengundang staf tambahan. Pemeriksaan peran di halaman web bukan pengganti RLS database.
4. Masuk melalui `login.html`. Pemilik dan admin dapat mengelola akomodasi di `admin.html`, lalu membuka `operations.html`. Staf reservasi dan keuangan langsung diarahkan ke panel operasional sesuai perannya.
5. Migrasi membuat **draf NET RATE Rp500.000** dan markup Rp50.000 untuk `Kamar Standar` pada setiap akomodasi yang sudah tersimpan. Edit nama tipe kamar, NET RATE, dan markup sesuai perjanjian hotel; centang verifikasi hanya setelah harga serta fasilitas dikonfirmasi mitra. Draf tidak dapat dipakai untuk mencatat pesanan.

## Alur manual sebelum pembayaran daring tersedia

- Tamu menghubungi BALEVA melalui katalog. Staf memberikan rincian harga dan instruksi pembayaran melalui kanal resmi yang ditetapkan pemilik BALEVA. Jangan mengirim instruksi rekening yang belum disetujui.
- Setelah dana tamu **benar-benar diterima**, staf memasukkan referensi pembayaran dan mencatat pesanan di `operations.html`. Harga tamu = (NET RATE + markup) × kamar × malam. NET RATE hotel tetap utuh.
- Staf menghubungi hotel, lalu mencatat status konfirmasi. Bila kamar tidak tersedia, tawarkan alternatif atau proses pengembalian dana dan catat statusnya. Panel tidak mengirim refund otomatis.
- Setelah checkout, staf keuangan mencatat bukti pelunasan NET RATE hotel mulai hari ke-2 dan paling lambat hari ke-7. Panel menandai tagihan yang melewati hari ke-7; keterlambatan tidak disembunyikan.

## Yang dibutuhkan sebelum transaksi tamu otomatis

- Penyedia pembayaran dan akun usaha resmi, webhook pembayaran yang diverifikasi di server, rekening tujuan, serta prosedur refund.
- Persetujuan harga NET RATE per tipe kamar dan aturan pajak/biaya bila berlaku.
- Dokumen syarat pemesanan dan privasi yang disetujui pengelola.
- Data stok kamar atau mekanisme konfirmasi hotel yang mempunyai SLA. Pencarian tanggal di katalog saat ini belum memeriksa stok langsung.

**Jangan menyimpan service role key, sandi, atau kredensial pembayaran dalam `config.js` maupun repositori publik.** Migrasi harus dijalankan sebelum menerbitkan perubahan login/admin ini; tanpa tabel `baleva_staff`, akses admin akan tertutup.
