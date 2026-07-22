// Grid & time helpers for storyboard prompts (pure, no side effects).

function getGridLayoutDescription(gridCount, startScene = 1) {
  const endScene = startScene + gridCount - 1;
  if (gridCount === 4) return `2x2 grid of 4 numbered scenes (SCENE ${startScene} to SCENE ${endScene})`;
  if (gridCount === 6) return `3x2 grid of 6 numbered scenes (SCENE ${startScene} to SCENE ${endScene})`;
  if (gridCount === 8) return `4x2 grid of 8 numbered scenes (SCENE ${startScene} to SCENE ${endScene})`;
  if (gridCount === 9) return `3x3 grid of 9 numbered scenes (SCENE ${startScene} to SCENE ${endScene})`;
  if (gridCount === 12) return `4x3 grid of 12 numbered scenes (SCENE ${startScene} to SCENE ${endScene})`;
  return `grid of ${gridCount} numbered scenes (SCENE ${startScene} to SCENE ${endScene})`;
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

module.exports = { getGridLayoutDescription, formatTime };
