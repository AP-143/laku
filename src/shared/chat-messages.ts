/**
 * Replies the server writes itself and the browser also needs to know: a chat saved with older wording is brought up
 * to date from these when it is loaded.
 */

export const SCENES_PROPOSED_MESSAGE =
  "Berikut usulan 6 panel storyboard untuk iklan produk ini. Teks tiap scene dapat diubah langsung, atau minta penggantian scene tertentu lewat chat. Jika sudah sesuai, tekan “Setujui & buat gambar”. Setelah gambar storyboard selesai, panel “Buat video iklan” akan muncul: tekan Generate, lalu AI yang menentukan durasi, suara, dan musiknya.";

export const SCENE_REPLACED_MESSAGE =
  "Scene sudah diganti. Jika storyboard sudah sesuai, tekan “Setujui & buat gambar”. Setelah gambar storyboard selesai, panel “Buat video iklan” akan muncul: tekan Generate, lalu AI yang menentukan durasi, suara, dan musiknya.";

/** Every earlier wording of the two replies above, and the current one that replaces it. */
export const OUTDATED_REPLIES: Record<string, string> = {
  "Berikut usulan 6 panel storyboard untuk iklan produk ini. Teks tiap scene dapat diubah langsung, atau minta penggantian scene tertentu lewat chat. Jika sudah sesuai, tekan “Setujui & buat gambar”. Setelah gambar storyboard selesai, panel “Buat video iklan” akan muncul: pilih durasinya, lalu tekan Generate.":
    SCENES_PROPOSED_MESSAGE,
  "Scene sudah diganti. Jika storyboard sudah sesuai, tekan “Setujui & buat gambar”. Setelah gambar storyboard selesai, panel “Buat video iklan” akan muncul: pilih durasinya, lalu tekan Generate.":
    SCENE_REPLACED_MESSAGE,
  "Berikut usulan 4 scene storyboard untuk iklan produk ini. Teks tiap scene dapat diubah langsung, atau minta penggantian scene tertentu lewat chat. Jika sudah sesuai, tekan “Setujui & buat gambar”. Setelah semua gambar selesai, panel “Buat video iklan” akan muncul: pilih durasinya, lalu tekan Generate.":
    SCENES_PROPOSED_MESSAGE,
  "Scene sudah diganti. Jika storyboard sudah sesuai, tekan “Setujui & buat gambar”. Setelah semua gambar selesai, panel “Buat video iklan” akan muncul: pilih durasinya, lalu tekan Generate.":
    SCENE_REPLACED_MESSAGE,
  "Ini usulan 4 scene storyboard-nya. Kamu bisa ubah teksnya atau minta aku ganti scene tertentu. Kalau sudah cocok, setujui dulu ya, baru aku buatkan gambarnya.":
    SCENES_PROPOSED_MESSAGE,
  "Berikut usulan 4 scene storyboard untuk iklan produk ini. Teks tiap scene dapat diubah langsung, atau minta penggantian scene tertentu lewat chat. Jika sudah sesuai, tekan “Setujui & buat gambar”. Setelah semua gambar selesai, tombol “Buat video” akan muncul untuk menjadikannya video iklan.":
    SCENES_PROPOSED_MESSAGE,
  "Sudah kuganti. Kalau sudah cocok, setujui supaya aku buatkan gambarnya ya.": SCENE_REPLACED_MESSAGE,
  "Scene sudah diganti. Jika storyboard sudah sesuai, tekan “Setujui & buat gambar”. Tombol “Buat video” akan muncul setelah semua gambar selesai.":
    SCENE_REPLACED_MESSAGE,
};
