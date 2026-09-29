# BALEVA

Katalog akomodasi Lombok dengan halaman detail, peta, dan panel staf. Katalog yang sudah ada tetap memakai tabel `properties` di Supabase. Beranda dan halaman detail masih menerima **permintaan informasi lewat WhatsApp**, bukan pembayaran otomatis.

## Mengaktifkan panel reservasi

1. Cadangkan basis data Supabase, lalu jalankan [`supabase/20260929_booking_foundation.sql`](supabase/20260929_booking_foundation.sql) **dan segera setelahnya** [`supabase/20260929_prebooking_lock.sql`](supabase/20260929_prebooking_lock.sql) dalam SQL Editor proyek yang sama dengan `config.js`. Jangan menerbitkan panel di antara kedua langkah. Migrasi menambahkan tabel baru tanpa menghapus data akomodasi lama.
2. Pastikan akun Aldi sudah ada di Supabase Authentication. Ganti `YOUR_EMAIL_HERE` pada contoh `insert` di bagian bawah migrasi dengan email akun tersebut dan jalankan perintahnya di SQL Editor. Tambahkan staf lain dengan peran `owner`, `admin`, `reservations`, atau `finance` sesuai kebutuhan. Peran `partner` disiapkan tetapi belum memiliki panel atau akses data pemesanan.
3. Audit kebijakan RLS tabel lama `properties`, `booking_requests`, dan bucket foto sebelum mengundang staf tambahan. Pemeriksaan peran di halaman web bukan pengganti RLS database.
4. Masuk melalui `login.html`. Pemilik dan admin dapat mengelola akomodasi di `admin.html`, lalu membuka `operations.html`. Staf reservasi dan keuangan langsung diarahkan ke panel operasional sesuai perannya.
5. Migrasi membuat **draf NET RATE Rp500.000** dan markup Rp50.000 untuk `Kamar Standar` pada setiap akomodasi yang sudah tersimpan. Edit nama tipe kamar, NET RATE, dan markup sesuai perjanjian hotel; centang verifikasi hanya setelah harga serta fasilitas dikonfirmasi mitra. Draf tidak dapat dipakai untuk mencatat pesanan.

## Alur manual sebelum pembayaran daring tersedia

- Tamu menghubungi BALEVA melalui katalog. Staf mencatat permintaan di `operations.html` dan **memeriksa ketersediaan kamar kepada mitra lebih dahulu**. Bila tersedia, staf memberi tahu pelanggan dan menanyakan keputusan memesan. Bila tidak tersedia, tawarkan alternatif sebelum ada pembayaran.
- Setelah pelanggan ingin memesan, staf mengunci kamar dengan mitra. Lock hanya dapat dibuat untuk check-in dalam 30 hari ke depan. Masa lock bisa dipilih 2 atau 6 jam; masa habis diperiksa pada saat konfirmasi, meski status belum dibersihkan secara otomatis.
- Staf memberikan rincian harga dan instruksi pembayaran melalui kanal resmi. Setelah dana tamu **benar-benar diterima selama lock berlaku**, staf memasukkan referensi pembayaran dan mengonfirmasi reservasi. Harga tamu = (NET RATE + markup) × kamar × malam. NET RATE hotel tetap utuh.
- Pelanggan dapat **mengajukan pembatalan** setelah reservasi terkonfirmasi lewat `cancellation.html` yang membuka WhatsApp BALEVA. Staf memeriksa nomor pesanan lalu mencatat alasannya di panel; pengelola menerima atau menolak pengajuan dengan alasan. Persetujuan mengawali proses refund manual; dana dan kamar tidak dibatalkan otomatis.
- Setelah checkout, staf keuangan mencatat bukti pelunasan NET RATE hotel mulai hari ke-2 dan paling lambat hari ke-7. Panel menandai tagihan yang melewati hari ke-7; keterlambatan tidak disembunyikan.

## Yang dibutuhkan sebelum transaksi tamu otomatis

- Penyedia pembayaran dan akun usaha resmi, webhook pembayaran yang diverifikasi di server, rekening tujuan, serta prosedur refund.
- Persetujuan harga NET RATE per tipe kamar dan aturan pajak/biaya bila berlaku.
- Dokumen syarat pemesanan dan privasi yang disetujui pengelola.
- Data stok kamar atau mekanisme konfirmasi hotel yang mempunyai SLA. Pencarian tanggal di katalog saat ini belum memeriksa stok langsung; staf harus mencatat permintaan WhatsApp di panel.

**Jangan menyimpan service role key, sandi, atau kredensial pembayaran dalam `config.js` maupun repositori publik.** Migrasi harus dijalankan sebelum menerbitkan perubahan login/admin ini; tanpa tabel `baleva_staff`, akses admin akan tertutup.
