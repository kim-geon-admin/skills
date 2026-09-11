// status - 최근 배포 결과와 NAS의 현재 상태를 보여 줍니다.
import { askNasPassword } from './ask.mjs';
import { capture, has, loadConfig, nasDir, remote, usesAdminKey } from './core.mjs';
import { badItem, bold, cyan, detail, dim, green, heading, note, okItem, panel, red, skipItem, warnItem, yellow } from './ui.mjs';

export async function statusCommand(rl, options = {}) {
  const config = loadConfig();
  const dir = nasDir(config);
  panel('status - 지금 상태 보기', [
    `프로젝트: ${config.project}`,
    `NAS:      ${config.nas.host}  ${dim(dir)}`
  ]);

  heading('GitHub 최근 실행');
  if (!has('gh')) skipItem('gh 명령이 없어 건너뜁니다');
  else {
    const runs = capture('gh', ['run', 'list', '--workflow', 'deploy.yml', '--limit', '5',
      '--json', 'status,conclusion,displayTitle,createdAt,databaseId',
      '--jq', '.[] | [.conclusion // .status, .displayTitle, .createdAt] | @tsv']);
    if (runs.code !== 0 || !runs.out) skipItem('실행 기록을 찾지 못했습니다', runs.err.split('\n')[0]);
    else {
      for (const line of runs.out.split('\n')) {
        const [state, titleText, when] = line.split('\t');
        const mark = state === 'success' ? green('성공') : state === 'failure' ? red('실패') : yellow(state);
        console.log(`  ${mark}  ${titleText}  ${dim(String(when).slice(0, 16).replace('T', ' '))}`);
      }
    }
  }

  if (options.skipNas) {
    note('NAS 상태는 --skip-nas 옵션으로 건너뛰었습니다.');
    return;
  }

  heading('NAS 상태');
  if (!usesAdminKey(config)) detail('NAS 상태를 보려면 관리자 권한이 필요합니다. "nas-deploy login" 을 해 두면 다음부터 비밀번호를 묻지 않습니다.');
  const password = await askNasPassword(rl, config, { reason: '배포 기록과 컨테이너 상태를 읽기 위해' });
  const script = [
    `echo "CURRENT=$(sudo cat ${dir}/state/current-tag 2>/dev/null || echo none)"`,
    `echo "PREVIOUS=$(sudo cat ${dir}/state/previous-tag 2>/dev/null || echo none)"`,
    `echo "DISK=$(df -Pm ${dir} | awk 'NR==2{print $4}')"`,
    `echo "---CONTAINERS"`,
    `sudo docker ps -a --filter "label=com.docker.compose.project=${config.project}" --format '{{.Names}}\\t{{.Status}}' 2>/dev/null || true`,
    `echo "---LOG"`,
    `sudo sh -c 'ls -1t ${dir}/state/logs/*.log 2>/dev/null | head -n 1'`,
    `sudo sh -c 'tail -n 6 $(ls -1t ${dir}/state/logs/*.log 2>/dev/null | head -n 1) 2>/dev/null' || true`
  ].join('\n');
  const { out } = remote(config, script, { password });
  const value = (name) => new RegExp(`${name}=(\\S+)`).exec(out)?.[1];

  const current = value('CURRENT');
  if (current && current !== 'none') okItem('현재 배포된 버전', current.slice(0, 12));
  else warnItem('아직 배포된 적이 없습니다');
  const previous = value('PREVIOUS');
  if (previous && previous !== 'none') detail(`되돌릴 수 있는 이전 버전: ${previous.slice(0, 12)}`);
  const disk = Number(value('DISK') ?? 0);
  if (disk) {
    const message = `남은 디스크 공간 ${(disk / 1024).toFixed(1)}GB`;
    if (disk < 3072) warnItem(message, '3GB 아래면 배포가 중단됩니다');
    else okItem(message);
  }

  const containers = out.split('---CONTAINERS')[1]?.split('---LOG')[0]?.trim();
  if (containers) {
    console.log();
    for (const line of containers.split('\n')) {
      const [name, ...rest] = line.split('\t');
      const state = rest.join(' ');
      const mark = /Up/.test(state) ? green('실행중') : /Exited/.test(state) ? yellow('정지') : dim('  ?  ');
      console.log(`  ${mark}  ${name}  ${dim(state)}`);
    }
  } else skipItem('실행 중인 컨테이너가 없습니다');

  const log = out.split('---LOG')[1]?.trim();
  if (log) {
    heading('마지막 배포 기록');
    for (const line of log.split('\n').slice(0, 8)) detail(line);
  }

  panel('도움말', [
    `${bold('nas-deploy env')}     ${dim('설정을 바꾸고 다시 배포하기')}`,
    `${bold('nas-deploy doctor')}  ${dim('문제가 있을 때 원인 찾기')}`,
    '',
    `${cyan('※')} 이전 버전으로 되돌리려면 GitHub에서 그 커밋의 실행을 열고 deploy 단계만 다시 실행하세요.`
  ]);
}
