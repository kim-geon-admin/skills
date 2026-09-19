import { promptNasPassword } from './ask.mjs';
import { loadConfig } from './core.mjs';
import { createPasswordSession, normalizePasswordMode, withPasswordSession } from './password.mjs';
import { prepareCommand } from './prepare.mjs';
import { keyCommand } from './key.mjs';
import { nasCommand } from './nas.mjs';
import { secretsCommand } from './secrets.mjs';
import { doctorCommand } from './doctor.mjs';
import { confirm, detail, note, panel, skipItem } from './ui.mjs';

const STEPS = [
  ['prepare', 'NAS 준비 상태 확인', prepareCommand],
  ['key', '배포용 키 생성·등록', keyCommand],
  ['nas', 'NAS 배포 파일 설치', nasCommand],
  ['secrets', 'GitHub Secret 등록', secretsCommand],
  ['doctor', '최종 상태 점검', (rl) => doctorCommand(rl)]
];

export async function sessionCommand(rl) {
  const config = loadConfig();
  if (normalizePasswordMode(config.nas?.passwordMode) !== 'temporary') {
    panel('session - 임시 비밀번호 세션', [
      '현재 init 설정이 매번 입력(prompt) 모드입니다.',
      '반복 입력을 줄이려면 먼저 "nas-deploy init"에서 temporary를 선택하세요.'
    ]);
    return;
  }

  panel('session - 한 번 입력하고 전체 작업 진행', [
    'DSM 비밀번호는 Windows 사용자 계정에 묶인 DPAPI 임시 파일에 저장됩니다.',
    '이 세션이 끝나면 성공·실패와 관계없이 임시 파일을 삭제합니다.',
    'gh-deploy 계정이나 GitHub Secret에는 DSM 비밀번호를 저장하지 않습니다.'
  ]);
  detail('각 단계는 실행 전에 확인하며, 취소한 단계는 건너뜁니다.');

  const session = createPasswordSession({
    prompt: () => promptNasPassword(rl, config, { reason: '자동 작업 세션을 시작하기 위해' })
  });
  await withPasswordSession(session, async () => {
    for (const [name, label, command] of STEPS) {
      if (await confirm(rl, `${name}: ${label}을(를) 실행할까요?`, true)) await command(rl);
      else skipItem(`${name} 단계를 건너뛰었습니다`);
    }
  });
  note('자동 작업 세션이 끝났고 임시 비밀번호 파일을 폐기했습니다.');
}
