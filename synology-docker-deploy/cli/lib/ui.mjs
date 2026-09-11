// 화면 출력 도우미: 로고, 색상, 체크 목록, 상자, 질문.
const ESC = String.fromCharCode(27) + '[';
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const plain = Boolean(process.env.NAS_DEPLOY_ASCII);

const s = (codes, text) => (useColor ? `${ESC}${codes}m${text}${ESC}0m` : String(text));
export const brand = (text) => s('38;5;45', text);
export const bold = (text) => s('1', text);
export const dim = (text) => s('2', text);
export const green = (text) => s('38;5;42', text);
export const yellow = (text) => s('38;5;214', text);
export const red = (text) => s('38;5;203', text);
export const cyan = (text) => s('38;5;51', text);

export const GLYPH = plain
  ? { ok: '[v]', bad: '[x]', warn: '[!]', skip: '[-]', arrow: '->', tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', bar: '|' }
  : { ok: '✔', bad: '✖', warn: '▲', skip: '·', arrow: '→', tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', bar: '▌' };

// 한글은 한 글자가 두 칸을 차지하므로 상자를 그릴 때 따로 계산합니다.
export function width(text) {
  const bare = String(text).replace(new RegExp(ESC.replace('[', '\\[') + '[0-9;]*m', 'g'), '');
  let total = 0;
  for (const ch of bare) {
    const code = ch.codePointAt(0);
    const wide =
      (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) || (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0x1f300 && code <= 0x1f9ff);
    total += wide ? 2 : 1;
  }
  return total;
}
const pad = (text, size) => text + ' '.repeat(Math.max(0, size - width(text)));

const BANNER = [
  '███╗   ██╗ █████╗ ███████╗',
  '████╗  ██║██╔══██╗██╔════╝',
  '██╔██╗ ██║███████║███████╗',
  '██║╚██╗██║██╔══██║╚════██║',
  '██║ ╚████║██║  ██║███████║',
  '╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝'
];
const BANNER_COLORS = ['38;5;51', '38;5;45', '38;5;39', '38;5;38', '38;5;44', '38;5;37'];

export function banner(subtitle = '') {
  if (plain) {
    console.log(`\n${bold('nas-deploy')} ${dim('· GitHub Actions -> Synology NAS')}`);
    if (subtitle) console.log(dim(`  ${subtitle}`));
    return;
  }
  const side = [
    '',
    `${bold('deploy')}${dim(`   GitHub Actions ${GLYPH.arrow} Synology NAS`)}`,
    '',
    subtitle ? dim(subtitle) : '',
    '',
    dim('명령 뒤에 --help 를 붙이면 설명이 나옵니다')
  ];
  console.log();
  BANNER.forEach((line, index) => {
    const tail = side[index] ? `   ${side[index]}` : '';
    console.log(`  ${s(BANNER_COLORS[index], line)}${tail}`);
  });
}

export const heading = (text) => console.log(`\n${brand(GLYPH.bar)} ${bold(text)}`);
export const okItem = (text, extra = '') => console.log(`  ${green(GLYPH.ok)} ${text}${extra ? dim(`  ${extra}`) : ''}`);
export const badItem = (text, extra = '') => console.log(`  ${red(GLYPH.bad)} ${text}${extra ? dim(`  ${extra}`) : ''}`);
export const warnItem = (text, extra = '') => console.log(`  ${yellow(GLYPH.warn)} ${text}${extra ? dim(`  ${extra}`) : ''}`);
export const skipItem = (text, extra = '') => console.log(`  ${dim(GLYPH.skip)} ${dim(text)}${extra ? dim(`  ${extra}`) : ''}`);
export const fixHint = (text) => console.log(`     ${dim('해결 방법:')} ${text}`);
export const note = (text) => console.log(`     ${dim(text)}`);
export const step = (text) => console.log(`\n${cyan(GLYPH.arrow)} ${bold(text)}`);
export const detail = (text) => console.log(`  ${dim(text)}`);
export const blank = () => console.log();

export function panel(head, lines, colorFn = brand) {
  const inner = Math.max(width(head) + 2, ...lines.map((line) => width(line) + 2));
  console.log(`\n${colorFn(GLYPH.tl + GLYPH.h)} ${bold(head)} ${colorFn(GLYPH.h.repeat(Math.max(1, inner - width(head) - 1)) + GLYPH.tr)}`);
  for (const line of lines) console.log(`${colorFn(GLYPH.v)} ${pad(line, inner)} ${colorFn(GLYPH.v)}`);
  console.log(colorFn(GLYPH.bl + GLYPH.h.repeat(inner + 2) + GLYPH.br));
}

export async function ask(rl, question, fallback = '') {
  const answer = (await rl.question(`  ${cyan('?')} ${question}${fallback ? dim(` [${fallback}]`) : ''} `)).trim();
  return answer || fallback;
}

export async function confirm(rl, question, fallback = true) {
  const answer = (await rl.question(`  ${cyan('?')} ${question} ${dim(fallback ? '(Y/n)' : '(y/N)')} `)).trim().toLowerCase();
  if (!answer) return fallback;
  return answer.startsWith('y');
}
