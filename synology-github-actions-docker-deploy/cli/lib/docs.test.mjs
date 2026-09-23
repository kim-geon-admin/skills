import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const documents = [
  fs.readFileSync('README.md', 'utf8'),
  fs.readFileSync('synology-github-actions-docker-deploy/SKILL.md', 'utf8')
];

test('user-facing documents explain configurable routes and credentials', () => {
  for (const document of documents) {
    assert.match(document, /나의 도메인:포트번호/);
    assert.match(document, /NAS 내부 IP/);
    assert.match(document, /실제 NAS .*폴더.*입력|NAS 배포 폴더.*사용자/);
    assert.match(document, /배포 계정[\s\S]*(다시|재)[\s\S]*(검사|점검|실행)/);
    assert.match(document, /신규 배포 계정/);
    assert.match(document, /administrators[\s\S]*homes[\s\S]*(권한|읽기 전용)/);
    assert.doesNotMatch(document, /nayaguny\.synology\.me/);
    assert.match(document, /deploy\.config\.json/);
    assert.match(document, /저장된[\s\S]*먼저 보여주고/);
    assert.match(document, /다시 입력/);
    assert.match(document, /Enter/);
    assert.match(document, /nas-deploy key[\s\S]*신규 계정/);
    assert.match(document, /\.env[\s\S]*(DSM 관리자 비밀번호|개인 키|비밀 열쇠)|DSM 관리자 비밀번호[\s\S]*\.env/);
  }
});
