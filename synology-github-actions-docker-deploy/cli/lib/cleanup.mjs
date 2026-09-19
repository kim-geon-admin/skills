import { askNasPassword } from './ask.mjs';
import { loadConfig, nasDir, remote, shellQuote } from './core.mjs';
import { badItem, confirm, heading, note, okItem, panel } from './ui.mjs';

export function buildCleanupScript(config) {
  const dir = nasDir(config);
  const keyFile = `/var/services/homes/${config.nas.deployUser}/.ssh/authorized_keys`;
  const sudoersFile = `/etc/sudoers.d/${config.project}-deploy`;
  const projectComment = `github-actions@${config.project}`;
  const composeFile = `${dir}/compose.yaml`;
  const envFile = `${dir}/.env`;
  const compose = '/usr/local/bin/docker-compose';

  const privileged = [
    'set -e',
    `if [ -f ${shellQuote(keyFile)} ]; then sed -i ${shellQuote(`/${projectComment}$/d`)} ${shellQuote(keyFile)}; fi`,
    `rm -f ${shellQuote(sudoersFile)}`,
    `if [ -f ${shellQuote(composeFile)} ]; then if [ -f ${shellQuote(envFile)} ]; then ${compose} --project-directory ${shellQuote(dir)} --env-file ${shellQuote(envFile)} -f ${shellQuote(composeFile)} down --remove-orphans || true; else ${compose} --project-directory ${shellQuote(dir)} -f ${shellQuote(composeFile)} down --remove-orphans || true; fi; fi`,
    `rm -f ${shellQuote(`${dir}/bin/deploy.sh`)} ${shellQuote(`${dir}/bin/deploy-gate.sh`)} ${shellQuote(composeFile)} ${shellQuote(envFile)}`,
    `rmdir ${shellQuote(`${dir}/bin`)} 2>/dev/null || true`,
    `rm -rf ${shellQuote(`${dir}/state`)} ${shellQuote(`${dir}/backups`)}`,
    `echo "KEY_REMAINING=$(grep -F -c -- ${shellQuote(projectComment)} ${shellQuote(keyFile)} 2>/dev/null || true)"`,
    `echo "SUDOERS_REMAINING=$(test -e ${shellQuote(sudoersFile)} && echo 1 || echo 0)"`,
    'echo "DONE=ok"'
  ].join('\n');

  // remote() already authenticates sudo once through stdin. A second sudo -S
  // would read from the exhausted SSH stdin and fail with "no password was provided".
  return `sudo -p '' sh -c ${shellQuote(privileged)}`;
}

export async function cleanupCommand(rl) {
  const config = loadConfig();
  const dir = nasDir(config);
  panel('cleanup - 이 프로젝트의 배포 흔적만 제거', [
    `대상 NAS 폴더: ${dir}`,
    `대상 계정: ${config.nas.deployUser}`,
    '',
    '다른 authorized_keys 줄, 계정, 다른 프로젝트의 권한은 변경하지 않습니다.',
    '앱 데이터(data), 캐시(cache), GHCR 이미지는 보존합니다.'
  ]);
  if (!(await confirm(rl, '위 범위로 제거를 진행할까요?', false))) {
    note('취소했습니다. NAS에는 아무것도 변경하지 않았습니다.');
    return;
  }

  const password = await askNasPassword(rl, config, { reason: '프로젝트 배포 흔적을 제거하기 위해' });
  heading('제거 중');
  const { out } = remote(config, buildCleanupScript(config), { password });
  const value = (name) => new RegExp(`${name}=(\\S+)`).exec(out)?.[1];

  if (value('DONE') === 'ok') okItem('프로젝트 배포 흔적을 제거했습니다');
  if (value('KEY_REMAINING') === '0') okItem('이 프로젝트의 배포 키 줄만 제거했습니다', '다른 키는 보존');
  else badItem('이 프로젝트의 배포 키 줄이 남아 있습니다', `remaining=${value('KEY_REMAINING')}`);
  if (value('SUDOERS_REMAINING') === '0') okItem('프로젝트 전용 sudo 권한 규칙을 제거했습니다');
  else badItem('프로젝트 전용 sudo 권한 규칙이 남아 있습니다');
  note('gh-deploy 계정, 다른 키, 앱 data/cache, GHCR 이미지는 보존했습니다.');
}
