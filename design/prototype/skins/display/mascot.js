// Display's character: a little router with two antennas, drawn on a 16 x 16 grid
// so that it lands on whole pixels at 16, 32, 48 and 64 px.

const pets = {
  happy: [
    "................",
    "..#..........#..",
    "...#........#...",
    "....#......#....",
    "..############..",
    ".#............#.",
    ".#..##....##..#.",
    ".#..##....##..#.",
    ".#............#.",
    ".#...#....#...#.",
    ".#....####....#.",
    ".#............#.",
    "..############..",
    "...##......##...",
    "...##......##...",
    "................",
  ],
  // antennas sparking, mouth open
  busy: [
    "#...#......#...#",
    "..#..........#..",
    "...#........#...",
    "....#......#....",
    "..############..",
    ".#............#.",
    ".#..##....##..#.",
    ".#..##....##..#.",
    ".#............#.",
    ".#....####....#.",
    ".#....####....#.",
    ".#............#.",
    "..############..",
    "...##......##...",
    "...##......##...",
    "................",
  ],
  // raised brows, mouth turned down, a drop of sweat
  worried: [
    "................",
    "..#..........#..",
    "...#........#...",
    "....#......#...#",
    "..############.#",
    ".#...#....#...#.",
    ".#..##....##..#.",
    ".#..##....##..#.",
    ".#............#.",
    ".#....####....#.",
    ".#...#....#...#.",
    ".#............#.",
    "..############..",
    "...##......##...",
    "...##......##...",
    "................",
  ],
  // antennas down, eyes shut
  sleepy: [
    "................",
    "................",
    ".#............#.",
    "..##........##..",
    "..############..",
    ".#............#.",
    ".#............#.",
    ".#..##....##..#.",
    ".#............#.",
    ".#............#.",
    ".#.....##.....#.",
    ".#............#.",
    "..############..",
    "...##......##...",
    "...##......##...",
    "................",
  ],
};

const pixels = (rows) =>
  rows.flatMap((row, y) => [...row].map((cell, x) => (cell === "#" ? `<rect x="${x}" y="${y}" width="1.02" height="1.02"/>` : ""))).join("");

export function mascot(mood) {
  return `<svg class="mascot" viewBox="0 0 16 16" fill="var(--pixel,#1C2A20)" shape-rendering="crispEdges" aria-hidden="true">${pixels(pets[mood] ?? pets.happy)}</svg>`;
}

// 32 x 32, fixed colours: the favicon and the thumbnail in the skin picker.
export const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">
  <rect width="16" height="16" rx="3" fill="#C2CEB8" shape-rendering="auto"/><g fill="#1C2A20">${pixels(pets.happy)}</g>
</svg>`;

// What the drawing needs when it is shown outside the skin (the mascot sheet, the cover).
export const palette = {
  light: { bg: "#C2CEB8", vars: {} },
  dark: { bg: "#84E2D2", vars: { "--pixel": "#0C2C29" } },
};
