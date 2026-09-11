---
name: synology-docker-deploy
description: GitHub Actions로 Docker 이미지를 빌드해 Synology NAS(DSM 7, Container Manager)에 SSH로 안전하게 자동 배포(CI/CD)하는 구성을 새로 만들거나, 기존 NAS 배포 워크플로를 보안 검토할 때 사용. 검증된 워크플로·배포 스크립트(pull→백업→교체→헬스체크→자동 롤백) 템플릿, 배포 전용 계정/SSH 강제 명령/sudo/known_hosts/Secrets 설정 절차, 실제로 겪은 시행착오(Synology ACL, DSM 80/443, CRLF, PowerShell 차이 등) 해결법 포함. "시놀로지 배포", "NAS CI/CD", "GitHub Actions로 NAS에 배포", "나스 도커 자동 배포" 요청 시 사용.
---

# Synology NAS Docker 배포 (GitHub Actions)

`main` push → 테스트 → 이미지 빌드(GHCR private, 커밋 SHA 태그) → SSH로 NAS에 `deploy <sha>` 한 줄 전달 →
NAS의 root 스크립트가 pull → 정지+백업 → 교체 → 헬스 체크 → 실패 시 자동 롤백.

```text
GitHub Actions ──ssh(키: 강제 명령)──▶ deploy-gate.sh (gh-deploy 권한, "deploy <sha>"만 허용)
   stdin: job 동안만 유효한 GITHUB_TOKEN        └─ sudo -n deploy.sh <sha>   (NOPASSWD 규칙은 이 파일 하나)
                                                    └─ docker pull / compose up / 헬스 체크 / 롤백
```

2026-09 첫 프로젝트에 실제로 구축하며 검증했다. 적용 사례 위치와 이 PC·NAS의 실제 값(도메인, 포트, 계정)은
**`local-env.md`**에 있다 — 개인 정보라 git에 올리지 않는 파일이다(`.gitignore`). 문서의 `나의NAS도메인` 같은
대체어는 이 파일의 값으로 바꿔서 사용자에게 보여 준다. 파일이 없는 PC라면 사용자에게 물어 새로 만든다.

## 파일

| 경로 | 내용 |
| --- | --- |
| `templates/deploy.yml` | 워크플로. 액션 SHA 고정, job별 최소 권한, concurrency, SHA 태그만 사용 |
| `templates/deploy.sh` | NAS 배포 스크립트(root). 상단 설정 블록만 프로젝트에 맞게 수정 |
| `templates/deploy-gate.sh` | SSH 강제 명령. `deploy <40자 sha>` 외 전부 거부 |
| `templates/compose.yaml` | NAS용 compose 예시(헬스체크, loopback 바인딩) |
| `templates/gitattributes` | `*.sh eol=lf` (Windows `core.autocrlf=true` 대비) |
| `cli/nas-deploy.mjs` | 설정·설치·점검을 대신 해 주는 CLI (Node 20+, 의존성 없음). 아래 "CLI로 진행하기" 참고 |
| `scripts/test-deploy.sh` | 모의 docker로 배포 시나리오 15~16개 검증 (Docker 필요) |
| `references/nas-setup.md` | 사용자와 함께 진행하는 NAS·GitHub 설정 단계 (한 단계씩 안내용) |
| `references/security-review.md` | 기존 NAS 배포 워크플로 검토 체크리스트 |

## CLI로 진행하기 (권장)

사용자가 명령을 하나씩 치는 부담을 줄이려면 CLI를 쓴다. 저장소 루트에서 실행한다.

```bash
node ~/.claude/skills/synology-docker-deploy/cli/nas-deploy.mjs help
```

| 명령 | 하는 일 |
| --- | --- |
| `init` | 질문에 답하면 워크플로·compose·배포 스크립트·.env·설정 파일 생성 (액션 SHA도 최신으로 고정) |
| `login` | (선택) 관리자 열쇠를 NAS에 등록해 이후 SSH 비밀번호 입력을 없앰 |
| `key` | 배포 전용 열쇠 생성 → `authorized_keys`에 강제 명령으로 등록 → 호스트 키 저장·대조 → 접속 시험 |
| `nas` | 스크립트·compose·.env를 한 번의 접속으로 전송·설치, sudo 규칙 생성, 권한 확인 |
| `secrets` | GitHub Secret 5개 등록 |
| `doctor` | PC·저장소·GitHub·열쇠·NAS를 한 번에 점검하고 해결 방법 제시 (아무것도 바꾸지 않음) |
| `env` | `.env`를 NAS에 반영(CRLF·제어문자 정리)하고 재배포 실행 |
| `status` | 최근 실행 결과, 배포된 버전, 컨테이너 상태, 마지막 배포 로그 |

- 비밀번호는 저장하지 않는다. 명령 하나당 한 번만 물어보고 메모리에서만 쓴다(`sudo -S`로 전달).
- 파일 전송은 scp 대신 같은 SSH 접속으로 보낸다(SFTP 설정과 무관, 접속 1회).
- DSM 웹에서만 가능한 일(계정 생성, 공유 폴더 권한, 역방향 프록시, 공유기 포워딩)은 자동화하지 않고 안내·검증만 한다.
- CLI가 없는 환경이거나 단계를 직접 보여 줘야 하면 아래 순서와 `references/nas-setup.md`를 쓴다.

## 진행 순서

1. **프로젝트 파악**: 서비스 목록과 Dockerfile 경로, 컨테이너 내부 포트, 영속 데이터(SQLite 등), 기존 compose,
   `/health` 같은 헬스 엔드포인트, 저장소 공개 여부(`gh repo view --json visibility`).
   **`git status`로 부분 커밋 여부를 꼭 확인** — main에 반쯤 커밋된 코드가 있으면 첫 실행부터 test에서 막힌다.
2. **값 결정** (사용자에게 확인):

   | 토큰 | 의미 | 예시 |
   | --- | --- | --- |
   | `__PROJECT__` | 소문자 프로젝트명 = compose `name:` = NAS 폴더 = 이미지 이름 | `나의프로젝트` |
   | `__GHCR_OWNER__` | GitHub 소유자(소문자) | `나의깃허브계정` |
   | `SERVICES` | 빌드할 compose 서비스들 (워크플로 matrix와 동일) | `(app worker)` |
   | `__DOCKERFILE__` | 서비스별 Dockerfile 경로 | `infra/docker/${{ matrix.service }}.Dockerfile` |
   | `BACKUP_FILES` | 교체 전 복사할 호스트 파일 | `(/volume1/docker/나의프로젝트/data/app.sqlite)` |
   | `__HOST_PORT__` | NAS loopback 포트 (역방향 프록시 대상) | `3100` |

3. **템플릿 적용**: `templates/*`를 프로젝트의 `.github/workflows/deploy.yml`, `infra/synology/`, `.gitattributes`로
   복사하고 토큰 치환. `test` job은 프로젝트의 실제 검사 명령으로 교체.
4. **액션 SHA 갱신** (템플릿의 SHA는 2026-09 기준):
   ```bash
   for r in actions/checkout actions/setup-node pnpm/action-setup docker/setup-buildx-action docker/login-action docker/build-push-action; do
     t=$(gh api repos/$r/releases/latest --jq .tag_name); echo "$r $t $(gh api repos/$r/commits/$t --jq .sha)"; done
   ```
5. **검증**: `bash scripts/test-deploy.sh <프로젝트 deploy.sh> <deploy-gate.sh>` 전부 PASS,
   `IMAGE_TAG=<40자> docker compose --env-file <예시 env> -f infra/synology/compose.yaml config -q` 통과.
6. **NAS·GitHub 설정**: `references/nas-setup.md` 순서대로 **한 단계씩** 안내한다. 안내할 때마다:
   - 코드 블록마다 **`실행 위치 | 실행 방식`** 라벨을 붙인다.
     실행 위치 = `PC · Git Bash` / `PC · PowerShell` / `NAS · SSH 창` / `DSM 웹` / `GitHub 웹` / `공유기`,
     실행 방식 = `한꺼번에` / `한 줄씩` / `입력 대기`(붙여 넣기 → Enter → `Ctrl+D`) / `화면 조작`.
   - 명령은 실제 값을 넣은 **예시 그대로** 보여 주고(꺾쇠 `<…>` 금지), 기대 결과 예시를 붙인다.
   - `sudo`가 든 여러 줄을 한꺼번에 붙여 넣게 하기 전에 `sudo -v`를 한 줄로 먼저 실행하게 한다.
   - PC 명령은 Git Bash가 기본. PowerShell은 `~`, `<`, `$(…)`가 안 되므로 대안이 필요할 때만.
7. **연결 테스트는 Claude가 직접**: PC에 키가 있으면 `-o BatchMode=yes`로 실행하면 비밀번호 프롬프트 없이
   결과를 볼 수 있다 (`references/nas-setup.md` 7단계).
8. **첫 push 전**: 로컬에서 test job과 같은 명령 실행. push 후 `gh run watch`로 결과 확인.

## 설계 원칙 (바꾸지 말 것)

- **키 = 명령 하나**: `authorized_keys`에 `restrict,command="…/deploy-gate.sh"`. docker 그룹·`sudo docker` 허용 금지
  (docker 권한 = root). sudo NOPASSWD는 `deploy.sh` 한 파일만.
- **호스트 키 고정**: `NAS_SSH_KNOWN_HOSTS` + `StrictHostKeyChecking=yes`. 없으면 MITM이 토큰을 가로챈다.
- **레지스트리 자격 증명을 NAS에 두지 않음**: job의 `GITHUB_TOKEN`(packages:read)을 stdin으로 전달,
  NAS는 임시 `DOCKER_CONFIG`로 로그인 후 삭제. Docker Hub 토큰·PAT 불필요.
- **CI는 NAS에 파일을 쓰지 않음**: compose·스크립트는 수동 설치(root 소유). CI가 compose를 쓰면
  push 권한 = NAS root가 된다.
- **불변 태그**: 커밋 SHA 태그만, `latest` 없음 → 재현 가능, 롤백 가능.
- **pull 먼저, 교체는 나중**: pull·검증 실패 시 기존 스택은 그대로. 교체 후 헬스 실패 시 직전 태그로 롤백.
- **SSH 세션과 분리 실행**: 연결이 끊겨도 교체가 중간에 멈추지 않음 (로그: `state/logs/`).
- **HTTPS는 DSM 역방향 프록시**: DSM이 80/443을 점유하므로 Caddy/nginx 컨테이너 대신
  앱은 `127.0.0.1:<포트>`에만 바인딩. 내부 포트는 공유기 포워딩 금지.

## 실제로 겪은 시행착오

| 증상 | 원인 | 해결 |
| --- | --- | --- |
| 키 접속 시 **비밀번호를 물어봄** (`ssh -v`: Offering public key 후 거부) | gh-deploy의 `homes` 공유 폴더 권한이 **"액세스 불가"** → Synology ACL이 `chmod`보다 우선해 sshd가 `authorized_keys`를 못 읽음 | DSM → 사용자 → gh-deploy → 권한: `homes`의 액세스 불가 **해제**. 확인: `sudo -u gh-deploy cat ~gh-deploy/.ssh/authorized_keys` |
| 로그인 후 `deploy-gate.sh: Permission denied` (exit 126) | `docker` 공유 폴더가 액세스 불가 | `docker`를 **읽기 전용**으로. 확인: `sudo -u gh-deploy ls -l …/bin/deploy-gate.sh` |
| `synoacltool -del` → `Unknown error` | 지울 ACL이 없음 (원인은 위의 공유 폴더 권한) | 무시 |
| `echo '…' \| sudo tee …` 붙여 넣으면 프롬프트가 `>`로 바뀜 | 긴 키 붙여 넣기 중 줄바꿈/따옴표 불일치 → 셸이 입력 대기 | `Ctrl+C`. PC에서 줄을 완성하고 NAS에서 `sudo tee 파일 > /dev/null` → 붙여 넣기 → Enter → `Ctrl+D` |
| `authorized_keys`가 105바이트 (앞부분 누락) | 공개 키만 붙여 넣음 → 성공 시 **관리자 셸이 열림** | `restrict,command=` 포함 한 줄(약 168바이트)인지 `wc -c`로 확인 |
| `Saving key "~/.ssh/…" failed: No such file or directory` | PowerShell/cmd는 `~`를 확장하지 않음 | Git Bash 사용, 또는 `"$HOME\.ssh\…"` |
| `Could not resolve hostname 나의NAS도메인>` | 안내문의 `<…>` 꺾쇠까지 입력 | 안내 시 꺾쇠 없는 **실제 예시**를 함께 제시 |
| Actions test에서 `Cannot find module '@fastify/rate-limit'` 등 | 파일 일부만 커밋되어 main이 컴파일 불가 | 첫 push 전 `git status` 확인, 로컬에서 test 명령 실행 |
| 워크플로 파일 push 거부 가능성 | `gh` 토큰에 `workflow` scope 없음 | Git Credential Manager가 쓰이면 통과. 거부 시 `gh auth refresh -s workflow` |
| NAS에서 `bad interpreter: /bin/bash^M` | Windows `core.autocrlf=true`로 CRLF | `.gitattributes` `*.sh eol=lf` + 설치 시 `sed -i 's/\r$//'` |
| Caddy/nginx 컨테이너가 `port is already allocated` | DSM이 80/443 사용 | DSM 역방향 프록시 → `localhost:<포트>` |
| worker 생성 실패(`/dev/dri` 없음) | Intel 내장 GPU 없는 모델 | 사전 점검 `ls -l /dev/dri`, 없으면 compose의 `devices` 제거 |
| `scp` 실패 | DSM SFTP/scp 설정 | `scp -O`, 안 되면 SFTP 활성화 또는 File Station 업로드 후 `sudo mv` |
| PowerShell에서 `<` 리다이렉트/`$(…)` 불가, `>`는 BOM | 셸 차이 | Secret 등록·테스트는 Git Bash로 |
| 사용자가 "파워셸? NAS?" 하고 어느 창에서 실행할지 되물음 | 안내에 실행 위치·방식이 없었음 | 모든 블록에 `실행 위치 \| 실행 방식` 라벨 (위 6번) |

## 사용자 환경

실제 값은 **`local-env.md`**(git 제외)에 있다. 없으면 사용자에게 아래를 물어 만든다:
NAS 도메인, SSH 포트, DSM 관리자 계정, NAS 이름, GitHub 계정, PC 사용자 폴더, Git 설치 폴더,
이미 적용된 프로젝트(저장소·NAS 폴더·포트).

- 검증 환경: DSM 7 (OpenSSH 8.2, sshd `/bin/sshd`), Container Manager, Windows 10 + Git Bash + Docker Desktop + `gh` CLI
- 배포 계정 `gh-deploy` (administrators, 공유 폴더: `docker` 읽기 전용 / `homes` 기본 / 나머지 액세스 불가)
- 같은 NAS에 여러 프로젝트를 올릴 때는 NAS 폴더·포트·compose 프로젝트 이름이 겹치지 않게 한다
