# Draf Perbaikan Konflik Style Transformasi dan ASMR

> **Status:** draf implementasi; belum diterapkan pada branch `master`.  
> **Tujuan:** menjadikan aturan tangan/manusia sebagai kebijakan deklaratif milik style, lalu memakai kebijakan yang sama pada storyboard image prompt, I2V, T2V, negative prompt, dan sanitasi respons LLM.

## Masalah yang Harus Dihilangkan

Saat ini `normalizeFaceMode()` menganggap semua nama style yang mengandung `asmr` sebagai `no_people`. Ini salah karena `mini_restoration_asmr` secara desain membutuhkan tangan dan alat presisi, sedangkan `jelly_character_asmr` membutuhkan telapak tangan. `cube_box_transform` juga secara eksplisit butuh satu tangan pada beat pembuka, tetapi ada aturan video/sanitasi lain yang menghapus semua tangan. Penyebabnya adalah keputusan visual diambil dari **substring nama style** dan disalin ulang pada beberapa prompt. [1] [2] [3]

> **Prinsip perbaikan:** kebijakan visual harus berasal dari satu field eksplisit dalam `StyleSpec`, bukan dari `styleId.includes('asmr')`, `styleId.includes('cube')`, atau daftar hard-coded yang tersebar.

## 1. Tambahkan Kebijakan Deklaratif di `styleLibrary.js`

Gunakan field `humanInteraction` pada setiap style. Nilai default untuk style lama adalah `allowed`; hanya style yang memerlukan aturan khusus perlu ditandai.

```js
// backend/prompts/styleLibrary.js

cube_box_transform: {
  // ...field existing...
  humanInteraction: 'opening_only',
},

shape_morph_transform: {
  // ...field existing...
  humanInteraction: 'forbidden',
},

asmr_toy_transform: {
  // ...field existing...
  humanInteraction: 'forbidden',
},

mini_restoration_asmr: {
  // ...field existing...
  humanInteraction: 'required_hands',
},

jelly_character_asmr: {
  // ...field existing...
  humanInteraction: 'required_palm',
},
```

| Policy | Makna visual | Style Storymax saat ini |
|---|---|---|
| `allowed` | Orang/tangan mengikuti `faceMode` umum. | Default. |
| `forbidden` | Tidak ada tangan, jari, tubuh, atau manusia. | `shape_morph_transform`, `asmr_toy_transform`. |
| `opening_only` | Satu tangan dewasa pada beat pertama; keluar sepenuhnya sesudahnya. | `cube_box_transform`. |
| `required_hands` | Tangan dan alat boleh/harus terlihat sesuai tindakan. | `mini_restoration_asmr`. |
| `required_palm` | Subjek harus berada di telapak tangan terbuka. | `jelly_character_asmr`. |

## 2. Buat Satu Helper Policy

Buat file baru: `backend/prompts/humanInteractionPolicy.js`.

```js
const { getStyleSpec } = require('./styleLibrary');

const HUMAN_INTERACTION = Object.freeze({
  ALLOWED: 'allowed',
  FORBIDDEN: 'forbidden',
  OPENING_ONLY: 'opening_only',
  REQUIRED_HANDS: 'required_hands',
  REQUIRED_PALM: 'required_palm',
});

function getHumanInteraction(styleOrId) {
  const spec = typeof styleOrId === 'string'
    ? getStyleSpec(styleOrId)
    : (styleOrId || {});
  const value = spec.humanInteraction;
  return Object.values(HUMAN_INTERACTION).includes(value)
    ? value
    : HUMAN_INTERACTION.ALLOWED;
}

function interactionClause(policy) {
  switch (policy) {
    case HUMAN_INTERACTION.FORBIDDEN:
      return 'HUMAN INTERACTION POLICY: absolutely no human presence, hands, fingers, arms or body parts. The subject operates automatically by itself.';
    case HUMAN_INTERACTION.OPENING_ONLY:
      return 'HUMAN INTERACTION POLICY: ONLY in the opening beat, exactly one adult human hand may press the cube button and gently toss/flip it. The hand leaves the frame immediately and must never return; every later beat is fully hands-free.';
    case HUMAN_INTERACTION.REQUIRED_HANDS:
      return 'HUMAN INTERACTION POLICY: visible adult hands and precision tools are REQUIRED for the hands-on assembly/restoration action. Show no face unless the face-mode rule explicitly permits it.';
    case HUMAN_INTERACTION.REQUIRED_PALM:
      return 'HUMAN INTERACTION POLICY: the figurine remains visibly cradled in one open human palm; no human face is required.';
    default:
      return '';
  }
}

function interactionNegatives(policy) {
  switch (policy) {
    case HUMAN_INTERACTION.FORBIDDEN:
      return ['hands', 'human hands', 'fingers', 'arms', 'body parts', 'person', 'human'];
    case HUMAN_INTERACTION.OPENING_ONLY:
      return ['hands remaining after the opening beat', 'multiple people', 'human face in frame'];
    case HUMAN_INTERACTION.REQUIRED_HANDS:
      return ['missing hands or precision tools', 'full human portrait unless explicitly requested'];
    case HUMAN_INTERACTION.REQUIRED_PALM:
      return ['figurine floating without a palm', 'closed fist hiding the figurine', 'human portrait'];
    default:
      return [];
  }
}

function i2vHumanInteractionRule(policy) {
  switch (policy) {
    case HUMAN_INTERACTION.FORBIDDEN:
      return 'HUMAN INTERACTION: no hands, fingers, arms, human body parts, or people may enter the shot; the subject moves automatically.';
    case HUMAN_INTERACTION.OPENING_ONLY:
      return 'HUMAN INTERACTION: show one hand only in the opening beat to press and toss the cube; it exits immediately and never returns during the automatic transformation.';
    case HUMAN_INTERACTION.REQUIRED_HANDS:
      return 'HUMAN INTERACTION: keep the operator hands and precision tools visible and naturally synchronized with the assembly/restoration action; do not invent a face.';
    case HUMAN_INTERACTION.REQUIRED_PALM:
      return 'HUMAN INTERACTION: keep the figurine visibly supported by one open palm throughout the shot; do not crop the palm or introduce a full human portrait.';
    default:
      return '';
  }
}

module.exports = {
  HUMAN_INTERACTION,
  getHumanInteraction,
  interactionClause,
  interactionNegatives,
  i2vHumanInteractionRule,
};
```

## 3. Ganti `normalizeFaceMode()` agar Tidak Menggunakan Substring

Ganti implementasi di `backend/prompts/faceMode.js`. Kebijakan interaksi dan face mode adalah dua dimensi terpisah: `required_hands` boleh tetap memakai `faceless`, dan `required_palm` tidak berarti wajah manusia harus muncul.

```js
const {
  HUMAN_INTERACTION,
  getHumanInteraction,
} = require('./humanInteractionPolicy');

function normalizeFaceMode(faceMode, showFace, styleId) {
  const interaction = getHumanInteraction(styleId);

  if (interaction === HUMAN_INTERACTION.FORBIDDEN) return 'no_people';

  // Hands/palm can be mandatory while wajah manusia tetap tidak terlihat.
  if (
    interaction === HUMAN_INTERACTION.OPENING_ONLY ||
    interaction === HUMAN_INTERACTION.REQUIRED_HANDS ||
    interaction === HUMAN_INTERACTION.REQUIRED_PALM
  ) return 'faceless';

  if (['no_people', 'faceless', 'chin_max', 'full'].includes(faceMode)) return faceMode;
  return showFace === true ? 'full' : 'faceless';
}
```

Hapus blok lama berikut sepenuhnya.

```js
if (styleId) {
  const s = String(styleId).toLowerCase();
  if (s.includes('cube') || s.includes('asmr') || s.includes('shape_morph') || s.includes('capsule')) {
    return 'no_people';
  }
}
```

## 4. Terapkan Policy pada Master Prompt Gambar

Pada `backend/prompts/masterPrompt.js`, import helper.

```js
const {
  getHumanInteraction,
  interactionClause,
  interactionNegatives,
} = require('./humanInteractionPolicy');
```

Di awal `buildMasterPrompt`, setelah `face` dan `fneg`, buat nilai berikut.

```js
const humanInteraction = getHumanInteraction(spec);
const humanClause = interactionClause(humanInteraction);
const humanNegatives = interactionNegatives(humanInteraction);
```

Masukkan `humanNegatives` sebelum `fneg` agar policy penting tidak terpotong oleh budget negative prompt.

```js
let negatives = dedupeList(
  []
    .concat(fidelityNeg)
    .concat(characterNeg)
    .concat(humanNegatives)
    .concat(styleNegs)
    .concat(antiSketch)
    .concat(fneg ? String(fneg).split(',') : [])
    .concat(['text paragraphs inside panels'])
).join(', ');
```

Tambahkan `humanClause` ke body **sebelum** detail scene agar model mendapat aturan prioritas tinggi.

```js
const assemble = (s, ct, ar, rn) => [
  L1,
  L1c,
  humanClause,
  L2,
  subjLine(s, rn),
  L4,
  L5,
  scenesLine(ct, ar),
].filter(Boolean).join('\n');
```

Jangan lagi menyuntikkan daftar larangan tangan yang sama lewat `faceNegative` untuk style yang memakai `opening_only`, `required_hands`, atau `required_palm`.

## 5. Terapkan Policy yang Sama pada `masterPromptLLM.js`

Tambahkan payload eksplisit dan instruksi ringkas, bukan daftar hard-coded baru.

```js
const {
  getHumanInteraction,
  interactionClause,
  interactionNegatives,
} = require('./humanInteractionPolicy');

const humanInteraction = getHumanInteraction(spec);

STYLE_SPEC: {
  // ...field existing...
  humanInteraction,
  humanInteractionRule: interactionClause(humanInteraction),
  humanInteractionNegatives: interactionNegatives(humanInteraction),
},
```

Tambahkan satu aturan system prompt:

```text
HUMAN INTERACTION POLICY — obey STYLE_SPEC.humanInteractionRule exactly.
It overrides generic transformation assumptions. If the policy is `forbidden`, no
human presence is permitted. If it is `opening_only`, one hand is permitted only
for the opening beat. If it requires hands or a palm, do not remove them.
```

Hapus kalimat generik yang mengasumsikan semua transformasi selalu hands-free.

## 6. Terapkan Policy pada Prompt Video dan Sanitasi

Di `backend/controllers/aiController.js`, setelah `styleSpec` dibuat, ambil policy.

```js
const {
  HUMAN_INTERACTION,
  getHumanInteraction,
  i2vHumanInteractionRule,
} = require('../prompts/humanInteractionPolicy');

const humanInteraction = getHumanInteraction(styleSpec);
const humanInteractionRule = i2vHumanInteractionRule(humanInteraction);
```

Letakkan `${humanInteractionRule}` di `systemInstruction` untuk jalur VO dan non-VO, setelah `${cameraDisciplineClause}`. Hapus aturan statis berikut karena ia membuat semua transformasi dilarang memakai tangan.

```text
FOR TRANSFORMATIONS (Cube/ASMR/Shape): NO human hands, NO fingers, NO human interaction...
```

Untuk sanitasi pada sekitar blok yang kini menguji daftar `cube_box_transform`, `asmr_toy_transform`, dan `shape_morph_transform`, jalankan penghapusan kata tangan **hanya** bila policy adalah `forbidden`.

```js
if (humanInteraction === HUMAN_INTERACTION.FORBIDDEN) {
  i2v = stripForbiddenHumanTerms(i2v);
  t2v = stripForbiddenHumanTerms(t2v);
}
```

Buat helper yang lebih aman daripada rangkaian replace yang tersebar.

```js
function stripForbiddenHumanTerms(prompt) {
  return String(prompt || '')
    .replace(/\b(?:hands?|fingers?|human\s+hands?|arms?|people|person)\b/gi, 'mechanical action')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
```

> Untuk `opening_only`, jangan lakukan sanitasi tangan. Untuk `required_hands` dan `required_palm`, lakukan validasi positif—misalnya cek apakah `hand`, `palm`, atau `tool` ada dalam output vision LLM—dan mintakan rewrite jika hilang.

## 7. Hilangkan Duplikasi pada Clause Style Khusus

Style-specific clause tetap boleh mendeskripsikan mekanik cube, meja ASMR, atau macro restorasi. Namun, bagian yang mengatur **apakah tangan boleh muncul** harus hanya merujuk ke policy. Contoh penyederhanaan cube:

```text
OPENING ACTION: follow the configured human-interaction policy. The cube then
unfolds mechanically with connected panels; no detached parts, glow, or humanoid robot.
```

Dengan cara ini, perubahan kebijakan pada style tidak perlu diperbaiki di lima lokasi prompt sekaligus.

## 8. Acceptance Criteria

| Test | Expected result |
|---|---|
| `cube_box_transform` image prompt | Tepat satu tangan di opening beat; negative hanya melarang tangan setelah opening dan wajah/manusia tambahan. |
| `cube_box_transform` I2V | Prompt menyebut press/toss di awal lalu transform otomatis; sanitasi tidak menghapus tangan pembuka. |
| `asmr_toy_transform` | Gambar dan I2V/T2V bebas tangan/manusia. |
| `shape_morph_transform` | Gambar dan I2V/T2V bebas tangan/manusia. |
| `mini_restoration_asmr` | Prompt mewajibkan tangan dan alat presisi; tidak ada `no_people` atau negative `hands`. |
| `jelly_character_asmr` | Prompt menyebut figur berada dalam telapak tangan; tidak disanitasi sebagai interaksi terlarang. |
| Alias `cube_morph_product` | Mewarisi policy `opening_only` melalui `getStyleSpec()`/resolver alias. |
| Style umum, misalnya `unboxing` | Tetap mengikuti `faceMode` tanpa policy transformasi yang tidak relevan. |

## Urutan Implementasi Aman

1. Tambahkan field `humanInteraction` dan helper beserta unit test mapping style→policy.
2. Ganti `normalizeFaceMode()`; verifikasi UI default tidak berubah untuk style umum.
3. Terapkan policy ke deterministic master prompt dan validasi snapshot prompt.
4. Terapkan policy ke LLM master prompt dan generator video.
5. Hapus sanitasi hard-coded/aturan transformasi generik yang bertentangan.
6. Jalankan satu proyek uji untuk masing-masing lima policy sebelum deployment penuh.

## References

[1]: https://github.com/curls1337/storymax/blob/master/backend/prompts/faceMode.js#L5-L38 "Face mode normalization"
[2]: https://github.com/curls1337/storymax/blob/master/backend/prompts/styleLibrary.js#L12-L34 "Transform style specifications"
[3]: https://github.com/curls1337/storymax/blob/master/backend/prompts/styleLibrary.js#L271-L299 "ASMR style specifications"
