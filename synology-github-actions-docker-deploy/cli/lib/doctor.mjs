// doctor - 배포에 필요한 것들이 제대로 준비됐는지 한 번에 점검합니다.
import fs from 'node:fs';
import { askNasPassword } from './ask.mjs';
import {
  COMPOSE_PATH, CONFIG_PATH, DEPLOY_SCRIPT_PATH, ENV_PATH, GATE_SCRIPT_PATH, SECRET_NAMES, WORKFLOW_PATH, ZERO_TAG,
  capture, deployKeyProbe, has, keyPathOf, knownHostsPath, loadConfig, nasDir, readIfExists, remote, usesAdminKey
} from './core.mjs';
import { githubState } from './github.mjs';
import { repoViewArgs, secretListArgs } from './secrets.mjs';
import { badItem, bold, cyan, detail, dim, heading, note, okItem, panel, skipItem, warnItem } from './ui.mjs';

export function buildNasDoctorScript(config) {
  const dir = nasDir(config);
  return [
    `if /usr/local/bin/docker-compose version >/dev/null 2>&1; then echo "COMPOSE=ok"; elif /usr/local/bin/docker compose version >/dev/null 2>&1; then echo "COMPOSE=ok"; else echo "COMPOSE=missing"; fi`,
    `echo "DRI=$(ls /dev/dri >/dev/null 2>&1 && echo ok || echo none)"`,
    `echo "GATE=$(stat -c %a ${dir}/bin/deploy-gate.sh 2>/dev/null || echo none)"`,
    `echo "SCRIPT=$(stat -c %a ${dir}/bin/deploy.sh 2>/dev/null || echo none)"`,
    `echo "COMPOSEFILE=$(stat -c %a ${dir}/compose.yaml 2>/dev/null || echo none)"`,
    `echo "ENVMODE=$(sudo -n stat -c %a ${dir}/.env 2>/dev/null || echo none)"`,
    `echo "ENVCTRL=$(sudo -n grep -c "$(printf '\\033')" ${dir}/.env 2>/dev/null || echo 0)"`,
    `echo "SUDO=$(sudo -n -l -U ${config.nas.deployUser} 2>/dev/null | grep -c ${JSON.stringify(`${dir}/bin/deploy.sh`)})"`,
    `echo "DISK=$(df -Pm ${dir} 2>/dev/null | awk 'NR==2{print $4}')"`,
    `echo "CURRENT=$(sudo -n cat ${dir}/state/current-tag 2>/dev/null || echo none)"`,
    `echo "RUNNING=$(sudo -n /usr/local/bin/docker ps --filter "label=com.docker.compose.project=${config.project}" -q 2>/dev/null | wc -l)"`
  ].join('\n');
}

export async function doctorCommand(rl, options = {}) {
  const config = loadConfig();
  const dir = nasDir(config);
  const problems = [];
  const advices = [];
  const fail = (text, extra, advice) => { badItem(text, extra); if (advice) note(advice); problems.push(text); };
  const soft = (text, extra, advice) => { warnItem(text, extra); if (advice) note(advice); advices.push(text); };

  panel('doctor - 배포 준비 상태 점검', [
    `프로젝트: ${config.project}   ${dim(`이미지 ghcr.io/${config.owner}/${config.project}-*`)}`,
    `NAS:      ${config.nas.host}:${config.nas.port}  ${dim(`배포 계정 ${config.nas.deployUser}`)}`,
    '',
    '읽기만 하고 아무것도 바꾸지 않습니다.'
  ]);

  heading('1. 내 컴퓨터');
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor >= 20) okItem(`Node ${process.versions.node}`);
  else fail(`Node 버전이 낮습니다 (${process.versions.node})`, '', 'Node 20 이상을 설치해 주세요.');
  for (const [command, label] of [['ssh', 'SSH 접속 명령'], ['ssh-keygen', '열쇠 만드는 명령']]) {
    if (has(command)) okItem(`${label} (${command})`);
    else fail(`${label}(${command})을 찾을 수 없습니다`, '', 'Git Bash에서 실행하거나 OpenSSH를 설치해 주세요.');
  }
  const github = githubState();
  if (!github.installed) soft('gh(GitHub 명령줄 도구)가 없습니다', '', 'Secret 등록과 상태 확인이 제한됩니다. https://cli.github.com');
  else if (github.loggedIn) {
    okItem('GitHub 로그인 상태', github.account ? `계정 ${github.account}` : '');
    if (!github.scopes.includes('workflow')) soft('토큰에 workflow 권한이 없습니다', '', '워크플로 파일 푸시가 거부되면 "nas-deploy secrets" 에서 권한을 추가할 수 있습니다.');
  } else fail('GitHub에 로그인되어 있지 않습니다', '', '"nas-deploy secrets" 를 실행하면 로그인 화면을 띄워 드립니다.');
  if (has('docker')) okItem('Docker (compose 파일 검사에 사용)');
  else skipItem('Docker 없음', 'compose 파일 문법 검사는 건너뜁니다');

  heading('2. 저장소 파일');
  for (const file of [CONFIG_PATH, WORKFLOW_PATH, COMPOSE_PATH, DEPLOY_SCRIPT_PATH, GATE_SCRIPT_PATH]) {
    if (fs.existsSync(file)) okItem(file);
    else fail(`${file} 없음`, '', '"nas-deploy init" 을 실행하면 만들어집니다.');
  }
  const envText = readIfExists(ENV_PATH);
  if (envText === null) soft(`${ENV_PATH} 없음`, '', '앱에 필요한 설정이 있다면 만들어 주세요.');
  else {
    okItem(ENV_PATH);
    if (/\r/.test(envText)) soft('.env 에 윈도우 줄바꿈이 있습니다', '', '"nas-deploy env" 로 올리면 자동으로 정리됩니다.');
  }
  const gitignore = readIfExists('.gitignore') ?? '';
  if (gitignore.includes('.env')) okItem('.env 가 git 제외 목록에 있습니다');
  else fail('.env 가 git 에 올라갈 수 있습니다', '', '.gitignore 에 ".env" 를 추가하세요.');
  const scriptText = readIfExists(DEPLOY_SCRIPT_PATH) ?? '';
  if (scriptText.includes('\r')) soft('deploy.sh 에 윈도우 줄바꿈이 있습니다', '', '.gitattributes 의 "*.sh eol=lf" 규칙을 확인하세요.');

  const status = capture('git', ['status', '--porcelain']);
  if (status.code === 0) {
    const changed = status.out.split('\n').filter(Boolean).length;
    if (changed === 0) okItem('커밋하지 않은 변경 없음');
    else soft(`커밋하지 않은 변경 ${changed}개`, '', '반쯤 커밋된 코드는 배포 전 테스트에서 걸립니다. git status 로 확인하세요.');
    const ahead = capture('git', ['rev-list', '--count', '@{u}..HEAD']);
    if (ahead.code === 0 && Number(ahead.out) > 0) soft(`아직 올리지 않은 커밋 ${ahead.out}개`, '', 'git push 하면 배포가 시작됩니다.');
  }

  heading('3. GitHub');
  if (has('gh')) {
    const repo = capture('gh', repoViewArgs(config));
    if (repo.code === 0) okItem('저장소', repo.out);
    const list = capture('gh', secretListArgs(config));
    const missing = SECRET_NAMES.filter((name) => !list.out.includes(name));
    if (!missing.length) okItem('접속 정보 5개가 모두 등록되어 있습니다');
    else fail(`등록되지 않은 값: ${missing.join(', ')}`, '', '"nas-deploy secrets" 를 실행하세요.');
    const runs = capture('gh', ['run', 'list', '--workflow', 'deploy.yml', '--limit', '1', '--json', 'conclusion,displayTitle', '--jq', '.[] | .conclusion + " " + .displayTitle']);
    if (runs.out.startsWith('success')) okItem('최근 배포 실행 성공', runs.out.replace('success ', ''));
    else if (runs.out) soft('최근 실행이 성공하지 않았습니다', runs.out, '"nas-deploy status" 또는 gh run view 로 원인을 확인하세요.');
  } else skipItem('gh 가 없어 GitHub 확인을 건너뜁니다');

  heading('4. 배포 열쇠');
  const keyPath = keyPathOf(config);
  if (fs.existsSync(keyPath)) okItem('비밀 열쇠 파일', keyPath);
  else soft('비밀 열쇠 파일이 없습니다', keyPath, '이미 GitHub에 등록했다면 정상입니다. 새로 만들려면 "nas-deploy key".');
  if (fs.existsSync(knownHostsPath(config))) okItem('NAS 신분증 파일', knownHostsPath(config));
  else soft('NAS 신분증 파일이 없습니다', '', '"nas-deploy key" 를 실행하면 만들어집니다.');

  const shellTry = deployKeyProbe(config, 'whoami');
  const shellMessage = `${shellTry.out}\n${shellTry.err}`;
  if (shellMessage.includes('rejected request')) okItem('열쇠로 명령창을 열 수 없습니다', '정상입니다');
  else if (shellMessage.includes('Permission denied')) fail('열쇠 접속이 거부됩니다', '', 'DSM에서 배포 계정의 "homes" 공유 폴더 권한이 "액세스 불가"인지 확인하세요.');
  else if (shellMessage.includes('No such file') || shellMessage.includes('deploy-gate.sh')) fail('NAS에 배포 스크립트가 없습니다', '', '"nas-deploy nas" 를 실행하세요.');
  else if (shellTry.code === 127) skipItem('열쇠가 없어 접속 시험을 건너뜁니다');
  else soft('접속 시험 결과가 예상과 다릅니다', shellMessage.trim().split('\n')[0]);

  const deployTry = deployKeyProbe(config, `deploy ${ZERO_TAG}`);
  const deployMessage = `${deployTry.out}\n${deployTry.err}`;
  if (deployMessage.includes('credentials were not provided')) okItem('배포 명령이 NAS 배포 스크립트까지 도달합니다');
  else if (deployMessage.includes('password is required')) fail('배포 스크립트를 관리자 권한으로 실행할 수 없습니다', '', '"nas-deploy nas" 를 다시 실행하세요.');
  else if (deployTry.code !== 127) skipItem('배포 명령 시험 결과', deployMessage.trim().split('\n')[0]);

  if (options.skipNas) {
    note('NAS 내부 점검은 --skip-nas 로 건너뛰었습니다.');
  } else {
    heading('5. NAS 내부');
    if (!usesAdminKey(config)) detail('"nas-deploy login" 을 해 두면 다음부터 SSH 비밀번호를 묻지 않습니다.');
    const password = await askNasPassword(rl, config, { reason: 'NAS 안의 파일과 권한을 확인하기 위해' });
    const script = buildNasDoctorScript(config);
    const { out } = remote(config, script, { password, root: true });
    const value = (name) => name === 'AKREAD'
      ? (shellMessage.includes('rejected request') ? 'ok' : 'denied')
      : new RegExp(`${name}=(\\S+)`).exec(out)?.[1];

    if (value('COMPOSE') === 'ok') okItem('docker compose 사용 가능');
    else fail('docker compose 를 찾을 수 없습니다', '', 'Container Manager 가 설치·실행 중인지 확인하세요.');
    if (value('GATE') === '755' && value('SCRIPT') === '700') okItem('배포 스크립트 설치됨', 'gate 755 / deploy 700');
    else fail('배포 스크립트가 없거나 권한이 다릅니다', `gate=${value('GATE')} deploy=${value('SCRIPT')}`, '"nas-deploy nas" 를 실행하세요.');
    if (value('COMPOSEFILE') !== 'none') okItem('compose 파일 설치됨');
    else fail('NAS에 compose 파일이 없습니다', '', '"nas-deploy nas" 를 실행하세요.');
    if (value('ENVMODE') === '600') okItem('.env 가 관리자만 읽도록 저장되어 있습니다');
    else if (value('ENVMODE') === 'none') soft('NAS에 .env 가 없습니다', '', '앱에 설정이 필요하면 "nas-deploy env" 로 올리세요.');
    else soft('.env 권한이 600이 아닙니다', `현재 ${value('ENVMODE')}`);
    if (value('ENVCTRL') !== '0') soft('.env 안에 이상한 제어문자가 있습니다', '', '"nas-deploy env" 로 다시 올리면 정리됩니다.');
    if (Number(value('SUDO') ?? 0) > 0) okItem('배포 계정 권한 규칙 있음');
    else fail('배포 계정 권한 규칙이 없습니다', '', '"nas-deploy nas" 를 실행하세요.');
    if (value('AKREAD') === 'ok') okItem('배포 계정이 자기 열쇠 파일을 읽을 수 있습니다');
    else fail('배포 계정이 열쇠 파일을 읽지 못합니다', '', 'DSM 제어판 → 사용자 및 그룹 → 배포 계정 → 권한에서 "homes" 액세스 불가를 해제하세요.');
    const disk = Number(value('DISK') ?? 0);
    if (disk >= 3072) okItem(`디스크 여유 ${(disk / 1024).toFixed(1)}GB`);
    else if (disk) fail(`디스크 여유가 부족합니다 (${(disk / 1024).toFixed(1)}GB)`, '', '배포 스크립트는 3GB 미만이면 중단됩니다.');
    if (value('DRI') === 'none') soft('/dev/dri 가 없습니다', '', 'compose 에 devices 설정이 있으면 지워야 컨테이너가 뜹니다.');
    const current = value('CURRENT');
    if (current && current !== 'none') okItem('배포된 버전', current.slice(0, 12));
    else skipItem('아직 배포된 적이 없습니다');
    const running = Number(value('RUNNING') ?? 0);
    if (running > 0) okItem(`실행 중인 컨테이너 ${running}개`);
    else skipItem('실행 중인 컨테이너 없음');
  }

  const summary = problems.length
    ? [`고쳐야 할 것 ${problems.length}개`, ...problems.map((text) => `  ${dim('-')} ${text}`)]
    : ['배포를 막는 문제는 없습니다.'];
  if (advices.length) summary.push('', `확인해 보면 좋은 것 ${advices.length}개`, ...advices.map((text) => `  ${dim('-')} ${text}`));
  panel(problems.length ? '점검 결과' : '점검 결과 - 준비 완료', summary, problems.length ? undefined : undefined);
  if (!problems.length) {
    note('아직 배포하지 않았다면 변경 사항을 커밋해서 올리면 배포가 시작됩니다.');
  }
}
