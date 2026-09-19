// nas - Install deployment scripts, compose, .env, and privilege rules on NAS.
import fs from 'node:fs';
import { askNasPassword } from './ask.mjs';
import {
  COMPOSE_PATH, DEPLOY_SCRIPT_PATH, ENV_PATH, GATE_SCRIPT_PATH, INSTALL_FAILED_MARK, UserError,
  filePayload, loadConfig, nasDir, readIfExists, remote, remoteStageFor, shellQuote, usesAdminKey
} from './core.mjs';
import { badItem, bold, confirm, cyan, detail, dim, heading, note, okItem, panel, skipItem, warnItem } from './ui.mjs';

export function nasInstallSummary(config) {
  const dir = nasDir(config);
  return [
    `설치 위치: ${dir} (${config.nas.host}:${config.nas.port})`,
    `DSM 관리자: ${config.nas.adminUser}`,
    `배포 계정: ${config.nas.deployUser}`
  ].join('\n');
}

export function buildInstallScript(config, files, envText) {
  const dir = nasDir(config);
  const stage = remoteStageFor(config);
  const privileged = [
    'set -e',
    `mkdir -p ${dir}/bin ${dir}/data ${dir}/.unused`,
    `install -o root -g root -m 700 ${stage}/deploy.sh ${dir}/bin/deploy.sh`,
    `install -o root -g root -m 755 ${stage}/deploy-gate.sh ${dir}/bin/deploy-gate.sh`,
    `install -o root -g root -m 644 ${stage}/compose.yaml ${dir}/compose.yaml`,
    ...(envText !== null
      ? [
          `sed 's/\\r$//; s/\\x1b\\[20[01]~//g' ${stage}/env-file > ${stage}/env-file.cleaned`,
          `install -o root -g root -m 600 ${stage}/env-file.cleaned ${dir}/.env`
        ]
      : []),
    `echo ${shellQuote(`${config.nas.deployUser} ALL=(root) NOPASSWD: ${dir}/bin/deploy.sh`)} > /etc/sudoers.d/${config.project}-deploy`,
    `chmod 440 /etc/sudoers.d/${config.project}-deploy`,
    `echo "SUDO=$(sudo -l -U ${config.nas.deployUser} 2>/dev/null | grep -c ${shellQuote(`${dir}/bin/deploy.sh`)})"`,
    `if /usr/local/bin/docker-compose version >/dev/null 2>&1; then echo "COMPOSE=ok"; elif /usr/local/bin/docker compose version >/dev/null 2>&1; then echo "COMPOSE=ok"; else echo "COMPOSE=missing"; fi`,
    `echo "GATE=$(stat -c %a ${dir}/bin/deploy-gate.sh)"`,
    `echo "SCRIPT=$(stat -c %a ${dir}/bin/deploy.sh)"`,
    `echo "ENVMODE=$(stat -c %a ${dir}/.env 2>/dev/null || echo none)"`
  ].join('\n');

  return [
    filePayload(files, stage),
    `trap 'rm -rf ${stage}' EXIT`,
    `sed -i 's/\\r$//' ${stage}/deploy.sh ${stage}/deploy-gate.sh`,
    `sudo -S -p '' sh -c ${shellQuote(privileged)} || { echo ${INSTALL_FAILED_MARK}; exit 10; }`
  ].join('\n');
}

export async function nasCommand(rl) {
  const config = loadConfig();
  for (const file of [DEPLOY_SCRIPT_PATH, GATE_SCRIPT_PATH, COMPOSE_PATH]) {
    if (!fs.existsSync(file)) throw new UserError(`${file} 파일이 없습니다. 먼저 "nas-deploy init" 을 실행하세요.`);
  }
  const envText = readIfExists(ENV_PATH);

  panel('nas - NAS에 배포 준비물 설치하기', [
    ...nasInstallSummary(config).split('\n'),
    '',
    '1) 배포 스크립트, compose 파일, .env 를 NAS로 보냅니다',
    '2) 관리자(root) 소유로 제자리에 놓고 권한을 맞춥니다',
    '3) 배포 계정이 배포 스크립트만 관리자 권한으로 실행하도록 규칙을 만듭니다',
    '',
    envText ? '.env 안의 윈도우 줄바꿈과 붙여넣기 제어문자는 자동으로 정리합니다.' : '.env 파일이 없어 이번에는 건너뜁니다.',
    usesAdminKey(config) ? 'SSH 접속은 등록된 열쇠로 합니다.' : 'SSH 비밀번호를 한 번 입력합니다.'
  ]);
  if (!(await confirm(rl, '계속할까요?', true))) {
    skipItem('취소했습니다');
    return;
  }

  const password = await askNasPassword(rl, config, { reason: '파일을 관리자 소유로 설치하기 위해' });
  const files = {
    'deploy.sh': fs.readFileSync(DEPLOY_SCRIPT_PATH, 'utf8'),
    'deploy-gate.sh': fs.readFileSync(GATE_SCRIPT_PATH, 'utf8'),
    'compose.yaml': fs.readFileSync(COMPOSE_PATH, 'utf8')
  };
  if (envText !== null) files['env-file'] = envText;

  heading('설치 중');
  const { out } = remote(config, buildInstallScript(config, files, envText), { password });
  const value = (name) => new RegExp(`${name}=(\\S+)`).exec(out)?.[1];

  if (Number(value('SUDO') ?? 0) > 0) okItem('배포 계정이 배포 스크립트를 관리자 권한으로 실행할 수 있습니다');
  else {
    badItem('권한 규칙이 적용되지 않았습니다');
    note('NAS에서 "sudo grep includedir /etc/sudoers" 결과에 /etc/sudoers.d 줄이 있는지 확인해 주세요.');
  }
  if (value('COMPOSE') === 'ok') okItem('NAS에 docker compose 가 준비되어 있습니다');
  else {
    badItem('NAS에서 docker compose 를 찾지 못했습니다');
    note('패키지 센터에서 Container Manager 설치와 실행 상태를 확인하세요.');
  }
  if (value('GATE') === '755' && value('SCRIPT') === '700') okItem('스크립트 권한이 올바릅니다', 'gate 755 / deploy 700');
  else warnItem('스크립트 권한을 확인해 주세요', `gate=${value('GATE')} deploy=${value('SCRIPT')}`);
  if (envText !== null) {
    if (value('ENVMODE') === '600') okItem('.env 를 올렸습니다', '관리자만 읽을 수 있습니다');
    else warnItem('.env 권한을 확인해 주세요', `현재 ${value('ENVMODE')}`);
  }

  panel('다음에 할 일', [
    `${bold('nas-deploy secrets')}  ${dim('GitHub에 NAS 접속 정보를 등록합니다')}`,
    `${bold('nas-deploy doctor')}   ${dim('전체 상태를 한 번에 점검합니다')}`,
    '',
    `${cyan('※')} .env 를 고쳤을 때는 ${bold('nas-deploy env')} 한 번이면 NAS에 반영됩니다.`
  ]);
}
