// env - 내 컴퓨터의 .env 를 NAS에 반영하고, 원하면 재배포까지 실행합니다.
import fs from 'node:fs';
import { askNasPassword } from './ask.mjs';
import {
  ENV_PATH, INSTALL_FAILED_MARK, UserError, capture, filePayload, loadConfig, nasDir, readIfExists, remote,
  remoteStageFor, shellQuote, has
} from './core.mjs';
import { badItem, bold, confirm, cyan, detail, dim, heading, note, okItem, panel, skipItem, warnItem } from './ui.mjs';

export function buildEnvInstallScript(config, envText) {
  const dir = nasDir(config);
  const stage = remoteStageFor(config);
  const privileged = [
    'set -e',
    `mkdir -p ${dir}`,
    `sed 's/\\r$//; s/\\x1b\\[20[01]~//g' ${stage}/env-file > ${stage}/env-file.cleaned`,
    `install -o root -g root -m 600 ${stage}/env-file.cleaned ${dir}/.env`,
    `echo "MODE=$(stat -c %a ${dir}/.env)"`,
    `echo "LINES=$(grep -c . ${dir}/.env)"`,
    `echo "CONTROL=$(grep -c "$(printf '\\033')" ${dir}/.env || true)"`
  ].join('\n');

  return [
    filePayload({ 'env-file': envText }, stage),
    `trap 'rm -rf ${stage}' EXIT`,
    `sudo -S -p '' sh -c ${shellQuote(privileged)} || { echo ${INSTALL_FAILED_MARK}; exit 10; }`
  ].join('\n');
}

export async function envCommand(rl) {
  const config = loadConfig();
  const dir = nasDir(config);
  const envText = readIfExists(ENV_PATH);
  if (envText === null) throw new UserError(`${ENV_PATH} 파일이 없습니다. "nas-deploy init" 으로 만들거나 직접 작성해 주세요.`);

  const lines = envText.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#'));
  panel('env - 설정 파일을 NAS에 반영하기', [
    `보낼 파일: ${ENV_PATH}  ${dim(`(${lines.length}개 설정)`)}`,
    `받는 곳:   ${dir}/.env  ${dim('(관리자만 읽을 수 있게 저장)')}`,
    '',
    '윈도우 줄바꿈과 붙여넣기 제어문자는 보내면서 자동으로 정리합니다.',
    'GitHub에는 올라가지 않습니다.'
  ]);
  for (const line of lines) {
    const [name, ...rest] = line.split('=');
    const raw = rest.join('=');
    const hidden = /PASSWORD|SECRET|TOKEN|KEY/i.test(name) && raw.trim();
    detail(`${name.trim()} = ${hidden ? '********' : raw.trim() || dim('(비어 있음)')}`);
  }
  if (!(await confirm(rl, '이 내용으로 NAS에 반영할까요?', true))) {
    skipItem('취소했습니다');
    return;
  }

  const password = await askNasPassword(rl, config, { reason: '설정 파일을 관리자 소유로 저장하기 위해' });
  const script = buildEnvInstallScript(config, envText);

  heading('반영 중');
  const { out } = remote(config, script, { password });
  const value = (name) => new RegExp(`${name}=(\\S+)`).exec(out)?.[1];
  if (value('MODE') === '600') okItem('NAS에 저장했습니다', `${dir}/.env`);
  else warnItem('저장은 됐지만 권한을 확인해 주세요', `현재 ${value('MODE')}`);
  if (value('CONTROL') === '0') okItem('이상한 제어문자가 없습니다');
  else warnItem('제어문자가 남아 있습니다', '내용을 다시 확인해 주세요');

  heading('재배포');
  detail('NAS의 설정 파일은 바뀌었지만, 실행 중인 컨테이너는 아직 옛 설정을 쓰고 있습니다.');
  detail('같은 버전으로 다시 배포하면 바뀐 설정이 적용됩니다.');
  if (!has('gh')) {
    skipItem('gh 명령이 없어 자동 실행을 건너뜁니다', 'GitHub 화면에서 Actions → deploy → Run workflow');
    return;
  }
  if (!(await confirm(rl, '지금 재배포를 실행할까요?', true))) {
    note('나중에 GitHub 화면에서 Actions → deploy → Run workflow 로 실행할 수 있습니다.');
    return;
  }
  const result = capture('gh', ['workflow', 'run', 'deploy.yml']);
  if (result.code === 0) {
    okItem('재배포를 요청했습니다');
    note('진행 상황은 "nas-deploy status" 또는 "gh run watch" 로 볼 수 있습니다.');
  } else {
    badItem('재배포 요청에 실패했습니다');
    note(result.err || result.out);
  }
}
