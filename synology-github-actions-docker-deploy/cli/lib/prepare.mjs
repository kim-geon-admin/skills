// prepare - DSM 웹에서 먼저 해 두어야 하는 준비를 안내하고, 실제로 됐는지 확인합니다.
// 계정 만들기나 공유 폴더 권한은 DSM 화면에서만 할 수 있어서 CLI가 대신하지 못합니다.
import { askNasPassword } from './ask.mjs';
import { loadConfig, nasDir, remote, usesAdminKey } from './core.mjs';
import { badItem, bold, confirm, cyan, detail, dim, heading, note, okItem, panel, skipItem, warnItem } from './ui.mjs';

export function deploymentAccountState(values) {
  if (values.USER === 'missing') return 'missing';
  const shellReady = Boolean(values.SHELL) && !values.SHELL.includes('nologin');
  const ready = values.USER === 'ok' && values.GROUP === 'ok' && shellReady
    && values.HOME === 'ok' && values.HOMEACCESS === 'ok' && values.DOCKERSHARE === 'ok';
  return ready ? 'ready' : 'incomplete';
}

export function deploymentAccountGuide(config) {
  return [
    'DSM 화면에서 배포 전용 계정을 확인하거나 만들어 주세요.',
    `제어판 → 사용자 및 그룹 → 사용자 생성 → 이름 ${config.nas.deployUser}`,
    '그룹: administrators, 사용자 홈 서비스: 활성화',
    '권한: homes 액세스 불가 해제, 배포 폴더가 포함된 공유 폴더는 읽기 전용 권한'
  ].join('\n');
}

function guide(config) {
  const dir = nasDir(config);
  panel('prepare - NAS 준비 상태 확인', [
    `배포 계정: ${config.nas.deployUser}   ${dim(`설치 폴더 ${dir}`)}`,
    '',
    'DSM 화면에서 먼저 해 두어야 하는 것이 있습니다. 아래를 마친 뒤 확인을 진행합니다.'
  ]);

  heading('DSM 웹에서 할 일');
  detail('1) 패키지 센터 → Container Manager 설치');
  detail('2) 제어판 → 터미널 및 SNMP → SSH 서비스 활성화 (포트 ' + config.nas.port + ')');
  detail('3) 제어판 → 사용자 및 그룹 → 고급 → "사용자 홈 서비스 활성화" 체크');
  detail(`4) 제어판 → 사용자 및 그룹 → 생성 → 이름 ${config.nas.deployUser}`);
  detail('   · 비밀번호: 32자 이상 무작위 (평소 쓰지 않는 계정입니다)');
  detail('   · 그룹: administrators 체크 (DSM 7은 관리자만 SSH 로그인이 됩니다)');
  detail('   · 권한 탭: "homes" 는 액세스 불가 체크 해제(빈칸), "docker" 는 읽기 전용, 나머지는 액세스 불가');
  detail('5) 제어판 → 보안 → 보호 → 자동 차단 활성화');
  detail('6) 공유기에서 SSH 포트를 NAS로 포워딩');
  note('공유 폴더 권한은 Synology 고유 규칙이라 파일 권한보다 우선합니다. homes 가 막히면 열쇠 로그인이 안 되고,');
  note('docker 가 막히면 배포 명령이 Permission denied 로 막힙니다.');
}

export async function prepareCommand(rl) {
  const config = loadConfig();
  const dir = nasDir(config);
  const user = config.nas.deployUser;
  guide(config);

  if (!(await confirm(rl, '위 준비를 마쳤나요? 지금 NAS에 접속해 확인할까요?', true))) {
    note('준비가 끝나면 다시 "nas-deploy prepare" 를 실행해 주세요.');
    return;
  }
  if (!usesAdminKey(config)) detail('"nas-deploy login" 을 해 두면 다음부터 SSH 비밀번호를 묻지 않습니다.');
  const password = await askNasPassword(rl, config, { reason: '계정과 폴더 권한을 확인하기 위해' });

  const parent = dir.split('/').slice(0, -1).join('/') || '/volume1/docker';
  const home = `/var/services/homes/${user}`;
  const script = [
    `echo "USER=$(id ${user} >/dev/null 2>&1 && echo ok || echo missing)"`,
    `echo "GROUP=$(id -nG ${user} 2>/dev/null | grep -qw administrators && echo ok || echo no)"`,
    `echo "SHELL=$(getent passwd ${user} 2>/dev/null | awk -F: '{print $NF}')"`,
    `echo "HOME=$([ -d ${home} ] && echo ok || echo missing)"`,
    `echo "HOMEACCESS=$(sudo -u ${user} ls ${home} >/dev/null 2>&1 && echo ok || echo denied)"`,
    `echo "DOCKERSHARE=$(sudo -u ${user} ls ${parent} >/dev/null 2>&1 && echo ok || echo denied)"`,
    'echo "COMPOSE=$(sudo docker compose version >/dev/null 2>&1 && echo ok || echo missing)"',
    'echo "SUDOERSDIR=$(sudo grep -c includedir /etc/sudoers 2>/dev/null || echo 0)"',
    'echo "DRI=$(ls /dev/dri >/dev/null 2>&1 && echo ok || echo none)"',
    `echo "DISK=$(df -Pm ${parent} 2>/dev/null | awk 'NR==2{print $4}')"`
  ].join('\n');

  heading('확인 결과');
  const probe = () => remote(config, script, { password, root: true });
  const parseValues = (out) => Object.fromEntries(
    ['USER', 'GROUP', 'SHELL', 'HOME', 'HOMEACCESS', 'DOCKERSHARE', 'COMPOSE', 'SUDOERSDIR', 'DRI', 'DISK']
      .map((name) => [name, new RegExp(`${name}=(\\S*)`).exec(out)?.[1] ?? ''])
  );
  let values = parseValues(probe().out);
  let accountState = deploymentAccountState(values);
  if (accountState === 'missing') {
    badItem(`배포 계정 ${user} 이(가) 없습니다`);
    note(deploymentAccountGuide(config).split('\n').join(' / '));
    if (!(await confirm(rl, `DSM에서 ${user} 계정을 만든 뒤 다시 검사할까요?`, true))) {
      note('계정 생성 후 다시 "nas-deploy prepare" 를 실행해 주세요.');
      return;
    }
    values = parseValues(probe().out);
    accountState = deploymentAccountState(values);
    if (accountState !== 'ready') {
      panel('배포 계정 재확인 실패', [
        `${user} 계정이 아직 배포에 필요한 상태가 아닙니다.`,
        'DSM에서 계정과 권한을 확인한 뒤 다시 실행해 주세요.'
      ]);
      return;
    }
  }
  if (accountState === 'ready' && !(await confirm(rl, `기존 배포 계정 ${user}를 사용하시겠습니까?`, true))) {
    note(`다른 계정을 사용하려면 "nas-deploy init" 에서 배포 전용 계정 이름을 바꾼 뒤 다시 실행해 주세요.`);
    return;
  }
  const value = (name) => values[name] ?? '';
  const problems = [];
  const fail = (text, advice) => { badItem(text); if (advice) note(advice); problems.push(text); };

  if (value('USER') === 'ok') okItem(`배포 계정 ${user} 있음`);
  else fail(`배포 계정 ${user} 이(가) 없습니다`, 'DSM → 제어판 → 사용자 및 그룹 → 생성 에서 만들어 주세요.');

  if (value('GROUP') === 'ok') okItem('administrators 그룹 소속');
  else fail('administrators 그룹이 아닙니다', 'DSM 7은 관리자 그룹만 SSH 로그인이 됩니다. 계정 편집에서 체크해 주세요.');

  const shell = value('SHELL');
  if (shell && !shell.includes('nologin')) okItem('SSH 로그인 가능한 계정', shell);
  else if (shell) fail('이 계정은 SSH 로그인이 막혀 있습니다', 'administrators 그룹에 넣으면 로그인 셸이 생깁니다.');

  if (value('HOME') === 'ok') okItem('홈 폴더 있음', home);
  else fail('홈 폴더가 없습니다', '제어판 → 사용자 및 그룹 → 고급에서 "사용자 홈 서비스"를 켜 주세요.');

  if (value('HOMEACCESS') === 'ok') okItem('배포 계정이 자기 홈 폴더에 접근할 수 있습니다');
  else fail('배포 계정이 자기 홈 폴더에 접근하지 못합니다', '계정 편집 → 권한 탭에서 "homes" 의 액세스 불가 체크를 해제하세요.');

  if (value('DOCKERSHARE') === 'ok') okItem('배포 계정이 docker 폴더를 읽을 수 있습니다');
  else fail('배포 계정이 docker 폴더를 읽지 못합니다', '계정 편집 → 권한 탭에서 "docker" 를 읽기 전용으로 바꿔 주세요.');

  if (value('COMPOSE') === 'ok') okItem('docker compose 사용 가능');
  else fail('docker compose 를 찾을 수 없습니다', '패키지 센터에서 Container Manager 설치와 실행 상태를 확인하세요.');

  if (Number(value('SUDOERSDIR')) > 0) okItem('권한 규칙 폴더(/etc/sudoers.d) 사용 가능');
  else fail('/etc/sudoers 에 includedir 줄이 없습니다', 'DSM 버전에 따라 다릅니다. 이 경우 알려 주시면 다른 방법을 안내합니다.');

  const disk = Number(value('DISK') || 0);
  if (disk >= 3072) okItem(`디스크 여유 ${(disk / 1024).toFixed(1)}GB`);
  else if (disk) warnItem(`디스크 여유가 적습니다 (${(disk / 1024).toFixed(1)}GB)`, '배포는 3GB 미만이면 중단됩니다');
  if (value('DRI') === 'none') skipItem('/dev/dri 없음', '하드웨어 가속을 쓰는 서비스가 있으면 compose 의 devices 를 빼야 합니다');
  else okItem('/dev/dri 있음', '하드웨어 가속 사용 가능');

  if (problems.length) {
    panel('아직 남은 것', [...problems.map((text) => `${dim('-')} ${text}`), '', 'DSM에서 고친 뒤 다시 실행해 주세요.']);
    return;
  }
  panel('준비 완료 - 다음에 할 일', [
    `${bold('nas-deploy key')}      ${dim('배포용 열쇠를 만들어 NAS에 등록')}`,
    `${bold('nas-deploy nas')}      ${dim('NAS에 배포 스크립트 설치')}`,
    `${bold('nas-deploy secrets')}  ${dim('GitHub에 접속 정보 등록')}`
  ]);
}
