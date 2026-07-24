// Safety net for the image-to-video (I2V) prompt: it must be PURELY visual
// (camera + motion + atmosphere only). The generator rules already forbid narration
// and timing text, but models sometimes leak it in (e.g. "Narrator: ...", "VO:",
// "(0-3s)"). This strips those leaks. Apply ONLY to imageToVideoPrompt — never to
// textToVideoPrompt or the narration field.
function stripSpeechLeak(input) {
  if (typeof input !== 'string') return input == null ? '' : String(input);
  let t = input;

  // 1) Labeled narration / voiceover segments. After the label, consume EITHER a
  //    quoted clause OR an unquoted run up to the next sentence end — so both
  //    'Narrator: "Buy now!"' and 'VO: hemat 24 jam.' are removed entirely.
  t = t.replace(/\b(?:narrator|narration|voice[\s-]?over|voice[\s-]?off|vo)\b\s*[:\-–—]\s*(?:["“][^"”]*["”]?|[^.!?\n]*[.!?]?)/gi, ' ');

  // 2) "(the) narrator/voice says/speaks/whispers \"...\"" phrasing.
  t = t.replace(/\b(?:the\s+)?(?:narrator|voice)\s+(?:says?|speaks?|whispers?|narrates?)\b\s*[:,]?\s*(?:["“][^"”]*["”]?|[^.!?\n]*[.!?]?)/gi, ' ');

  // 3) Timing cues: (0-3s) [0:00-0:03] "at 0-3s" "from 0–3 seconds" "Timing: ..."
  t = t.replace(/[([]\s*\d{1,2}\s*[:.]?\d{0,2}\s*[-–—]\s*\d{1,2}\s*[:.]?\d{0,2}\s*(?:s|sec|secs|second|seconds)?\s*[)\]]/gi, ' ');
  t = t.replace(/\b(?:at|from)\s+\d{1,2}\s*[:.]?\d{0,2}\s*[-–—]\s*\d{1,2}\s*[:.]?\d{0,2}\s*(?:s|sec|secs|second|seconds)\b/gi, ' ');
  t = t.replace(/\b(?:vo\s*timing|timing|timecode|time\s*code)\b\s*[:\-–—]\s*[^.;\n]*/gi, ' ');

  // 4) Remove any orphaned label token left dangling before punctuation / end.
  t = t.replace(/\b(?:narrator|narration|voice[\s-]?over|vo)\b(?=\s*[.;,)\]]|\s*$)/gi, ' ');

  // 5) Tidy: drop empty () [] left behind, collapse spaces, fix spaced punctuation.
  t = t.replace(/[([]\s*[)\]]/g, ' ');
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1');
  t = t.replace(/([.!?])(?:\s*[.!?])+/g, '$1'); // collapse duplicate punctuation left by removals
  t = t.replace(/^[\s,;:.–—-]+/, '').trim();
  return t;
}

module.exports = { stripSpeechLeak };
