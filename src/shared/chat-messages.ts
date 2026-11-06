/**
 * Replies the server writes itself and the browser also needs to know: a chat saved with older wording is cleaned up
 * from these when it is loaded.
 */

/** Said after the storyboard picture is made: the video is a feature of its own, and its price is asked before it is made. */
export const STORYBOARD_READY_MESSAGE =
  "Storyboard-nya sudah jadi. Mau dijadikan video? Pilih fitur Video di sidebar, lampirkan gambar storyboard ini, lalu AI yang menentukan durasi, suara, dan musiknya. Harganya kutanyakan dulu sebelum videonya dibuat.";

/**
 * Every reply the bot once gave that points at a step or a button that is gone (the text step of the storyboard, with its
 * approve button, and the "Buat video iklan" panel under the picture). A saved chat leaves them out.
 */
export const OBSOLETE_REPLIES: ReadonlySet<string> = new Set([
  "Storyboard-nya sudah jadi. Di bawahnya ada panel “Buat video iklan”: tekan Generate, lalu AI yang menentukan durasi, suara, dan musiknya. Harganya kutanyakan dulu sebelum videonya dibuat.",
  "Berikut usulan 6 panel storyboard untuk iklan produk ini. Teks tiap scene dapat diubah langsung, atau minta penggantian scene tertentu lewat chat. Jika sudah sesuai, tekan “Setujui & buat gambar”. Setelah gambar storyboard selesai, panel “Buat video iklan” akan muncul: tekan Generate, lalu AI yang menentukan durasi, suara, dan musiknya.",
  "Scene sudah diganti. Jika storyboard sudah sesuai, tekan “Setujui & buat gambar”. Setelah gambar storyboard selesai, panel “Buat video iklan” akan muncul: tekan Generate, lalu AI yang menentukan durasi, suara, dan musiknya.",
  "Berikut usulan 6 panel storyboard untuk iklan produk ini. Teks tiap scene dapat diubah langsung, atau minta penggantian scene tertentu lewat chat. Jika sudah sesuai, tekan “Setujui & buat gambar”. Setelah gambar storyboard selesai, panel “Buat video iklan” akan muncul: pilih durasinya, lalu tekan Generate.",
  "Scene sudah diganti. Jika storyboard sudah sesuai, tekan “Setujui & buat gambar”. Setelah gambar storyboard selesai, panel “Buat video iklan” akan muncul: pilih durasinya, lalu tekan Generate.",
  "Berikut usulan 4 scene storyboard untuk iklan produk ini. Teks tiap scene dapat diubah langsung, atau minta penggantian scene tertentu lewat chat. Jika sudah sesuai, tekan “Setujui & buat gambar”. Setelah semua gambar selesai, panel “Buat video iklan” akan muncul: pilih durasinya, lalu tekan Generate.",
  "Scene sudah diganti. Jika storyboard sudah sesuai, tekan “Setujui & buat gambar”. Setelah semua gambar selesai, panel “Buat video iklan” akan muncul: pilih durasinya, lalu tekan Generate.",
  "Ini usulan 4 scene storyboard-nya. Kamu bisa ubah teksnya atau minta aku ganti scene tertentu. Kalau sudah cocok, setujui dulu ya, baru aku buatkan gambarnya.",
  "Berikut usulan 4 scene storyboard untuk iklan produk ini. Teks tiap scene dapat diubah langsung, atau minta penggantian scene tertentu lewat chat. Jika sudah sesuai, tekan “Setujui & buat gambar”. Setelah semua gambar selesai, tombol “Buat video” akan muncul untuk menjadikannya video iklan.",
  "Sudah kuganti. Kalau sudah cocok, setujui supaya aku buatkan gambarnya ya.",
  "Scene sudah diganti. Jika storyboard sudah sesuai, tekan “Setujui & buat gambar”. Tombol “Buat video” akan muncul setelah semua gambar selesai.",
]);
