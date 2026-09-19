# 기존 NAS 배포 워크플로 보안 검토 체크리스트

전형적인 형태: `docker/login-action`(Docker Hub) → `build-push-action`(latest) →
`appleboy/ssh-action`으로 NAS 접속 → heredoc으로 compose 작성 → `docker login -p` → `rm -f` → `compose pull/up`.
아래 순서가 대략적인 심각도 순이다.

| # | 확인 항목 | 문제 | 권장 |
| --- | --- | --- | --- |
| 1 | 배포 계정의 docker 권한 방식 | docker 그룹/`sudo docker` 허용은 root와 같다(`docker run -v /:/host`). 키에 명령 제한이 없으면 키 유출 = NAS 장악 | `authorized_keys`에 `restrict,command=` 강제 명령, sudo NOPASSWD는 배포 스크립트 하나 |
| 2 | 호스트 키 검증 | `appleboy/ssh-action`에 `fingerprint` 없음 → MITM이 스크립트와 `envs`의 토큰을 받음 | known_hosts Secret + `StrictHostKeyChecking=yes` |
| 3 | NAS로 넘기는 레지스트리 토큰 | push 권한 토큰을 NAS에서 재사용(공급망 위험), `docker login -p`는 프로세스 목록 노출, `~/.docker/config.json`에 영구 저장 | job의 `GITHUB_TOKEN`을 stdin으로, 임시 `DOCKER_CONFIG`, 최소한 `--password-stdin` + read 전용 토큰 |
| 4 | 서드파티 액션 참조 방식 | 태그(`@v1.2.0`)는 이동 가능(2025 tj-actions 사건). SSH 개인 키를 받는 액션이면 치명적 | 전체 커밋 SHA 고정, SSH는 러너 기본 `ssh` 사용 |
| 5 | 배포 순서 | `rm -f`로 먼저 삭제 후 pull → 실패 시 서비스 다운으로 종료. `latest`만 쓰면 롤백 불가, 연속 실행 시 다른 빌드를 받을 수 있음 | pull → 검증 → 교체 → 헬스 체크 → 롤백, 커밋 SHA 태그 |
| 6 | 트리거와 권한 | `workflow_dispatch`로 아무 브랜치에서 `latest` push, concurrency 없음, 테스트 없이 배포, job 권한 미지정 | build/deploy에 `if: main`, `concurrency`, test job 선행, 최상위 `permissions: contents: read` |
| 7 | 이미지 공개 범위 | Docker Hub 공개 저장소면 이미지 속 소스 전체 공개. 무료 플랜 private 저장소는 1개 | GHCR(private 저장소의 패키지는 기본 private), `persist-credentials: false` |
| 8 | SSH 노출 | 포트 변경은 보호가 아님. GitHub 러너 IP 대역이 넓어 사실상 인터넷 전체에 개방 | 키 전용 + 자동 차단, 가능하면 Tailscale Action으로 포트포워딩 제거 |

추가로 볼 것:

- compose를 CI가 매번 NAS에 쓰는가 → push 권한 = NAS root. 수동 설치로 분리.
- `cat docker-compose.yml`, `env` 출력 등으로 비밀이 Actions 로그에 찍히는가.
- `.dockerignore`에 `.git`, `.env`, 자격 증명 파일이 빠져 있는가.
- 컨테이너 포트가 `0.0.0.0`으로 열려 역방향 프록시를 우회할 수 있는가 → `127.0.0.1:<포트>`.
- 영속 데이터(DB) 백업 없이 스키마 변경 버전을 배포하는가.
