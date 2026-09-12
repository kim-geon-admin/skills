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
npm install -g github:kim-geon-admin/skills
nas-deploy help
```

CLI를 설치하지 않고 스킬 폴더를 직접 clone해서 쓰는 경우에는
`node ~/.claude/skills/synology-docker-deploy/cli/nas-deploy.mjs help`로 실행할 수도 있다.

처음 설치하는 NAS라면 `init` 다음에 **`prepare`** 를 먼저 돌려 DSM 준비를 끝내야 `key` 가 성공한다.

| 명령 | 하는 일 |
| --- | --- |
| `prepare` | DSM에서 먼저 해야 할 일(계정 생성, 공유 폴더 권한, 홈 서비스, Container Manager)을 안내하고 NAS에서 실제로 됐는지 검사 |
| `init` | 질문에 답하면 워크플로·compose·배포 스크립트·.env·설정 파일 생성, 없으면 Dockerfile 초안까지 (액션 SHA도 최신으로 고정) |
| `login` | (선택) 관리자 열쇠를 NAS에 등록해 이후 SSH 비밀번호 입력을 없앰 |
| `key` | 배포 전용 열쇠 생성 → `authorized_keys`에 강제 명령으로 등록 → 호스트 키 저장·대조 → 접속 시험 |
| `nas` | 스크립트·compose·.env를 한 번의 접속으로 전송·설치, sudo 규칙 생성, 권한 확인 |
| `secrets` | GitHub Secret 5개 등록 |
| `doctor` | PC·저장소·GitHub·열쇠·NAS를 한 번에 점검하고 해결 방법 제시 (아무것도 바꾸지 않음) |
| `env` | `.env`를 NAS에 반영(CRLF·제어문자 정리)하고 재배포 실행 |
| `status` | 최근 실행 결과, 배포된 버전, 컨테이너 상태, 마지막 배포 로그 |

### init 이 만드는 파일

```text
.github/workflows/deploy.yml   GitHub 이 정한 위치라 여기에만 둘 수 있음
infra/synology/                나머지는 이 폴더 하나에 모임 (NAS_DEPLOY_DIR 로 변경 가능)
  compose.yaml                 NAS에서 컨테이너를 띄우는 설정
  deploy.sh                    NAS에서 교체·헬스체크·롤백
  deploy-gate.sh               배포 열쇠가 실행할 수 있는 유일한 명령
  .env                         NAS 전용 설정값 (git 제외)
  deploy.config.json           CLI 설정 (git 제외)
Dockerfile                     없을 때만, 프로젝트 종류에 맞는 초안 생성 (경로는 질문에서 지정)
.gitattributes                 *.sh eol=lf
.gitignore                     .env, deploy.config.json 항목 추가
```

Dockerfile 초안은 폴더 안의 파일로 종류를 추측해 만든다(`package.json`의 next → Next.js, `pom.xml` →
Spring/Tomcat, `requirements.txt` → Python, `go.mod` → Go, `index.html` → 정적 사이트). 도커가 실행 중이면
그 자리에서 `docker build`로 빌드되는지 확인하고, 실패하면 오류를 그대로 보여 준다. **초안일 뿐이므로
프로젝트에 맞게 손보는 것을 전제로 한다.**

### 지원 범위와 제한 (언어·프레임워크)

언어나 프레임워크 자체는 가리지 않는다. **"Dockerfile로 이미지를 만들 수 있고, 컨테이너가 계속 떠 있는 프로젝트"**면 된다.
빌드 방법은 전부 Dockerfile 안에서 처리하므로 CLI가 아는 것은 이미지 이름·포트·상태 확인 방법뿐이다.

| 프로젝트 | 되는가 | 설정에서 주의할 점 |
| --- | --- | --- |
| 정적 HTML/CSS/JS (nginx) | O | 포트는 이미지 설정대로(예: 8080), 상태 확인 `wget`. `read_only`면 `/var/cache/nginx`, `/var/run` tmpfs 필요 |
| Next.js / Node / Express | O | `output: 'standalone'` 권장, 포트 3000, 상태 확인 `node` |
| Python (FastAPI, Django, Flask) | O | gunicorn/uvicorn로 실행. slim 이미지엔 curl·wget이 없으니 상태 확인은 `none`이거나 Dockerfile에 설치 |
| Java / Spring Boot | O | 멀티스테이지로 jar 빌드 후 JRE 이미지에 복사. NAS 메모리 여유 확인 |
| JSP / Servlet (Tomcat) | O | `tomcat` 이미지에 war 복사. 포트 8080, 상태 확인 경로는 앱 컨텍스트에 맞춰 지정 |
| PHP / Laravel | O | php-fpm + nginx를 한 이미지에 넣거나 서비스 2개로 구성 |
| Go / Rust | O | 정적 바이너리 + `scratch`/`distroless`면 상태 확인은 `none` (셸·wget 없음) |
| 백그라운드 워커, 크론 | O | 포트·헬스체크 없이 서비스만 추가. 배포 스크립트는 "실행 중"만 확인 |
| 데이터베이스(Postgres 등) | 가능하지만 권장하지 않음 | 이미지가 CI에서 빌드되지 않으므로 compose에 직접 추가하고 백업 파일을 `BACKUP_FILES`에 넣을 것 |

**공통 제한**

- **Dockerfile이 반드시 있어야 한다.** 없으면 `init`이 종류에 맞는 초안을 만들어 주지만, 실행 명령과 빌드 산출물 경로는 프로젝트에 맞게 확인해야 한다.
- **linux/amd64 전용.** 워크플로가 amd64로 빌드한다. ARM 기반 Synology(예: 일부 J 시리즈)는 `platforms` 수정 필요.
- **한 프로젝트 = compose 스택 하나.** 서비스를 여러 개 둘 수 있지만, 두 번째 서비스부터는 compose에 볼륨·환경 변수를 직접 적어야 한다.
- **상태 확인 명령은 이미지 안에 있어야 한다.** 없는 명령을 고르면 컨테이너가 계속 "이상"으로 보여 롤백된다. 확실하지 않으면 `none`.
- **`read_only: true`가 기본.** 런타임이 쓰기를 요구하면(nginx 캐시, PHP 세션, 로그 파일) 해당 경로를 tmpfs로 열거나 볼륨을 붙여야 한다.
- **레지스트리는 GHCR 고정.** Docker Hub 등 다른 레지스트리는 워크플로와 배포 스크립트를 손봐야 한다.
- **빌드는 GitHub 러너에서 한다.** 유료 러너 없이 큰 이미지를 만들면 시간이 오래 걸린다(캐시는 켜져 있음).

### 여러 프로젝트에서 쓰기

CLI는 특정 프로젝트에 묶이지 않는다. **실행한 폴더의 설정**(`infra/synology/deploy.config.json`)을 읽으므로,
새 프로젝트에서는 그 저장소 폴더로 이동해 `nas-deploy init`부터 다시 하면 된다.

CLI를 전역 설치했다면 별칭 없이 모든 프로젝트에서 `nas-deploy` 명령을 사용할 수 있다.
설치하지 않은 경우에는 위의 직접 실행 명령을 별칭으로 등록해도 된다.

같은 NAS에 여러 프로젝트를 올릴 때 프로젝트마다 달라야 하는 값:

| 항목 | 이유 |
| --- | --- |
| 프로젝트 이름 = NAS 폴더 `/volume1/docker/<이름>` = compose 프로젝트명 | 폴더·컨테이너 이름 충돌 방지 |
| NAS 내부 포트(`HTTP_BIND`)와 역방향 프록시 외부 포트 | 포트 충돌 방지 |
| 배포 열쇠와 `authorized_keys` 줄 (`github-actions@<프로젝트>`) | 키 하나가 뚫려도 다른 프로젝트에 영향 없음 |
| `/etc/sudoers.d/<프로젝트>-deploy` | 프로젝트별 배포 스크립트만 허용 |

배포 계정(`gh-deploy`), DSM 관리자 계정, 관리자 열쇠(`login`)는 NAS 단위라 프로젝트끼리 공유해도 된다.

- 비밀번호는 저장하지 않는다. 명령 하나당 한 번만 물어보고 메모리에서만 쓴다(`sudo -S`로 전달).
- 파일 전송은 scp 대신 같은 SSH 접속으로 보낸다(SFTP 설정과 무관, 접속 1회).
- DSM 웹에서만 가능한 일(계정 생성, 공유 폴더 권한, 역방향 프록시, 공유기 포워딩)은 자동화하지 않는다. `prepare` 가 순서대로 안내하고, 계정·그룹·홈 접근·docker 폴더 접근·compose·sudoers.d 를 실제로 확인해 남은 것만 알려 준다.
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
