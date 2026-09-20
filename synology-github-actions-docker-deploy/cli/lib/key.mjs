// key - 배포 전용 열쇠를 만들고 NAS 배포 계정에 등록합니다.
import fs from 'node:fs';
import path from 'node:path';
import { askNasPassword } from './ask.mjs';
import {
  ZERO_TAG, capture, deployKeyProbe, keyPathOf, knownHostsPath, loadConfig, nasDir, remote, run, shellQuote, usesAdminKey
} from './core.mjs';
import { badItem, bold, confirm, cyan, detail, dim, heading, note, okItem, panel, skipItem, warnItem } from './ui.mjs';

const authorizedLine = (config, publicKey) =>
  `restrict,command="${nasDir(config)}/bin/deploy-gate.sh" ${publicKey.replace(/\r/g, '').trim()}`;

export function keySummary(config) {
  return [
    `비밀 열쇠: ${keyPathOf(config)}`,
    `NAS 배포 계정: ${config.nas.deployUser} (${config.nas.host}:${config.nas.port})`
  ].join('\n');
}

function ensureKeyPair(config) {
  const keyPath = keyPathOf(config);
  if (fs.existsSync(keyPath)) {
    okItem('열쇠 파일이 이미 있습니다', keyPath);
    return keyPath;
  }
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  detail('배포 전용 열쇠를 새로 만듭니다. 다른 용도로는 쓰지 않습니다.');
  detail('암호(passphrase)는 넣지 않습니다. GitHub이 자동 접속할 때 암호를 입력할 수 없기 때문입니다.');
  run('ssh-keygen', ['-t', 'ed25519', '-a', '100', '-C', `github-actions@${config.project}`, '-f', keyPath, '-N', '']);
  okItem('열쇠를 만들었습니다', keyPath);
  return keyPath;
}

// NAS가 접속할 때 보여 주는 신분증(호스트 키)을 저장해 둡니다. 가짜 서버 접속을 막아 줍니다.
function saveKnownHosts(config, hostKey) {
  const file = knownHostsPath(config);
  fs.writeFileSync(file, `[${config.nas.host}]:${config.nas.port} ${hostKey}\n`);
  okItem('NAS 신분증을 저장했습니다', file);

  const scanned = capture('ssh-keyscan', ['-p', String(config.nas.port), '-t', 'ed25519', config.nas.host]);
  const scannedKey = scanned.out.split('\n').map((row) => row.trim()).filter((row) => row && !row.startsWith('#'))
    .map((row) => row.split(' ').slice(1).join(' '))[0];
  if (!scannedKey) warnItem('바깥에서는 신분증을 확인하지 못했습니다', '내부망에서만 접속되는 상태일 수 있습니다');
  else if (scannedKey.trim() === hostKey.trim()) okItem('NAS에서 읽은 신분증과 바깥에서 본 신분증이 같습니다');
  else {
    badItem('신분증이 서로 다릅니다. 중간에 다른 서버가 끼어들었을 수 있습니다');
    note('원인을 확인하기 전에는 다음 단계로 넘어가지 마세요.');
  }
  return file;
}

export async function keyCommand(rl) {
  const config = loadConfig();
  panel('key - 배포용 열쇠 만들기', [
    '1) 내 컴퓨터에 열쇠 한 쌍을 만듭니다 (비밀 열쇠 / 공개 열쇠)',
    `2) 공개 열쇠를 NAS의 ${config.nas.deployUser} 계정에 등록합니다`,
    '3) 이 열쇠로는 배포 명령 하나만 실행되도록 잠급니다',
    '',
    ...keySummary(config).split('\n'),
    usesAdminKey(config) ? '접속: 등록된 관리자 열쇠 사용 (SSH 비밀번호 없음)' : `접속: ${config.nas.adminUser}@${config.nas.host}`
  ]);

  heading('내 컴퓨터');
  const keyPath = ensureKeyPair(config);
  const publicKey = fs.readFileSync(`${keyPath}.pub`, 'utf8');
  const line = authorizedLine(config, publicKey);
  detail('NAS에 등록할 내용 (앞부분만 표시):');
  console.log(`  ${dim(line.slice(0, 96))}${line.length > 96 ? dim(' ...') : ''}`);

  heading('NAS에 등록');
  if (!(await confirm(rl, `${config.nas.deployUser} 계정에 등록할까요?`, true))) {
    skipItem('등록을 건너뛰었습니다');
    return;
  }
  const password = await askNasPassword(rl, config, { reason: '배포 계정의 열쇠 파일을 만들기 위해' });
  const home = `/var/services/homes/${config.nas.deployUser}`;
  const script = [
    'set -e',
    `sudo mkdir -p ${home}/.ssh`,
    `sudo touch ${home}/.ssh/authorized_keys`,
    `sudo grep -v ${shellQuote(`github-actions@${config.project}`)} ${home}/.ssh/authorized_keys > /tmp/nas_deploy_ak 2>/dev/null || true`,
    `printf '%s\\n' ${shellQuote(line)} >> /tmp/nas_deploy_ak`,
    `sudo install -o ${config.nas.deployUser} -g users -m 600 /tmp/nas_deploy_ak ${home}/.ssh/authorized_keys`,
    'rm -f /tmp/nas_deploy_ak',
    `sudo chown -R ${config.nas.deployUser}:users ${home}/.ssh`,
    `sudo chmod 755 ${home}`,
    `sudo chmod 700 ${home}/.ssh`,
    `if sudo -u ${config.nas.deployUser} cat ${home}/.ssh/authorized_keys >/dev/null 2>&1; then echo READ=ok; else echo READ=denied; fi`,
    `echo "HOSTKEY=$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"`
  ].join('\n');
  const { out } = remote(config, script, { password, root: true });

  if (/READ=ok/.test(out)) okItem('배포 계정이 자기 열쇠 파일을 읽을 수 있습니다');
  else {
    badItem('배포 계정이 열쇠 파일을 읽지 못합니다');
    note('DSM → 제어판 → 사용자 및 그룹 → 배포 계정 → 권한 탭에서');
    note('"homes" 공유 폴더의 "액세스 불가" 체크를 해제하세요. 폴더 권한이 파일 권한보다 우선합니다.');
  }
  const hostKey = /HOSTKEY=(.+)/.exec(out)?.[1]?.trim();
  if (hostKey) saveKnownHosts(config, hostKey);

  heading('접속 시험');
  detail('열쇠로 접속했을 때 명령이 제대로 막히는지 확인합니다. 비밀번호는 묻지 않습니다.');
  const shellTry = deployKeyProbe(config, 'whoami');
  const shellMessage = `${shellTry.out}\n${shellTry.err}`;
  if (shellMessage.includes('rejected request')) okItem('열쇠로는 명령창을 열 수 없습니다', '정상입니다');
  else if (shellMessage.includes('Permission denied')) {
    badItem('열쇠 접속이 거부되었습니다');
    note('위의 homes 폴더 권한 안내를 먼저 확인하세요.');
  } else if (shellMessage.includes('deploy-gate.sh')) warnItem('아직 NAS에 배포 스크립트가 없습니다', 'nas-deploy nas 를 실행하면 해결됩니다');
  else {
    warnItem('예상과 다른 결과입니다');
    note(shellMessage.trim().split('\n').slice(0, 2).join(' / '));
  }

  const deployTry = deployKeyProbe(config, `deploy ${ZERO_TAG}`);
  const deployMessage = `${deployTry.out}\n${deployTry.err}`;
  if (deployMessage.includes('credentials were not provided')) okItem('배포 명령이 NAS의 배포 스크립트까지 전달됩니다');
  else if (deployMessage.includes('password is required')) warnItem('배포 스크립트 실행 권한 규칙이 아직 없습니다', 'nas-deploy nas 에서 만들어 줍니다');
  else skipItem('배포 명령 시험은 nas 단계 뒤에 다시 확인하세요');

  panel('다음에 할 일', [
    `${bold('nas-deploy nas')}      ${dim('NAS에 배포 스크립트와 권한 규칙을 설치합니다')}`,
    `${bold('nas-deploy secrets')}  ${dim('GitHub에 접속 정보를 등록합니다')}`,
    '',
    `${cyan('※')} 비밀 열쇠(${keyPath})는 첫 배포가 성공한 뒤에 지우면 됩니다.`
  ]);
}
