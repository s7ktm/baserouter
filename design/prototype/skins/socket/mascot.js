// Socket's character: a wall socket with a face, two feet, and a cable for a tail
// that ends in a plug. The tail does most of the acting.
//
// Colours come from the skin's variables. The literal after each comma is the
// light-theme value, so the drawing also works on a page that has no skin loaded.

const c = {
  plastic: "var(--plastic,#FBFBF8)",
  recess: "var(--recess,#EEEFEA)",
  ink: "var(--ink,#1C2030)",
  cable: "var(--cable,#FFC531)",
  rocker: "var(--rocker,#F0432B)",
};
const line = (w) => `fill="none" stroke="${c.ink}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const cable = (d) => `<path d="${d}" fill="none" stroke="${c.cable}" stroke-width="7" stroke-linecap="round"/>`;
const plug = (x, y) => `<path d="M${x + 6} ${y}v-9M${x + 14} ${y}v-9" ${line(4)}/><rect x="${x}" y="${y}" width="20" height="24" rx="6" fill="${c.ink}"/>`;
const eyes = (y, r) => `<circle cx="43" cy="${y}" r="${r}" fill="${c.ink}"/><circle cx="63" cy="${y}" r="${r}" fill="${c.ink}"/>`;

const tails = {
  // held up, ready
  happy: cable("M92 88c20 4 28-8 24-24") + plug(106, 40),
  // raised high and sparking
  busy: cable("M92 84c20 2 26-14 22-32") + plug(104, 28) +
    `<path d="M106 12l-4-6M114 9V1M122 12l4-6" fill="none" stroke="${c.cable}" stroke-width="3.5" stroke-linecap="round"/>`,
  // sagging
  worried: cable("M92 94c12 8 26 8 28-4") + plug(110, 66),
  // lying on the floor, unplugged
  sleepy: cable("M92 98c4 12 10 12 16 11") +
    `<path d="M130 105h5M130 113h5" ${line(4)}/><rect x="108" y="100" width="22" height="18" rx="6" fill="${c.ink}"/>`,
};

const faces = {
  happy: eyes(60, 5.5) + `<path d="M44 71q9 9 18 0" ${line(3.8)}/>`,
  busy: eyes(60, 5.5) + `<circle cx="53" cy="74" r="4.5" ${line(3.8)}/>`,
  worried: eyes(62, 5) + `<path d="M35 53l10-4M71 53l-10-4" ${line(3.4)}/><path d="M44 76q4.5-5 9 0t9 0" ${line(3.8)}/>` +
    `<path d="M82 33c4.5 6 4.5 10 0 11-4.5-1-4.5-5 0-11z" fill="${c.recess}" stroke="${c.ink}" stroke-width="2.5" stroke-linejoin="round"/>`,
  sleepy: `<path d="M37 61q6 5 12 0M57 61q6 5 12 0" ${line(3.8)}/><path d="M49 74h8" ${line(3.8)}/>` +
    `<path d="M100 30h12l-12 12h12" ${line(3.5)}/><path d="M118 12h8l-8 8h8" ${line(3)}/>`,
};

export function mascot(mood) {
  const m = mood in faces ? mood : "happy";
  return `<svg class="mascot" viewBox="0 0 136 128" aria-hidden="true">
    ${tails[m]}
    <rect x="30" y="102" width="14" height="12" rx="4" fill="${c.ink}"/><rect x="60" y="102" width="14" height="12" rx="4" fill="${c.ink}"/>
    <rect x="12" y="24" width="82" height="82" rx="23" fill="${c.plastic}" stroke="${c.ink}" stroke-width="5"/>
    <circle cx="53" cy="65" r="28" fill="${c.recess}" stroke="${c.ink}" stroke-width="3.5"/>
    ${faces[m]}
    <circle cx="34" cy="71" r="4.5" fill="${c.rocker}" opacity=".5"/><circle cx="72" cy="71" r="4.5" fill="${c.rocker}" opacity=".5"/>
  </svg>`;
}

// 32 x 32, fixed colours: the favicon and the thumbnail in the skin picker.
export const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect x="2" y="2" width="28" height="28" rx="8.5" fill="#FBFBF8" stroke="#1C2030" stroke-width="2.5"/>
  <circle cx="16" cy="16" r="9.3" fill="#EEEFEA" stroke="#1C2030" stroke-width="1.8"/>
  <circle cx="12.4" cy="14.4" r="2.1" fill="#1C2030"/><circle cx="19.6" cy="14.4" r="2.1" fill="#1C2030"/>
  <path d="M12.4 19.2q3.6 3.2 7.2 0" fill="none" stroke="#1C2030" stroke-width="1.9" stroke-linecap="round"/>
</svg>`;

// What the drawing needs when it is shown outside the skin (the mascot sheet, the cover).
export const palette = {
  light: { bg: "#E6E9EE", vars: {} },
  dark: { bg: "#121419", vars: { "--plastic": "#262932", "--recess": "#1A1C23", "--ink": "#F3F4F6" } },
};
