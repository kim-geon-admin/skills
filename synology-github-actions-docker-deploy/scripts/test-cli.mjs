// CLI 규칙 검사: node --test scripts/test-cli.mjs  (Docker·NAS 필요 없음)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dataFolderCommands, dataFolderProblem } from '../cli/lib/core.mjs';
import { detectDataOwner, mergeGitattributes } from '../cli/lib/init.mjs';

const SKILL = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(SKILL, 'cli', 'nas-deploy.mjs');
const TEMPLATE = fs.readFileSync(path.join(SKILL, 'templates', 'gitattributes'), 'utf8');

test('.gitattributes 는 기존 규칙을 지우지 않고 없는 줄만 붙인다', () => {
  const existing = '* text=auto eol=lf\n*.png binary\n';
  const merged = mergeGitattributes(existing, TEMPLATE);
  assert.ok(merged.startsWith(existing));
  assert.match(merged, /\*\.sh text eol=lf/);
  assert.equal(mergeGitattributes(merged, TEMPLATE), merged, '두 번 합쳐도 그대로');
  assert.equal(mergeGitattributes(null, TEMPLATE), TEMPLATE);
});

test('Dockerfile 의 마지막 USER 로 데이터 폴더 소유자를 추측한다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-deploy-'));
  const file = path.join(dir, 'Dockerfile');
  const owner = (text) => {
    fs.writeFileSync(file, text);
    return detectDataOwner(file);
  };
  assert.equal(owner('FROM node:22\nUSER node\n'), '1000:1000');
  assert.equal(owner('FROM x\nUSER 1001\n'), '1001:1001');
  assert.equal(owner('FROM x\nUSER 1001:1002\n'), '1001:1002');
  assert.equal(owner('FROM x\nUSER node\nUSER root\n'), '');
  assert.equal(owner('FROM x\n'), '');
  assert.equal(detectDataOwner(path.join(dir, 'none')), '');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('데이터 폴더 명령: 시놀로지 ACL을 지우고, 소유자를 맞추고, 755로', () => {
  const withOwner = dataFolderCommands({ dataOwner: '1000:1000' }, '/volume1/docker/app');
  assert.deepEqual(withOwner, [
    '/usr/syno/bin/synoacltool -del /volume1/docker/app/data >/dev/null 2>&1 || true',
    'chown 1000:1000 /volume1/docker/app/data',
    'chmod 755 /volume1/docker/app/data'
  ]);
  assert.equal(dataFolderCommands({ dataOwner: '' }, '/d').length, 2, 'root 로 돌면 chown 하지 않는다');
});

test('데이터 폴더 진단: 실제 NAS에서 본 상태를 알아본다', () => {
  const config = { dataOwner: '1000:1000' };
  // 실제로 겪은 첫 배포 실패: 소유자는 맞지만 ACL(+)이 쓰기를 막음 → SQLITE_CANTOPEN
  assert.match(dataFolderProblem(config, '1000:1000:555:+'), /ACL/);
  // 고친 뒤. ACL이 없으면 ls 의 11번째 글자는 공백이고, 출력에서 값을 읽을 때 잘려 빈 문자열이 된다
  assert.equal(dataFolderProblem(config, '1000:1000:755:'), null);
  assert.match(dataFolderProblem(config, '0:0:755:'), /소유자/);
  assert.match(dataFolderProblem(config, '1000:1000:700:'), /권한/);
  assert.match(dataFolderProblem(config, 'none:'), /없습니다/);
  assert.equal(dataFolderProblem({ dataOwner: '' }, '0:0:755:'), null, 'root 컨테이너는 root 소유면 된다');
});

test('init --from: 기존 .gitattributes 유지, compose 에 env_file, 데이터 폴더 소유자 저장', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-deploy-repo-'));
  fs.writeFileSync(path.join(repo, '.gitattributes'), '* text=auto eol=lf\n*.png binary\n');
  fs.writeFileSync(path.join(repo, 'Dockerfile'), 'FROM node:22-slim\nUSER node\n');
  const configFile = path.join(repo, 'input.json');
  fs.writeFileSync(
    configFile,
    JSON.stringify({
      project: 'sample',
      owner: 'someone',
      projectType: 'node',
      healthCheck: 'node',
      healthPath: '/health',
      nas: { host: 'nas.sample.lan', port: 22, adminUser: 'nasadmin', deployUser: 'gh-deploy', dir: '/volume1/docker/sample' }
    })
  );
  const result = spawnSync(process.execPath, [CLI, 'init', '--from', configFile, '--yes'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: '' } // gh·docker 없이: 액션 버전 갱신과 빌드 확인은 건너뛴다
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const attributes = fs.readFileSync(path.join(repo, '.gitattributes'), 'utf8');
  assert.match(attributes, /^\* text=auto eol=lf\n\*\.png binary\n/);
  assert.match(attributes, /\*\.sh text eol=lf/);
  const compose = fs.readFileSync(path.join(repo, 'infra/synology/compose.yaml'), 'utf8');
  assert.match(compose, /env_file:\n\s+- \.env/);
  const saved = JSON.parse(fs.readFileSync(path.join(repo, 'infra/synology/deploy.config.json'), 'utf8'));
  assert.equal(saved.dataOwner, '1000:1000');
  fs.rmSync(repo, { recursive: true, force: true });
});
