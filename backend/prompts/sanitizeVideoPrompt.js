// Safety net for the image-to-video (I2V) prompt: it must be PURELY visual
// (camera + motion + atmosphere only). The generator rules already forbid narration
// and timing text, but models sometimes leak it in (e.g. "Narrator: ...", "VO:",
// "(0-3s)"). This strips those leaks. Apply ONLY to imageToVideoPrompt — never to
// textToVideoPrompt or the narration field.
function stripSpeechLeak(input, allowCaptions = false) {
  if (typeof input !== 'string') return input == null ? '' : String(input);
  let t = input;

  // 1) Labeled narration / voiceover segments. After the label, consume EITHER a
  //    quoted clause OR an unquoted run up to the next sentence end — so both
  //    'Narrator: "Buy now!"' and 'VO: hemat 24 jam.' are removed entirely.
  t = t.replace(/\b(?:narrator|narration|voice[\s-]?over|voice[\s-]?off|vo)\b\s*[:\-–—]\s*(?:["“][^"”]*["”]?|[^.!?\n]*[.!?]?)/gi, ' ');

  // 2) "(the) narrator/voice says/speaks/whispers \"...\"" phrasing.
  t = t.replace(/\b(?:the\s+)?(?:narrator|voice)\s+(?:says?|speaks?|whispers?|narrates?)\b\s*[:,]?\s*(?:["“][^"”]*["”]?|[^.!?\n]*[.!?]?)/gi, ' ');

  if (!allowCaptions) {
    // 2b) On-screen caption / banner / badge / header / VO-note text leaks read straight
    //     off the printed storyboard sheet (e.g. 'the caption reads "Buy now"', 'a banner
    //     displaying "..."', 'text on screen says "..."', 'the VO note shows "..."'). These
    //     are storyboard planning annotations, never part of the real motion — strip them.
    t = t.replace(/\b(?:the\s+)?(?:caption|banner|badge|header|title\s+banner|on[\s-]?screen\s+text|text\s+on\s+screen|vo\s*note|duration\s+chip)\s+(?:reads?|says?|displays?|showing|shows?)\b\s*[:,]?\s*(?:["“][^"”]*["”]?|[^.!?\n]*[.!?]?)/gi, ' ');

    // 2c) Direct quoted snippets immediately preceded by a chrome/label noun without a
    //     reads/says verb (e.g. 'caption: "Buy now"', 'CAM: push-in tag', 'VO cue "Ayo coba"').
    t = t.replace(/\b(?:caption|banner|badge|vo\s*cue|vo\s*tag)\b\s*[:\-–—]\s*["“][^"”]*["”]?/gi, ' ');
  }

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
