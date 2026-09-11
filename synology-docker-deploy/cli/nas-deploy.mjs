#!/usr/bin/env node
// nas-deploy - GitHub Actions에서 Synology NAS로 배포하는 환경을 만들고 운영하는 도구.
// synology-docker-deploy 스킬의 일부입니다. Node 20 이상, 추가 설치 없이 동작합니다.
// 모든 명령은 여러 번 실행해도 안전하며, 비밀번호는 저장하지 않습니다.
import { createInterface } from 'node:readline/promises';
import { UserError, loadConfig } from './lib/core.mjs';
import { GLYPH, banner, bold, cyan, dim, panel, red } from './lib/ui.mjs';
import { initCommand } from './lib/init.mjs';
import { loginCommand } from './lib/login.mjs';
import { keyCommand } from './lib/key.mjs';
import { nasCommand } from './lib/nas.mjs';
import { secretsCommand } from './lib/secrets.mjs';
import { envCommand } from './lib/env.mjs';
import { doctorCommand } from './lib/doctor.mjs';
import { statusCommand } from './lib/status.mjs';

const COMMANDS = [
  ['init', '저장소에 배포용 파일을 만듭니다', '질문에 답하면 워크플로, compose, 배포 스크립트가 생성됩니다. 내 컴퓨터에만 저장됩니다.'],
  ['login', 'NAS 접속 비밀번호 입력을 줄입니다', '이 컴퓨터의 열쇠를 NAS 관리자 계정에 등록합니다. 선택 사항입니다.'],
  ['key', '배포용 열쇠를 만들어 NAS에 등록합니다', '이 열쇠로는 배포 명령 하나만 실행할 수 있습니다.'],
  ['nas', 'NAS에 배포 스크립트와 권한을 설치합니다', '파일 전송, 소유자 설정, 권한 규칙까지 한 번에 처리합니다.'],
  ['secrets', 'GitHub에 NAS 접속 정보를 등록합니다', '5개 값을 등록합니다. 레지스트리 비밀번호는 필요 없습니다.'],
  ['doctor', '배포 준비 상태를 점검합니다', '문제가 있으면 원인과 해결 방법을 알려 줍니다. 아무것도 바꾸지 않습니다.'],
  ['env', '설정 파일(.env)을 NAS에 반영합니다', '줄바꿈 문자를 정리해 올리고, 원하면 재배포까지 실행합니다.'],
  ['status', '최근 배포 결과와 NAS 상태를 봅니다', '실행 기록, 배포된 버전, 컨테이너 상태, 마지막 배포 기록을 보여 줍니다.']
];

function usage() {
  banner();
  const config = loadConfig({ required: false });
  console.log(`\n  ${bold('사용법')}  node nas-deploy.mjs <명령> [--skip-nas]`);
  console.log(`  ${dim('저장소 폴더 안에서 실행합니다. 프로젝트마다 그 폴더에서 같은 명령을 쓰면 됩니다.')}`);
  console.log(config
    ? `  ${dim(`현재 폴더 설정: ${config.project} ${GLYPH.arrow} ${config.nas?.host ?? ''}`)}\n`
    : `  ${dim('이 폴더에는 아직 설정이 없습니다. init 으로 시작하세요.')}\n`);
  for (const [name, summary, description] of COMMANDS) {
    console.log(`  ${cyan(name.padEnd(8))} ${summary}`);
    console.log(`           ${dim(description)}`);
  }
  panel('처음이라면 이 순서로', [
    `1. ${bold('init')}     ${dim('파일 만들기')}`,
    `2. ${bold('login')}    ${dim('(선택) 비밀번호 입력 줄이기')}`,
    `3. ${bold('key')}      ${dim('열쇠 만들고 NAS에 등록')}`,
    `4. ${bold('nas')}      ${dim('NAS에 설치')}`,
    `5. ${bold('secrets')}  ${dim('GitHub에 등록')}`,
    `6. ${bold('doctor')}   ${dim('점검 후 커밋·푸시하면 첫 배포 시작')}`,
    '',
    `${dim('DSM 웹에서 직접 해야 하는 것: 배포 계정 만들기, 공유 폴더 권한, 역방향 프록시, 공유기 포트 열기')}`
  ]);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const fromIndex = rest.indexOf('--from');
  const options = {
    skipNas: rest.includes('--skip-nas'),
    yes: rest.includes('--yes'),
    from: fromIndex >= 0 ? rest[fromIndex + 1] : null
  };
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    usage();
    return;
  }
  const known = COMMANDS.find(([name]) => name === command);
  if (!known) {
    console.log(`\n  ${red('모르는 명령입니다:')} ${command}`);
    usage();
    process.exitCode = 1;
    return;
  }
  if (rest.includes('--help')) {
    banner();
    panel(`${command} - ${known[1]}`, [known[2]]);
    return;
  }

  banner();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (command === 'init') await initCommand(rl, options);
    else if (command === 'login') await loginCommand(rl);
    else if (command === 'key') await keyCommand(rl);
    else if (command === 'nas') await nasCommand(rl);
    else if (command === 'secrets') await secretsCommand(rl);
    else if (command === 'doctor') await doctorCommand(rl, options);
    else if (command === 'env') await envCommand(rl);
    else if (command === 'status') await statusCommand(rl, options);
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.log();
  if (error instanceof UserError) {
    console.log(`  ${red('문제가 생겼습니다')}`);
    for (const line of String(error.message).split('\n')) console.log(`  ${line}`);
  } else {
    console.log(`  ${red('예상하지 못한 오류입니다')}`);
    console.log(`  ${error?.stack ?? error}`);
  }
  console.log(`\n  ${dim('도움말: node nas-deploy.mjs help')}`);
  process.exitCode = 1;
});
