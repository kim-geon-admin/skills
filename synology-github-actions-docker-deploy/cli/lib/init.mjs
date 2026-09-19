// init - 질문에 답하면 저장소에 필요한 파일을 만들어 줍니다.
import fs from 'node:fs';
import path from 'node:path';
import {
  CONFIG_PATH, COMPOSE_PATH, DEPLOY_SCRIPT_PATH, ENV_PATH, GATE_SCRIPT_PATH, TEMPLATE_DIR, WORKFLOW_PATH,
  capture, ensureIgnored, expandHome, has, imagePrefix, loadConfig, readIfExists, saveConfig, writeFile
} from './core.mjs';
import { ask, badItem, bold, confirm, cyan, detail, dim, heading, note, okItem, panel, skipItem, step, warnItem } from './ui.mjs';
import { PROJECT_TYPES, detectProjectType, renderDockerfile, tryBuild } from './dockerfile.mjs';
import { normalizePasswordMode } from './password.mjs';

const ACTION_REPOS = [
  'actions/checkout',
  'actions/setup-node',
  'pnpm/action-setup',
  'docker/setup-buildx-action',
  'docker/login-action',
  'docker/build-push-action'
];

const template = (name) => fs.readFileSync(path.join(TEMPLATE_DIR, name), 'utf8');

function buildWorkflow(config) {
  let text = template('deploy.yml');
  text = text.replaceAll('ghcr.io/__GHCR_OWNER__/__PROJECT__', imagePrefix(config));
  text = text.replace('service: [app]', `service: [${config.services.map((service) => service.name).join(', ')}]`);
  text = text.replace('file: __DOCKERFILE__', `file: ${config.dockerfile}`);

  // 준비 단계는 실제로 쓰는 도구에 맞춰 남깁니다. 다른 언어 프로젝트에서는 모두 빠집니다.
  const usesNode = config.test.some((command) => /^(pnpm|npm|npx|node|yarn)/.test(command));
  const usesPnpm = config.test.some((command) => /^pnpm/.test(command));
  const dropStep = (source, marker, lineCount) => {
    const lines = source.split(String.fromCharCode(10));
    const index = lines.findIndex((line) => line.includes(marker));
    if (index < 0) return source;
    lines.splice(index, lineCount);
    return lines.join(String.fromCharCode(10));
  };
  if (!usesPnpm) text = dropStep(text, 'uses: pnpm/action-setup@', 3);
  if (!usesNode) text = dropStep(text, 'uses: actions/setup-node@', 3);

  const testSteps = config.test.length
    ? config.test.map((command) => `      - run: ${command}`).join('\n')
    : '      - run: echo "이 프로젝트에는 배포 전 검사 명령이 없습니다"';
  text = text.replace('      - run: pnpm install --frozen-lockfile\n      - run: pnpm typecheck\n      - run: pnpm test', testSteps);
  return text;
}

// 이미지 안에 있는 명령으로 상태를 확인합니다. 없는 명령을 쓰면 컨테이너가 계속 "이상"으로 표시됩니다.
function healthcheckBlock(config) {
  const url = `http://127.0.0.1:${config.containerPort}${config.healthPath}`;
  const command = {
    node: `["CMD", "node", "-e", "fetch('${url}').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]`,
    wget: `["CMD", "wget", "-q", "-O", "-", "${url}"]`,
    curl: `["CMD", "curl", "-fsS", "${url}"]`
  }[config.healthCheck];
  if (!command) return '    # 상태 확인 명령 없음: 컨테이너가 실행 중인지만 확인합니다.';
  return [
    '    healthcheck:',
    `      test: ${command}`,
    '      interval: 10s',
    '      timeout: 5s',
    '      retries: 3',
    '      start_period: 30s'
  ].join('\n');
}

function buildCompose(config) {
  const [first, ...rest] = config.services;
  let text = template('compose.yaml');
  text = text.replaceAll('__PROJECT__', config.project);
  text = text.replaceAll('__GHCR_OWNER__', config.owner);
  text = text.replaceAll('__HOST_PORT__', String(config.hostPort));
  text = text.replaceAll('__CONTAINER_PORT__', String(config.containerPort));
  text = text.replace('__HEALTHCHECK__', healthcheckBlock(config));
  text = text.replace('  app:\n', `  ${first.name}:\n`);
  text = text.replace(`${imagePrefix(config)}-app:`, `${imagePrefix(config)}-${first.name}:`);
  const extra = rest
    .map((service) => [
      '',
      `  ${service.name}:`,
      `    image: ${imagePrefix(config)}-${service.name}:\${IMAGE_TAG:?IMAGE_TAG is set by deploy.sh}`,
      '    restart: unless-stopped',
      '    read_only: true',
      '    security_opt:',
      '      - no-new-privileges:true',
      '    tmpfs:',
      '      - /tmp',
      '    volumes:',
      '      - ${DATA_DIR:?set DATA_DIR in .env}:/data'
    ].join('\n'))
    .join('\n');
  return extra ? `${text.trimEnd()}\n${extra}\n` : text;
}

function buildDeployScript(config) {
  let text = template('deploy.sh');
  text = text.replace('readonly PROJECT=__PROJECT__', `readonly PROJECT=${config.project}`);
  text = text.replace('readonly IMAGE_PREFIX=ghcr.io/__GHCR_OWNER__/__PROJECT__', `readonly IMAGE_PREFIX=${imagePrefix(config)}`);
  text = text.replace('readonly SERVICES=(app)', `readonly SERVICES=(${config.services.map((service) => service.name).join(' ')})`);
  text = text.replace('readonly BACKUP_FILES=()', `readonly BACKUP_FILES=(${config.backupFiles.join(' ')})`);
  return text;
}

const buildGate = (config) => template('deploy-gate.sh').replaceAll('__PROJECT__', config.project);

export function normalizeAccessMode(value) {
  return value === 'internal' ? 'internal' : 'reverse-proxy';
}

export function connectionRoute(config) {
  const mode = normalizeAccessMode(config.network?.mode);
  const bindHost = config.network?.bindHost ?? (mode === 'reverse-proxy' ? '127.0.0.1' : '(시놀로지 내부 IP)');
  const docker = `${bindHost}:${config.hostPort}`;
  const container = `컨테이너:${config.containerPort}`;
  if (mode === 'internal') return `${docker} → ${container}`;
  const url = config.network?.publicUrl || '(외부 URL)';
  return `${url}:${config.network?.publicPort ?? 443} → ${docker} → ${container}`;
}

export function buildEnv(config) {
  const bindHost = config.network?.bindHost ?? '127.0.0.1';
  return [
    `DATA_DIR=${config.nas.dir}/data`,
    `CACHE_DIR=${config.nas.dir}/cache`,
    `HTTP_BIND=${bindHost}:${config.hostPort}`,
    '',
    '# 앱이 필요로 하는 값(비밀번호 등)을 여기에 추가하세요. 이 파일은 git에 올라가지 않습니다.',
    ''
  ].join('\n');
}

// 액션 버전은 태그가 아니라 커밋 번호로 고정합니다. 태그는 나중에 다른 코드로 바뀔 수 있기 때문입니다.
function refreshActionVersions(workflow) {
  if (!has('gh')) return { workflow, updated: 0, skipped: '깃허브 명령(gh)이 없어 템플릿에 적힌 버전을 그대로 씁니다' };
  let updated = 0;
  let text = workflow;
  for (const repo of ACTION_REPOS) {
    const tag = capture('gh', ['api', `repos/${repo}/releases/latest`, '--jq', '.tag_name']);
    if (tag.code !== 0 || !tag.out) continue;
    const sha = capture('gh', ['api', `repos/${repo}/commits/${tag.out}`, '--jq', '.sha']);
    if (sha.code !== 0 || !/^[0-9a-f]{40}$/.test(sha.out)) continue;
    const pattern = new RegExp(`${repo}@[0-9a-f]{40} # \\S+`, 'g');
    const replacement = `${repo}@${sha.out} # ${tag.out}`;
    if (pattern.test(text)) {
      text = text.replace(new RegExp(`${repo}@[0-9a-f]{40} # \\S+`, 'g'), replacement);
      updated += 1;
    }
  }
  return { workflow: text, updated, skipped: '' };
}

async function askConfig(rl, previous) {
  const folder = path.basename(process.cwd()).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  heading('1. 프로젝트 정보');
  detail('NAS 폴더 이름과 이미지 이름에 쓰입니다. 소문자와 숫자를 쓰세요.');
  const project = await ask(rl, '프로젝트 이름', previous?.project ?? folder);
  detail('GitHub 사용자 또는 조직 이름입니다. 이미지가 이 계정 아래에 저장됩니다.');
  const ownerGuess = previous?.owner ?? capture('gh', ['api', 'user', '--jq', '.login']).out;
  const owner = (await ask(rl, 'GitHub 계정', ownerGuess)).toLowerCase();

  heading('2. 프로젝트 종류');
  const detected = detectProjectType();
  detail('폴더 안의 파일을 보고 종류를 추측했습니다. 이 값으로 포트와 상태 확인 방법의 기본값이 정해집니다.');
  for (const [name, meta] of Object.entries(PROJECT_TYPES)) detail(`${name.padEnd(7)} ${meta.label}`);
  const projectType = (await ask(rl, '종류', previous?.projectType ?? detected ?? 'static')).toLowerCase();
  const typeMeta = PROJECT_TYPES[projectType];
  if (!typeMeta) warnItem('모르는 종류입니다. 기본값으로 진행합니다.');

  heading('3. 서비스와 Dockerfile');
  detail('컨테이너로 띄울 서비스 이름입니다. 하나면 app 만 적으면 됩니다. 여러 개면 쉼표로 구분하세요.');
  const serviceNames = (await ask(rl, '서비스 목록', (previous?.services ?? [{ name: 'app' }]).map((service) => service.name).join(', ')))
    .split(',').map((name) => name.trim()).filter(Boolean);
  const multi = serviceNames.length > 1;
  detail(multi
    ? '서비스마다 Dockerfile이 다르면 ${{ matrix.service }} 를 넣어 한 줄로 적을 수 있습니다.'
    : 'Dockerfile 경로를 저장소 기준으로 적어 주세요.');
  const dockerfile = await ask(rl, 'Dockerfile 경로', previous?.dockerfile ?? (multi ? 'infra/docker/${{ matrix.service }}.Dockerfile' : './Dockerfile'));

  heading('4. 접속 경로와 포트');
  detail('먼저 외부 역방향 프록시인지, 로컬 네트워크 내부 전용인지 선택합니다.');
  detail('역방향 프록시: 외부 URL:외부 포트 → 127.0.0.1:Synology Docker 포트 → 컨테이너 포트');
  detail('내부 전용: Synology 내부 IP:Synology Docker 포트 → 컨테이너 포트');
  const mode = normalizeAccessMode(await ask(rl, '접속 방식 (reverse-proxy/internal)', previous?.network?.mode ?? 'reverse-proxy'));
  let publicUrl = '';
  let publicPort = 443;
  let bindHost = '';
  if (mode === 'reverse-proxy') {
    publicUrl = await ask(rl, '외부 URL (포트 제외, 예: https://app.example.com)', previous?.network?.publicUrl ?? '');
    publicPort = Number(await ask(rl, '외부 포트 (예: 443)', String(previous?.network?.publicPort ?? 443)));
    bindHost = '127.0.0.1';
    detail('역방향 프록시는 외부 URL을 Synology 역방향 프록시에서 아래 Docker 연결 포트로 연결하세요.');
  } else {
    bindHost = await ask(rl, 'Synology 내부 IP (예: 192.168.0.20)', previous?.network?.bindHost ?? '');
    detail('내부 전용은 같은 네트워크의 기기에서 위 내부 IP와 아래 Docker 연결 포트로 접속합니다.');
  }
  detail('Synology Docker 연결 포트입니다. 외부 포트/내부 접속 포트와 구분해서 입력하세요.');
  const hostPort = await ask(rl, 'Synology Docker 연결 포트', String(previous?.hostPort ?? 3100));
  detail('앱이 컨테이너 안에서 실제로 듣는 포트입니다.');
  const containerPort = await ask(rl, '실제 컨테이너 포트', String(previous?.containerPort ?? typeMeta?.containerPort ?? 3000));
  if (mode === 'reverse-proxy' && !publicUrl) throw new Error('역방향 프록시를 선택했으므로 외부 URL을 입력해야 합니다.');
  if (mode === 'internal' && !bindHost) throw new Error('내부 전용을 선택했으므로 Synology 내부 IP를 입력해야 합니다.');
  if (!Number.isInteger(Number(publicPort)) || Number(publicPort) < 1 || Number(publicPort) > 65535) throw new Error('외부 포트는 1부터 65535 사이의 숫자여야 합니다.');
  if (!Number.isInteger(Number(hostPort)) || Number(hostPort) < 1 || Number(hostPort) > 65535) throw new Error('Synology Docker 연결 포트는 1부터 65535 사이의 숫자여야 합니다.');
  if (!Number.isInteger(Number(containerPort)) || Number(containerPort) < 1 || Number(containerPort) > 65535) throw new Error('실제 컨테이너 포트는 1부터 65535 사이의 숫자여야 합니다.');

  heading('5. 상태 확인(헬스 체크)');
  detail('배포 뒤 앱이 정상인지 확인하는 방법입니다. 이미지 안에 실제로 있는 명령을 골라야 합니다.');
  detail('node = Node 이미지, wget = alpine/nginx 계열, curl = curl이 설치된 이미지, none = 실행 여부만 확인');
  const healthCheck = (await ask(rl, '확인 방법 (node/wget/curl/none)', previous?.healthCheck ?? typeMeta?.healthCheck ?? 'none')).toLowerCase();
  const healthPath = ['node', 'wget', 'curl'].includes(healthCheck)
    ? await ask(rl, '확인할 주소 경로', previous?.healthPath ?? typeMeta?.healthPath ?? '/health')
    : (previous?.healthPath ?? typeMeta?.healthPath ?? '/health');

  heading('6. 테스트 명령');
  detail('배포 전에 GitHub에서 실행할 명령입니다. 이 단계가 실패하면 NAS로 배포되지 않습니다.');
  const test = (await ask(rl, '명령 목록(쉼표로 구분)', (previous?.test ?? ['pnpm install --frozen-lockfile', 'pnpm typecheck', 'pnpm test']).join(', ')))
    .split(',').map((command) => command.trim()).filter(Boolean);

  heading('7. NAS 접속 정보');
  detail('GitHub Actions와 이 도구가 접속할 주소입니다.');
  const host = await ask(rl, 'NAS 주소', previous?.nas?.host ?? '');
  const port = await ask(rl, 'SSH 포트', String(previous?.nas?.port ?? 22));
  detail('NAS에 SSH로 들어갈 때 쓰는 본인 DSM 관리자 계정입니다.');
  const adminUser = await ask(rl, 'DSM 관리자 계정', previous?.nas?.adminUser ?? '');
  detail('배포 전용 계정입니다. 이 계정의 키는 배포 명령 하나만 실행할 수 있습니다.');
  const deployUser = await ask(rl, '배포 전용 계정', previous?.nas?.deployUser ?? 'gh-deploy');
  const dir = await ask(rl, 'NAS 배포 폴더', previous?.nas?.dir ?? `/volume1/docker/${project}`);

  heading('8. DSM 관리자 비밀번호 입력 방식');
  detail('매번 입력(prompt) = 각 명령을 실행할 때마다 PowerShell에서 비밀번호를 입력합니다.');
  detail('임시 보관(temporary) = nas-deploy session 안에서 한 번만 입력하고 세션 종료 후 자동 폐기합니다.');
  const passwordMode = normalizePasswordMode(await ask(rl, '입력 방식 (prompt/temporary)', previous?.nas?.passwordMode ?? 'prompt'));

  heading('9. 백업');
  detail('새 버전으로 바꾸기 전에 복사해 둘 파일입니다. 데이터베이스 파일이 있으면 적어 주세요. 없으면 그냥 Enter.');
  const backupFiles = (await ask(rl, '백업할 파일(쉼표로 구분)', (previous?.backupFiles ?? []).join(', ')))
    .split(',').map((file) => file.trim()).filter(Boolean);

  return {
    project,
    owner,
    projectType: typeMeta ? projectType : '',
    services: serviceNames.map((name) => ({ name })),
    dockerfile,
    containerPort: Number(containerPort),
    hostPort: Number(hostPort),
    network: { mode, publicUrl, publicPort, bindHost },
    healthCheck: ['node', 'wget', 'curl'].includes(healthCheck) ? healthCheck : 'none',
    healthPath,
    test,
    nas: { host, port: Number(port), adminUser, deployUser, dir, passwordMode, adminKey: previous?.nas?.adminKey ?? null },
    keyPath: previous?.keyPath ?? `~/.ssh/${project}_deploy`,
    backupFiles
  };
}

// 질문 없이 설정 파일(JSON)로 바로 만들 때 쓰는 기본값입니다.
export function withDefaults(input) {
  const project = input.project ?? path.basename(process.cwd()).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const projectType = input.projectType ?? detectProjectType();
  const typeMeta = PROJECT_TYPES[projectType];
  const networkMode = normalizeAccessMode(input.network?.mode);
  const networkBindHost = input.network?.bindHost ?? (networkMode === 'reverse-proxy' ? '127.0.0.1' : '');
  return {
    project,
    owner: (input.owner ?? '').toLowerCase(),
    projectType: typeMeta ? projectType : '',
    services: (input.services ?? [{ name: 'app' }]).map((service) => (typeof service === 'string' ? { name: service } : service)),
    dockerfile: input.dockerfile ?? './Dockerfile',
    containerPort: Number(input.containerPort ?? typeMeta?.containerPort ?? 3000),
    hostPort: Number(input.hostPort ?? 3100),
    network: {
      mode: networkMode,
      publicUrl: networkMode === 'internal' ? '' : (input.network?.publicUrl ?? ''),
      publicPort: Number(input.network?.publicPort ?? 443),
      bindHost: networkBindHost
    },
    healthCheck: ['node', 'wget', 'curl', 'none'].includes(input.healthCheck) ? input.healthCheck : (typeMeta?.healthCheck ?? 'none'),
    healthPath: input.healthPath ?? typeMeta?.healthPath ?? '/health',
    test: input.test ?? [],
    nas: {
      host: input.nas?.host ?? '',
      port: Number(input.nas?.port ?? 22),
      adminUser: input.nas?.adminUser ?? '',
      deployUser: input.nas?.deployUser ?? 'gh-deploy',
      dir: input.nas?.dir ?? `/volume1/docker/${project}`,
      passwordMode: normalizePasswordMode(input.nas?.passwordMode),
      adminKey: input.nas?.adminKey ?? null
    },
    keyPath: input.keyPath ?? `~/.ssh/${project}_deploy`,
    backupFiles: input.backupFiles ?? []
  };
}

export async function initCommand(rl, options = {}) {
  const previous = loadConfig({ required: false });
  panel('init - 저장소에 배포 파일 만들기', [
    '이 명령은 내 컴퓨터의 저장소 폴더에만 파일을 만듭니다.',
    'NAS나 GitHub에는 아직 아무것도 전송하지 않습니다.',
    '질문에 Enter만 누르면 괄호 안의 기본값이 사용됩니다.'
  ]);
  if (previous) note(`기존 설정을 찾았습니다 (${CONFIG_PATH}). 값을 바꾸지 않으려면 계속 Enter를 누르세요.`);

  let config;
  if (options.from) {
    // 질문 없이 만들기: 미리 적어 둔 설정 파일을 그대로 씁니다.
    config = withDefaults(JSON.parse(fs.readFileSync(options.from, 'utf8')));
    okItem('설정 파일을 읽었습니다', options.from);
  } else {
    config = await askConfig(rl, previous);
  }
  if (!config.nas.host || !config.nas.adminUser) throw new Error('NAS 주소와 DSM 관리자 계정은 반드시 입력해야 합니다.');

  heading('파일 만들기');
  const workflowBase = buildWorkflow(config);
  const { workflow, updated, skipped } = refreshActionVersions(workflowBase);
  if (updated) okItem(`GitHub 액션 ${updated}개를 최신 버전으로 고정했습니다`);
  if (skipped) skipItem(skipped);

  const files = [
    [WORKFLOW_PATH, workflow],
    [COMPOSE_PATH, buildCompose(config)],
    [DEPLOY_SCRIPT_PATH, buildDeployScript(config)],
    [GATE_SCRIPT_PATH, buildGate(config)],
    ['.gitattributes', template('gitattributes')]
  ];
  for (const [file, content] of files) {
    const existing = readIfExists(file);
    if (existing === content) {
      skipItem(`${file} (이미 같은 내용)`);
      continue;
    }
    if (existing && !options.yes && !(await confirm(rl, `${file} 파일이 이미 있습니다. 덮어쓸까요?`, false))) {
      skipItem(`${file} (그대로 둠)`);
      continue;
    }
    writeFile(file, content);
    okItem(`${file} ${existing ? '수정함' : '새로 만듦'}`);
  }

  // Dockerfile 은 프로젝트마다 다르므로, 없을 때만 종류에 맞는 초안을 만들어 줍니다.
  const dockerfilePath = config.dockerfile.replace('${{ matrix.service }}', config.services[0].name).replace(/^\.\//, '');
  if (config.projectType && !dockerfilePath.includes('${{') ) {
    if (fs.existsSync(dockerfilePath)) {
      skipItem(`${dockerfilePath} (이미 있음)`);
    } else if (options.yes || (await confirm(rl, `${dockerfilePath} 초안을 만들까요? (${PROJECT_TYPES[config.projectType].label})`, true))) {
      writeFile(dockerfilePath, renderDockerfile(config.projectType));
      okItem(`${dockerfilePath} 새로 만듦`, '프로젝트에 맞게 확인하고 고쳐 주세요');
      const build = tryBuild(dockerfilePath);
      if (build.skipped) skipItem(build.skipped);
      else if (build.ok) okItem('이미지 빌드 확인 완료');
      else {
        warnItem('이미지 빌드가 실패했습니다. Dockerfile 을 손봐야 합니다');
        for (const line of build.message.split(String.fromCharCode(10))) note(line);
      }
    }
  }

  if (!readIfExists(ENV_PATH)) {
    writeFile(ENV_PATH, buildEnv(config));
    okItem(`${ENV_PATH} 새로 만듦`, 'git에 올라가지 않습니다');
  } else {
    skipItem(`${ENV_PATH} (이미 있음)`);
  }

  saveConfig(config);
  okItem(`${CONFIG_PATH} 저장함`);
  for (const pattern of ['deploy.config.json', '.env']) {
    if (ensureIgnored(pattern)) okItem(`.gitignore 에 ${pattern} 추가함`);
  }

  if (config.services.length > 1) {
    warnItem('서비스가 여러 개입니다. compose.yaml의 두 번째 서비스 아래 볼륨과 환경 변수를 프로젝트에 맞게 손봐 주세요.');
  }

  panel('접속 경로 기록', [
    connectionRoute(config),
    config.network.mode === 'reverse-proxy'
      ? '외부 URL은 Synology 역방향 프록시의 소스 주소로 사용하세요.'
      : '같은 로컬 네트워크의 기기는 Synology 내부 IP와 Docker 연결 포트로 접속하세요.',
    `HTTP_BIND=${config.network.bindHost}:${config.hostPort}`
  ]);

  const nextSteps = config.nas.passwordMode === 'temporary'
    ? [
        `1. ${bold('nas-deploy session')}  ${dim('DSM 비밀번호를 한 번 입력하고 전체 작업을 진행합니다')}`,
        '',
        `${cyan('※')} session이 끝나면 암호화 임시 파일은 자동 폐기됩니다.`
      ]
    : [
        `1. ${bold('nas-deploy doctor')}   ${dim('내 컴퓨터와 NAS 상태를 점검합니다')}`,
        `2. ${bold('nas-deploy key')}      ${dim('배포용 열쇠를 만들어 NAS에 등록합니다')}`,
        `3. ${bold('nas-deploy nas')}      ${dim('NAS에 배포 스크립트를 설치합니다')}`,
        `4. ${bold('nas-deploy secrets')}  ${dim('GitHub에 접속 정보를 등록합니다')}`
      ];
  panel('다음에 할 일', [
    ...nextSteps,
    '',
    `${cyan('※')} ${ENV_PATH} 를 열어 앱에 필요한 값을 채워 두세요.`,
    `${cyan('※')} 만든 파일을 커밋해서 올리는 것은 작업이 끝난 뒤에 하세요.`
  ]);
}
