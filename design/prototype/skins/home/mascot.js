// Home's character: a plump homing pigeon with a letter bag. It stands when
// things are quiet, flies while a request is out, and sits down to sleep.
//
// Colours come from the skin's variables. The literal after each comma is the
// light-theme value, so the drawing also works on a page that has no skin loaded.

const c = {
  down: "var(--down,#EEF2FA)",
  wing: "var(--wing,#9DB0D8)",
  lamp: "var(--lamp,#FFD23F)",
  tomato: "var(--tomato,#CF3B26)",
  line: "var(--outline,#33213F)",
  // anything drawn on the page itself rather than on the bird: legs, speed lines, the z
  loose: "var(--plum,#33213F)",
};
const o = (w = 4, colour = c.line) => `stroke="${colour}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

const tail = `<path d="M26 70 6 78l18 10z" fill="${c.wing}" ${o()}/>`;
const legs = `<path d="M58 92v13m-7 0h13M74 91v14m-7 0h13" fill="none" ${o(4, c.loose)}/>`;
const tucked = `<path d="M56 93l-7 6M70 93l-7 6" fill="none" ${o(4, c.loose)}/>`;
const body = `<path d="M22 66c0-22 20-36 44-34 10 1 16-12 30-10 12 2 18 14 14 26-3 9-10 12-12 20-4 18-22 28-42 26-20-2-34-12-34-28z" fill="${c.down}" ${o()}/>`;
const wingFolded = `<path d="M38 62c8-14 30-14 38 2-6 14-30 16-38-2z" fill="${c.wing}" ${o()}/>`;
const wingRaised = `<path d="M42 60c-6-22 4-40 22-46 6 14 6 32-2 48z" fill="${c.wing}" ${o()}/>`;
const beak = `<path d="M110 40l12 5-13 5z" fill="${c.lamp}" ${o()}/>`;
const cheek = `<circle cx="90" cy="50" r="4.5" fill="${c.tomato}" opacity=".5"/>`;
const eyeOpen = `<circle cx="98" cy="38" r="4.2" fill="${c.line}"/><circle cx="99.5" cy="36.5" r="1.4" fill="#fff"/>`;
const eyeShut = `<path d="M93 38q5 4.5 10 0" fill="none" ${o(3)}/>`;
const bag = `<path d="M80 30 60 86" fill="none" ${o()}/><rect x="46" y="74" width="24" height="17" rx="4" fill="${c.lamp}" ${o()}/><path d="M47 77l11 7 11-7" fill="none" ${o(3)}/>`;

const poses = {
  happy: tail + legs + body + wingFolded + beak + eyeOpen + cheek + bag,
  // in the air: wing up, legs tucked, speed lines behind
  busy: `<path d="M4 50h12M0 62h10M6 74h10" fill="none" ${o(3.5, c.loose)}/>
    <g transform="rotate(-10 64 60)">${tail + tucked + body + wingRaised + beak + eyeOpen + cheek + bag}</g>`,
  // brow up, a drop of sweat
  worried: tail + legs + body + wingFolded + beak + eyeOpen + cheek + bag +
    `<path d="M91 29l11 2" fill="none" ${o(3)}/><path d="M113 16c4 6 4 9.5 0 10.5-4-1-4-4.5 0-10.5z" fill="${c.down}" ${o(2.5, c.loose)}/>`,
  // sitting, eye shut, no letter to carry
  sleepy: `<g transform="translate(0 8)">${tail + body + wingFolded + beak + eyeShut + cheek}</g>
    <path d="M30 22h11l-11 11h11" fill="none" ${o(3.5, c.loose)}/><path d="M14 8h8l-8 8h8" fill="none" ${o(3, c.loose)}/>`,
};

export function mascot(mood) {
  return `<svg class="mascot bird" viewBox="0 0 128 112" overflow="visible" aria-hidden="true">${poses[mood] ?? poses.happy}</svg>`;
}

// 32 x 32, fixed colours: the favicon and the thumbnail in the skin picker.
export const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8.5" fill="#D6E6F6"/>
  <path d="M22.5 13.5l7 3-7 3.5z" fill="#FFD23F" stroke="#33213F" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="14.5" cy="16.5" r="9.5" fill="#EEF2FA" stroke="#33213F" stroke-width="2.5"/>
  <circle cx="17.5" cy="14" r="2.3" fill="#33213F"/>
  <circle cx="13" cy="20" r="2.3" fill="#CF3B26" opacity=".5"/>
</svg>`;

// What the drawing needs when it is shown outside the skin (the mascot sheet, the cover).
export const palette = {
  light: { bg: "#D6E6F6", vars: {} },
  dark: { bg: "#191428", vars: { "--down": "#E4E9F5", "--wing": "#8496C4", "--outline": "#120D1E", "--tomato": "#EE5A42", "--plum": "#F3ECFA" } },
};
