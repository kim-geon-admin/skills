# skills

Claude Code 개인 스킬 모음. 이 저장소는 **`~/.claude/skills` 폴더 자체로 clone해서** 쓴다.
Claude Code는 `~/.claude/skills/<스킬 이름>/SKILL.md`를 자동으로 읽으므로, 여기서 고치고 push하면 끝이다.

## 스킬 목록

| 스킬 | 설명 |
| --- | --- |
| [synology-github-actions-docker-deploy](synology-github-actions-docker-deploy/SKILL.md) | GitHub Actions로 이미지를 빌드해 Synology NAS Docker에 안전하게 자동 배포(롤백 포함). 설정을 대신 해 주는 `nas-deploy` CLI 포함 |

## 구조

```text
~/.claude/skills/              ← 이 저장소
├─ README.md
├─ .gitattributes
└─ <스킬 이름>/                  ← 스킬 하나 = 폴더 하나
   ├─ SKILL.md                  (필수) frontmatter의 name/description + 지침
   ├─ references/               필요할 때 읽는 상세 문서
   ├─ templates/                프로젝트에 복사해 쓰는 파일
   └─ scripts/                  검증·보조 스크립트
```

- 폴더 이름 = `SKILL.md` frontmatter의 `name` (소문자와 하이픈)
- `description`에 "언제 쓰는지"를 구체적으로 적는다. Claude가 이 문장으로 스킬 사용 여부를 판단한다.

## 새 PC에 설치

**PC · Git Bash | 한 줄씩**
```bash
git clone https://github.com/kim-geon-admin/skills.git ~/.claude/skills
```

`~/.claude/skills`가 이미 있으면 먼저 옮겨 두고 clone한 뒤, 기존 스킬 폴더를 다시 넣는다.

**PC · Git Bash | 한 줄씩**
```bash
mv ~/.claude/skills ~/.claude/skills.bak
git clone https://github.com/kim-geon-admin/skills.git ~/.claude/skills
```

## 스킬 추가·수정 후 올리기

**PC · Git Bash | 한 줄씩**
```bash
cd ~/.claude/skills
git status
git add <스킬 폴더>
git commit -m "Add <스킬 이름> skill"
git push
```

다른 PC에서 받기: `cd ~/.claude/skills && git pull`

## 주의

- 개인 키, 토큰, 비밀번호는 절대 넣지 않는다.
- **이 저장소는 공개되어 있다.** 도메인·포트·계정 이름 같은 개인 환경 값은 문서에 `나의NAS도메인`,
  `나의관리자계정` 같은 **대체어**로만 쓴다.
  실제 값은 각 스킬 폴더의 **`local-env.md`**에 두며, 이 파일은 `.gitignore`로 올라가지 않는다.
  새 PC에서는 `local-env.md`가 없으므로 스킬을 처음 쓸 때 Claude가 값을 물어 새로 만든다.
- 커밋 전 확인: `git status`에 `local-env.md`가 보이면 안 된다.
- Windows에서 `core.autocrlf=true`여도 스크립트가 LF로 유지되도록 `.gitattributes`를 둔다.

## 라이선스

[MIT](LICENSE). 자유롭게 사용·수정·재배포할 수 있으며, 저작권 표시와 라이선스 전문을 함께 남기면 된다.
제공되는 그대로 쓰는 것이며 보증은 없다.

## 설정 질문 동작

`deploy.config.json`이 있어도 `init`은 매번 설정 항목을 질문합니다. 저장된 값은 각 질문의 기본값으로 참고하며, Enter를 누르면 기존 값을 유지합니다.

## CLI 설치

Node.js 20 이상이면 저장소에서 CLI를 바로 설치할 수 있습니다.

```bash
npm install -g github:kim-geon-admin/skills
nas-deploy help
```

`nas-deploy secrets`는 프로젝트 설정의 `owner/project` 저장소를 자동 지정해 NAS 접속용 GitHub Actions Secret 5개를 직접 등록하고 결과를 확인합니다. 별도로 `gh secret set` 명령을 입력할 필요가 없습니다.

`nas-deploy init`은 NAS 주소, SSH 포트, DSM 관리자 계정, 배포 계정, **NAS 배포 폴더**를
사용자에게 직접 묻습니다. `/volume1/docker` 같은 경로를 자동으로 가정하지 않으며,
예시는 `/volume2/apps/나의프로젝트`일 뿐 실제 NAS 폴더를 입력해야 합니다.

`nas-deploy init`에서는 DSM 관리자 비밀번호 입력 방식을 선택합니다. `prompt`는 명령마다
PowerShell에서 직접 입력하고, `temporary`는 `nas-deploy session` 실행 중 한 번만 입력합니다.
temporary 모드는 Windows DPAPI로 암호화한 임시 파일을 세션 동안만 사용하며, 성공·실패와
관계없이 세션이 끝나면 자동 삭제합니다.

`nas-deploy prepare`는 선택한 배포 계정이 이미 있는지 먼저 확인합니다. 계정이 없으면
DSM의 제어판 → 사용자 및 그룹에서 만들도록 안내하고, 사용자가 완료했다고 답한 뒤
같은 NAS 점검을 다시 실행합니다. 이미 조건을 만족하는 계정이면 그 계정을 사용할지
명시적으로 확인하며, `N`으로 답하면 신규 배포 계정 생성 여부와 신규 배포 계정 ID를 물은 뒤
`administrators`, `homes`, 배포 공유 폴더 읽기 전용 권한을 등록하도록 안내합니다.
새 계정 재확인이 성공해야 이후 단계에서 사용할 계정으로 저장합니다.

`.env`에는 앱이 필요한 설정만 넣습니다. DSM 관리자 비밀번호나 SSH 개인 키는 `.env`에
저장하지 않습니다. 관리자 비밀번호는 선택한 입력 정책으로 세션 중에만 사용하고,
SSH 개인 키는 사용자 PC의 프로젝트별 경로에서 읽어 GitHub Secret에 등록합니다.

같은 `init` 단계에서 앱 접속 방식과 포트를 구분해 입력합니다. 역방향 프록시면
`나의 도메인:포트번호 → 127.0.0.1:Synology Docker 연결 포트 → 실제 컨테이너 포트`,
내부 전용이면 `NAS 내부 IP:Synology Docker 연결 포트 → 실제 컨테이너 포트`로
기록하고, 생성되는 `.env`의 `HTTP_BIND`에도 반영합니다.
`127.0.0.1`은 NAS 자신 또는 NAS 역방향 프록시만 접근할 때 사용하고, 같은 네트워크의
다른 기기에서 접근하려면 Synology 내부 IP를 사용합니다.

테스트 후 이 프로젝트의 NAS 배포 흔적만 되돌리려면 프로젝트 폴더에서
`nas-deploy cleanup`을 실행하세요. `gh-deploy` 계정과 다른 `authorized_keys` 줄,
앱의 `data`·`cache`, GHCR 이미지는 보존하고, 이 프로젝트에 해당하는 키 줄·sudo 규칙·컨테이너·배포 파일만 제거합니다. 비밀번호 입력 방식은 `init`에서 선택한 정책을 따릅니다.

설치 후에는 프로젝트 저장소 폴더에서 `nas-deploy init`부터 실행합니다. CLI는
`synology-github-actions-docker-deploy` 스킬 파일과 함께 설치되며, 별도 의존성이 필요하지 않습니다.

위의 `git clone` 방식은 Claude Code가 스킬을 자동으로 읽게 할 때 사용하고, CLI만
사용하려면 npm 설치 방식만 실행하면 됩니다. 이미 설치한 CLI를 최신 버전으로
갱신하려면 같은 `npm install -g` 명령을 다시 실행하세요.
