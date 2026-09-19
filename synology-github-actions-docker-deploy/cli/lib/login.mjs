// login - NAS 관리자 계정에 이 컴퓨터의 열쇠를 등록해, 이후 비밀번호 입력을 줄입니다.
import fs from 'node:fs';
import path from 'node:path';
import { adminKeyPath, loadConfig, remote, run, saveConfig, shellQuote, usesAdminKey } from './core.mjs';
import { badItem, bold, confirm, detail, dim, heading, note, okItem, panel, skipItem, warnItem } from './ui.mjs';

export async function loginCommand(rl) {
  const config = loadConfig();
  panel('login - NAS 접속 비밀번호 줄이기', [
    '이 컴퓨터에 열쇠를 하나 만들어 NAS 관리자 계정에 등록합니다.',
    '등록하면 이후 명령에서 SSH 비밀번호를 묻지 않습니다.',
    '',
    `${dim('다만 NAS 관리자 권한으로 접속할 수 있는 열쇠이므로, 공용 컴퓨터에서는 권하지 않습니다.')}`,
    `${dim('관리자 권한 작업(sudo)에는 여전히 비밀번호를 한 번 물어봅니다. 비밀번호는 저장하지 않습니다.')}`
  ]);

  if (usesAdminKey(config)) {
    const check = remote(config, 'echo connected');
    if (check.out.includes('connected')) {
      okItem('이미 열쇠로 접속되고 있습니다', adminKeyPath(config));
      return;
    }
    warnItem('등록된 열쇠로 접속되지 않습니다. 다시 등록합니다.');
  }

  if (!(await confirm(rl, '이 컴퓨터에 관리자 접속 열쇠를 만들고 등록할까요?', true))) {
    skipItem('취소했습니다. 앞으로도 접속할 때마다 비밀번호를 입력하면 됩니다.');
    return;
  }

  const keyPath = adminKeyPath(config);
  if (!fs.existsSync(keyPath)) {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    run('ssh-keygen', ['-t', 'ed25519', '-a', '100', '-C', `nas-deploy@${config.project}`, '-f', keyPath, '-N', '']);
    okItem('열쇠를 만들었습니다', keyPath);
  } else {
    okItem('열쇠가 이미 있습니다', keyPath);
  }

  const publicKey = fs.readFileSync(`${keyPath}.pub`, 'utf8').replace(/\r/g, '').trim();
  heading('NAS에 등록');
  detail('DSM 관리자 비밀번호를 한 번 입력하면 등록이 끝납니다. 이 비밀번호는 터미널이 직접 받습니다.');
  const script = [
    'set -e',
    'mkdir -p ~/.ssh',
    'touch ~/.ssh/authorized_keys',
    `grep -v ${shellQuote(`nas-deploy@${config.project}`)} ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.new || true`,
    `printf '%s\\n' ${shellQuote(publicKey)} >> ~/.ssh/authorized_keys.new`,
    'mv ~/.ssh/authorized_keys.new ~/.ssh/authorized_keys',
    'chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys',
    'chmod 755 ~ 2>/dev/null || true',
    'echo REGISTERED'
  ].join('\n');
  const result = remote({ ...config, nas: { ...config.nas, adminKey: null } }, script, { interactive: true });
  if (result.code !== 0) {
    badItem('등록에 실패했습니다');
    note('비밀번호가 맞는지, NAS 주소와 포트가 맞는지 확인해 주세요.');
    return;
  }

  config.nas.adminKey = `~/.ssh/${path.basename(keyPath)}`;
  saveConfig(config);

  const verify = remote(config, 'echo connected');
  if (verify.out.includes('connected')) {
    okItem('이제 비밀번호 없이 NAS에 접속합니다');
    note(`더 이상 쓰지 않으려면 NAS의 ~/.ssh/authorized_keys 에서 "nas-deploy@${config.project}" 줄을 지우고, ${keyPath} 파일을 삭제하세요.`);
  } else {
    warnItem('열쇠 접속이 아직 되지 않습니다');
    note('DSM 제어판 → 사용자 및 그룹 → 고급에서 "사용자 홈 서비스"가 켜져 있는지 확인해 주세요.');
  }
}
