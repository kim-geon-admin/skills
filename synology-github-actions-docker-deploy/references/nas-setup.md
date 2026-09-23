# NAS·GitHub 설정 절차

사용자에게 **한 번에 한 단계씩** 안내한다. 이 문서의 명령은 `나의NAS도메인` 같은 **대체어**로 쓴 예시다.
사용자에게 보여 줄 때는 `../local-env.md`(이 PC의 실제 값, git에 올리지 않음)의 값으로 바꿔서 보여 준다.
그 파일이 없으면 아래 "대체어" 표의 항목을 사용자에게 물어 `local-env.md`를 새로 만든다.

## 안내 규칙 (반드시 지킬 것)

1. **모든 코드 블록 바로 위에 `실행 위치 | 실행 방식` 라벨을 붙인다.** 사용자에게 옮겨 적을 때도 라벨을 빼지 않는다.
2. 값은 실제 값으로 바꿔서 보여 준다. `<…>` 꺾쇠 표기는 쓰지 않는다(사용자가 꺾쇠까지 입력했던 적이 있음).
3. 각 블록 뒤에 **기대 결과 예시**와, 다르게 나오면 보여 달라고 할 출력을 적는다.
4. `sudo`가 들어간 블록을 **한꺼번에** 붙여 넣게 할 때는 먼저 `sudo -v`를 **한 줄로** 실행하게 한다.
   비밀번호 프롬프트가 떠 있는 상태에서 여러 줄을 붙여 넣으면 나머지 줄이 비밀번호 입력으로 먹힌다.

### 실행 위치

| 라벨 | 어디인가 | 프롬프트 모양 | 여는 방법 |
| --- | --- | --- | --- |
| **PC · Git Bash** | 내 PC의 Git Bash | `나의PC계정@PC이름 MINGW64 ~ $` | 시작 메뉴 "Git Bash" (`Git 설치 폴더\git-bash.exe`) |
| **PC · PowerShell** | 내 PC의 PowerShell | `PS C:\Users\나의PC계정>` | 시작 메뉴 "PowerShell" |
| **NAS · SSH 창** | DSM 관리자로 NAS에 SSH 접속한 터미널 | `나의관리자계정@나의NAS이름:~$` | 아래 "NAS 접속" |
| **DSM 웹** | 브라우저의 DSM 화면 | — | DSM 로그인 |
| **GitHub 웹** | github.com 저장소 화면 | — | 저장소 → Settings / Actions |
| **공유기** | 공유기 관리 페이지 | — | 보통 `http://192.168.0.1` |

**PC 명령은 기본적으로 Git Bash.** PowerShell에서는 `~` 경로(확장 안 됨), `<` 입력 리다이렉트(미지원),
`$(…)`·`{1..40}` 같은 bash 문법이 동작하지 않고, `>`로 저장한 파일은 인코딩이 달라진다.
PowerShell 라벨은 대안이 꼭 필요한 곳에만 쓴다.

### 실행 방식

| 라벨 | 하는 법 |
| --- | --- |
| **한꺼번에** | 블록 전체를 복사해 한 번에 붙여 넣는다. 마지막 줄까지 실행되면 결과를 본다 |
| **한 줄씩** | 한 줄 붙여 넣고 Enter → 결과를 확인한 뒤 다음 줄 (비밀번호 입력이 있거나 결과를 봐야 하는 명령) |
| **입력 대기** | 명령을 실행하면 커서만 깜빡인다 → 내용을 붙여 넣는다 → **Enter** → **`Ctrl + D`** 로 저장하고 빠져나온다 |
| **화면 조작** | 웹 화면에서 클릭으로 설정 |

프롬프트가 `>`로 바뀌고 멈추면 따옴표가 안 닫힌 것이다 → **`Ctrl + C`** 후 다시.

### 대체어

| 대체어 | 의미 | 바꿀 때 |
| --- | --- | --- |
| `나의프로젝트` | 프로젝트 이름(소문자). NAS 폴더 `/volume1/docker/나의프로젝트`, 키 파일 `나의프로젝트_deploy` | 프로젝트마다 |
| `나의NAS도메인` | NAS 도메인 | NAS가 다르면 |
| `나의SSH포트` | NAS SSH 포트 | NAS가 다르면 |
| `나의관리자계정` | DSM 관리자 계정 | NAS가 다르면 |
| `gh-deploy` | 배포 전용 계정 (고정) | 바꾸지 않음 |
| `3100` | 앱이 NAS 안에서만 여는 포트 | 프로젝트마다 겹치지 않게 |
| `나의외부포트` | 역방향 프록시 외부 포트 | 프로젝트마다 겹치지 않게 |
| `나의NAS이름` | NAS 호스트 이름 (NAS 프롬프트에 보임) | NAS가 다르면 |
| `나의깃허브계정` | GitHub 계정 (GHCR 이미지 소유자, 소문자) | 계정이 다르면 |
| `나의PC계정` | Windows 사용자 폴더 이름 (`C:\Users\나의PC계정`) | PC가 다르면 |
| `D:\나의저장소경로` | PC의 저장소 경로 (Git Bash에서는 `/d/나의저장소경로`) | 프로젝트마다 |

---

## NAS 접속

**PC · Git Bash 또는 PC · PowerShell | 한 줄씩**
```bash
ssh -p 나의SSH포트 나의관리자계정@나의NAS도메인
```
DSM 관리자 비밀번호 입력 → 프롬프트가 `나의관리자계정@나의NAS이름:~$`로 바뀌면 NAS 안이다.
창을 두 개(PC Git Bash 하나, NAS SSH 창 하나) 띄워 두고 진행하면 헷갈리지 않는다.

## 0. DSM 준비

**DSM 웹 | 화면 조작**
- 패키지 센터 → Container Manager 설치
- 제어판 → 터미널 및 SNMP → SSH 서비스 활성화, 포트 `나의SSH포트`
- 제어판 → 사용자 및 그룹 → 고급 → **사용자 홈 서비스 활성화** (꺼져 있으면 키를 둘 홈 폴더가 없음)
- 제어판 → 보안 → 보호 → 자동 차단 활성화

**공유기 | 화면 조작** TCP `나의SSH포트` → NAS 포트포워딩

이미 다른 프로젝트로 설정했다면 확인만 한다.

## 1. 배포 계정 만들기

**DSM 웹 | 화면 조작** 제어판 → 사용자 및 그룹 → 생성 → `init`에서 선택한 배포 계정 이름
- 비밀번호: 32자 이상 무작위(비밀번호 관리자에 보관). 로그인에 쓰지 않음.
- 그룹: `administrators` — DSM 7은 관리자만 SSH 로그인 가능. 키는 강제 명령으로 묶여 셸을 못 얻는다.
- 공유 폴더 권한: **배포 경로가 속한 공유 폴더 = 읽기 전용, `homes` = "액세스 불가" 체크 해제(빈칸), 나머지 = 액세스 불가.**
  예를 들어 배포 경로가 `/volume1/docker/나의프로젝트`이면 `docker`가 해당 공유 폴더이고,
  `/volume2/apps/나의프로젝트`이면 `apps`가 해당 공유 폴더다.
  Synology ACL은 `chmod`보다 우선한다. `homes`가 막히면 키 파일을 못 읽어 비밀번호를 묻고,
  배포 경로가 속한 공유 폴더가 막히면 `deploy-gate.sh`가 Permission denied.

계정이 이미 있으면(다른 프로젝트와 공유) `prepare`가 사용할지 묻는다. 기존 계정 사용에 `N`으로 답하면
신규 계정 ID를 입력받고 이 절차를 다시 안내한다. 새 계정 생성과 권한 등록 뒤 재확인이 성공해야 다음 단계로 간다.
키는 **프로젝트별로 따로** 만들고 `authorized_keys`에
프로젝트마다 한 줄씩 추가한다(3단계에서 `tee` 대신 `tee -a`로 추가).

## 2. SSH 키 생성

**PC · Git Bash | 한 줄씩**
```bash
ssh-keygen -t ed25519 -a 100 -C "github-actions@나의프로젝트" -f ~/.ssh/나의프로젝트_deploy
```
암호(passphrase)를 두 번 물으면 **Enter, Enter** (CI가 입력할 수 없으므로 비움).

Git Bash를 못 쓸 때만 **PC · PowerShell | 한 줄씩**
```powershell
ssh-keygen -t ed25519 -a 100 -C "github-actions@나의프로젝트" -f "$HOME\.ssh\나의프로젝트_deploy"
```
PowerShell에서 `~/.ssh/…`로 쓰면 `Saving key "~/.ssh/…" failed: No such file or directory`가 난다.

기대 결과: `C:\Users\나의PC계정\.ssh\`에 `나의프로젝트_deploy`(개인 키), `나의프로젝트_deploy.pub`(공개 키).

## 3. authorized_keys 등록

**PC · Git Bash | 한 줄씩** 등록할 한 줄 만들기 (공개 키는 비밀이 아니라 Claude가 PC에서 대신 실행해 보여 줘도 된다)
```bash
echo "restrict,command=\"/volume1/docker/나의프로젝트/bin/deploy-gate.sh\" $(tr -d '\r' < ~/.ssh/나의프로젝트_deploy.pub)"
```
기대 결과 예시 (이 한 줄 전체를 복사):
```text
restrict,command="/volume1/docker/나의프로젝트/bin/deploy-gate.sh" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA...(나의공개키) github-actions@나의프로젝트
```

**NAS · SSH 창 | 한 줄씩 (세 번째 줄은 입력 대기)**
```bash
sudo mkdir -p /var/services/homes/gh-deploy/.ssh
sudo -v
sudo tee /var/services/homes/gh-deploy/.ssh/authorized_keys > /dev/null
```
- `sudo -v`에서 DSM 관리자 비밀번호 입력
- 세 번째 줄 후 커서만 깜빡이면 → 복사한 한 줄 붙여 넣기 → **Enter** → **`Ctrl + D`**
- 기존 내용은 덮어쓴다. 다른 프로젝트 키를 **추가**할 때는 `sudo tee -a …`

**NAS · SSH 창 | 한꺼번에** (바로 위에서 `sudo -v`를 했으므로 한꺼번에 붙여 넣어도 된다)
```bash
sudo chown -R gh-deploy:users /var/services/homes/gh-deploy/.ssh
sudo chmod 755 /var/services/homes/gh-deploy
sudo chmod 700 /var/services/homes/gh-deploy/.ssh
sudo chmod 600 /var/services/homes/gh-deploy/.ssh/authorized_keys
sudo wc -c /var/services/homes/gh-deploy/.ssh/authorized_keys
sudo -u gh-deploy cat /var/services/homes/gh-deploy/.ssh/authorized_keys
```
기대 결과 예시:
```text
168 /var/services/homes/gh-deploy/.ssh/authorized_keys
restrict,command="/volume1/docker/나의프로젝트/bin/deploy-gate.sh" ssh-ed25519 AAAAC3Nza... github-actions@나의프로젝트
```
- `wc -c`가 105 근처면 `restrict,command=` 앞부분이 빠진 것 → 위 등록을 다시 (빠진 채로 두면 키로 관리자 셸이 열림)
- 마지막 줄이 `Permission denied`면 1단계 `homes` 공유 폴더 권한

## 4. sudo 규칙

**NAS · SSH 창 | 한 줄씩**
```bash
sudo grep -n includedir /etc/sudoers
```
기대 결과 예시: `…:#includedir /etc/sudoers.d` (앞의 `#`은 주석이 아니라 문법). 아무것도 안 나오면 멈추고 확인.

**NAS · SSH 창 | 한꺼번에**
```bash
echo 'gh-deploy ALL=(root) NOPASSWD: /volume1/docker/나의프로젝트/bin/deploy.sh' | sudo tee /etc/sudoers.d/나의프로젝트-deploy
sudo chmod 440 /etc/sudoers.d/나의프로젝트-deploy
sudo -l -U gh-deploy
```
기대 결과 예시:
```text
User gh-deploy may run the following commands on 나의NAS이름:
    (ALL) ALL
    (root) NOPASSWD: /volume1/docker/나의프로젝트/bin/deploy.sh
```
`(ALL) ALL`은 administrators 기본 권한(비밀번호 필요)이라 정상. 프로젝트가 여러 개면 파일도 프로젝트별로 하나씩.

## 5. 스크립트 설치

**PC · Git Bash | 한 줄씩** (계정은 gh-deploy가 아니라 **DSM 관리자**)
```bash
cd /d/나의저장소경로
scp -O -P 나의SSH포트 infra/synology/compose.yaml infra/synology/deploy.sh infra/synology/deploy-gate.sh 나의관리자계정@나의NAS도메인:/tmp/
```
DSM 관리자 비밀번호 입력 → 파일 3개 전송.
- `unknown option -- O` → `-O`를 빼고 다시
- `subsystem request failed` / `Connection closed` → **DSM 웹** 제어판 → 파일 서비스 → FTP → SFTP 활성화 후 다시
- 계속 안 되면 **DSM 웹 | 화면 조작** File Station으로 세 파일을 `docker` 공유 폴더에 업로드 → 이어서
  **NAS · SSH 창 | 한 줄씩** `sudo mv /volume1/docker/compose.yaml /volume1/docker/deploy.sh /volume1/docker/deploy-gate.sh /tmp/`

**NAS · SSH 창 | 한 줄씩** 먼저 비밀번호 캐시
```bash
sudo -v
```

**NAS · SSH 창 | 한꺼번에** (창을 새로 열었다면 `D=` 줄이 반드시 포함되게)
```bash
D=/volume1/docker/나의프로젝트
sudo mkdir -p $D/bin $D/data
sudo sed -i 's/\r$//' /tmp/deploy.sh /tmp/deploy-gate.sh
sudo mv /tmp/compose.yaml $D/compose.yaml
sudo mv /tmp/deploy.sh /tmp/deploy-gate.sh $D/bin/
sudo chown -R root:root $D/bin $D/compose.yaml
sudo chmod 755 $D $D/bin $D/bin/deploy-gate.sh
sudo chmod 700 $D/bin/deploy.sh
sudo chmod 644 $D/compose.yaml
sudo ls -la $D $D/bin
```
기대 결과 예시:
```text
/volume1/docker/나의프로젝트/bin:
-rwxr-xr-x 1 root root ... deploy-gate.sh
-rwx------ 1 root root ... deploy.sh
```

## 6. .env 와 사전 점검

**NAS · SSH 창 | 입력 대기**
```bash
sudo tee /volume1/docker/나의프로젝트/.env > /dev/null
```
프로젝트의 `compose.yaml`이 요구하는 변수를 넣어 붙여 넣기 → **Enter** → **`Ctrl + D`**
(템플릿 compose 기준 예시. 앱 고유 변수는 프로젝트에 맞게 추가):
```dotenv
DATA_DIR=/volume1/docker/나의프로젝트/data
HTTP_BIND=127.0.0.1:3100
APP_ADMIN_USERNAME=나의앱관리자
APP_ADMIN_PASSWORD='나의앱비밀번호'
```
- 런타임 비밀은 GitHub에 올리지 않고 이 파일에만 둔다. `$`가 들어간 값은 작은따옴표로 감싼다(compose가 `$`를 변수로 해석).
- 필요한 값이 없어도 빈 파일은 만든다(배포 스크립트가 요구).

**NAS · SSH 창 | 한꺼번에**
```bash
sudo chmod 600 /volume1/docker/나의프로젝트/.env
sudo ls -la /volume1/docker/나의프로젝트/.env
sudo docker compose version
ls -l /dev/dri
```
기대 결과 예시: `-rw------- 1 root root ... .env`, `Docker Compose version v2.x.x`, `/dev/dri` 아래 `card0`·`renderD128`.
`/dev/dri`는 Intel QSV를 쓰는 서비스가 있을 때만 필요 — 없다고 나오면 compose의 `devices`를 뺀다.

## 7. 연결 테스트

**PC · Git Bash | 한 줄씩** (결과를 하나씩 확인. Claude가 대신 실행할 때는 `K`에 `-o BatchMode=yes`를 넣어 비밀번호 프롬프트를 막는다)
```bash
K="-i $HOME/.ssh/나의프로젝트_deploy -o IdentitiesOnly=yes -p 나의SSH포트"
ssh $K gh-deploy@나의NAS도메인 whoami
ssh $K gh-deploy@나의NAS도메인 "deploy $(printf '0%.0s' {1..40})" < /dev/null
```
기대 결과 예시:
```text
deploy-gate: rejected request
[deploy 2026-09-12 01:15:32] ERROR: registry credentials were not provided on stdin
```
- 첫 줄(`K=…`)은 출력이 없다. Git Bash를 닫았다 열면 다시 실행해야 한다.
- 처음 접속이면 `yes/no` 질문에 `yes`. **비밀번호를 물으면 입력하지 말고 `Ctrl + C`.**

| 결과 | 원인·조치 |
| --- | --- |
| 비밀번호 요구 / `Permission denied (publickey,password)` | **PC · Git Bash** `ssh -v $K gh-deploy@나의NAS도메인 whoami`로 `Offering public key` 확인 → 제시했는데 거부면 **NAS · SSH 창** `sudo -u gh-deploy cat /var/services/homes/gh-deploy/.ssh/authorized_keys` → Permission denied면 1단계 `homes` 권한 |
| `deploy-gate.sh: Permission denied` (exit 126) | 1단계 배포 경로가 속한 공유 폴더를 읽기 전용으로 |
| `deploy-gate.sh: No such file or directory` | 5단계 경로 |
| `sudo: a password is required` | 4단계 (DSM 업데이트로 초기화됐을 수도) |

sshd 설정이 의심되면 **NAS · SSH 창 | 한 줄씩**
```bash
sudo /bin/sshd -T -C user=gh-deploy,host=localhost,addr=127.0.0.1 | grep -iE '^(pubkey|authorizedkeys|strictmodes|allowusers|allowgroups|denyusers|denygroups)'
```

## 8. known_hosts 값 만들기

**PC · Git Bash | 한꺼번에**
```bash
cd /d/나의저장소경로
ssh-keyscan -p 나의SSH포트 -t ed25519 나의NAS도메인 > nas_known_hosts
ssh-keygen -lf nas_known_hosts
```

**NAS · SSH 창 | 한 줄씩** 지문 대조
```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```
두 결과의 `SHA256:…` 값이 같아야 한다. LAN에서 도메인 접속이 안 되면(NAT 루프백) NAS에서 직접 만든다:

**NAS · SSH 창 | 한 줄씩**
```bash
printf '[나의NAS도메인]:나의SSH포트 %s\n' "$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"
```
기대 결과 예시: `[나의NAS도메인]:나의SSH포트 ssh-ed25519 AAAAC3Nza...` 한 줄.
포트가 22가 아니면 대괄호와 포트 필수, 호스트는 `NAS_SSH_HOST` 값과 글자까지 같아야 한다.

## 9. GitHub Secrets

**권장: PC · 저장소 폴더 | 대화형 CLI**
```bash
nas-deploy secrets
```
CLI가 설정 파일의 `owner/project` 저장소를 자동 지정하고, NAS 접속용 Secret 5개를 직접 등록한 뒤 결과를 확인합니다.
따라서 아래의 `gh secret set` 명령을 수동으로 입력할 필요가 없습니다. GitHub 로그인이 안 되어 있으면 브라우저 인증만 진행합니다.

**PC · Git Bash | 한꺼번에** (8단계의 `nas_known_hosts`가 있는 저장소 루트에서)
```bash
cd /d/나의저장소경로
gh secret set NAS_SSH_HOST --body "나의NAS도메인"
gh secret set NAS_SSH_PORT --body "나의SSH포트"
gh secret set NAS_SSH_USER --body "gh-deploy"
gh secret set NAS_SSH_PRIVATE_KEY < ~/.ssh/나의프로젝트_deploy
gh secret set NAS_SSH_KNOWN_HOSTS < nas_known_hosts
gh secret list
```
기대 결과: `gh secret list`에 5개(`NAS_SSH_HOST`, `NAS_SSH_KNOWN_HOSTS`, `NAS_SSH_PORT`, `NAS_SSH_PRIVATE_KEY`, `NAS_SSH_USER`).
PowerShell은 `<`를 지원하지 않고 복사 시 CRLF가 섞여 `Load key: invalid format`이 날 수 있으니 Git Bash로.
또는 **GitHub 웹 | 화면 조작** Settings → Secrets and variables → Actions → New repository secret
(개인 키는 `-----BEGIN`~`END-----` 줄 포함). 레지스트리 토큰은 등록하지 않는다(`GITHUB_TOKEN` 사용).

## 10. 역방향 프록시

**DSM 웹 | 화면 조작**
- 제어판 → 로그인 포털 → 고급 → 역방향 프록시 → 생성
  - 소스: `HTTPS` / `나의NAS도메인` / `나의외부포트` (예: `nayaguny.synology.me` / `1001`)
  - 대상: `HTTP` / `localhost` / `3100`
- 제어판 → 보안 → 인증서 → 설정: 이 항목에 `나의NAS도메인` 인증서 지정
- 방화벽 사용 시: `나의외부포트`, `나의SSH포트` 허용

**공유기 | 화면 조작** TCP `나의외부포트` → NAS 포워딩. `3100`(내부 포트)은 포워딩 금지.

## 11. 첫 배포와 마무리

**PC · Git Bash | 한 줄씩** push 전 로컬 검증 (test job과 같은 명령. 커밋 안 된 파일이 있는지 꼭 본다)
```bash
cd /d/나의저장소경로
git status
pnpm typecheck
pnpm test
```

**PC · Git Bash | 한 줄씩** push 후 실행 결과 지켜보기
```bash
gh run watch
```

**GitHub 웹 | 화면 조작** 프로필 → Packages → `나의프로젝트-app`, `나의프로젝트-worker`: **Private**인지,
Package settings → Manage Actions access에 저장소가 있는지.

**NAS · SSH 창** 접속 확인 후 `.env`의 초기 관리자 비밀번호 같은 일회성 값을 비움 (6단계 방식으로 다시 작성).

**PC · Git Bash | 한 줄씩** **첫 배포 성공 후에** 개인 키와 known_hosts 파일 삭제 (그 전엔 Secret 재등록용으로 보관)
```bash
rm ~/.ssh/나의프로젝트_deploy /d/나의저장소경로/nas_known_hosts
```

## 운영

- 재배포: **GitHub 웹** Actions → deploy → Run workflow. 같은 태그면 무중단 reconcile(NAS `.env`/compose 변경 반영용)
- 과거 버전으로: **GitHub 웹** 해당 실행의 `deploy` job만 Re-run
- 긴급 수동 롤백 **NAS · SSH 창 | 한 줄씩** (`sudo -i`가 비밀번호를 묻고 셸이 root로 바뀌므로 반드시 한 줄씩)
  ```bash
  sudo -i
  cd /volume1/docker/나의프로젝트
  IMAGE_TAG=$(cat state/previous-tag) docker compose --env-file .env -f compose.yaml up -d
  cp state/previous-tag state/current-tag
  exit
  ```
- 백업 복원 **NAS · SSH 창**: `compose stop` → `backups/<시각>-<태그>/` 파일을 원위치로 복사 → `up -d`
- 배포 로그 **NAS · SSH 창 | 한 줄씩** `sudo ls /volume1/docker/나의프로젝트/state/logs/` — GitHub에서 연결 끊김으로 실패해 보여도 NAS에서는 끝까지 실행된다
- 키 교체: 6~12개월 또는 유출 의심 시 2·3·9단계
- DSM 업데이트 후 배포 실패 시 `sudoers.d`, `sshd_config` 초기화 여부부터 확인
- SSH 포트를 인터넷에 열지 않으려면 Tailscale GitHub Action으로 러너를 tailnet에 붙이고 `NAS_SSH_HOST`만 교체
