# Configured Deployment Input Design

## Goal

Make `nas-deploy` ask for every deployment-specific value, show generic route examples, and display the resolved values before NAS installation or GitHub Secrets registration. No NAS volume, folder, hostname, port, Windows user, or project name is assumed.

## Scope

- Improve `init` prompts, validation, and final configuration summary.
- Check whether the selected deployment account already exists on the NAS before key registration.
- Show generic examples for reverse proxy and internal-only routes.
- Make key, NAS-install, and Secrets screens use resolved values from the current configuration.
- Document the configuration source and route meanings in the skill and README.

## Configuration Model

`infra/synology/deploy.config.json` remains the local, ignored source of truth. `init` collects the following values and writes them there:

- `project`, `owner`
- `nas.host`, `nas.port`, `nas.adminUser`, `nas.deployUser`, `nas.dir`
- `keyPath`
- `network.mode`, `network.publicUrl`, `network.publicPort`, `network.bindHost`
- `hostPort`, `containerPort`

Existing values are offered as defaults on a later `init` run. A new configuration has no guessed NAS host, account, or NAS directory. Required values reject empty input and generic example text.

`infra/synology/.env` remains application runtime configuration uploaded to the NAS. It must not contain the DSM password or SSH private-key contents. The private key remains on the PC at `keyPath`, and GitHub Secrets reads it directly from that path.

## Deployment Account Selection

`init` asks for the deployment account name but does not assume that the account exists. `prepare` connects to the NAS with the DSM administrator and checks the selected account before any public key is registered.

- When the account exists, the CLI shows its username, administrator-group membership, SSH shell, home-directory access, and deployment-directory access. It asks whether to use that existing account; choosing no returns the user to `init` to choose a different account name.
- When the account is absent, the CLI does not create it through unsupported Synology internals. It shows the DSM Control Panel path and the exact account name to create, then stops before `key` or `nas` can change that account.
- Existing accounts, their other SSH keys, and their unrelated project access are never overwritten or removed by this choice.

## Route Copy

### Reverse proxy

The CLI explains the three hops as:

```text
나의 도메인:포트번호 → 127.0.0.1:Synology Docker 연결 포트 → 컨테이너 포트
예: 나의 도메인:1001 → 127.0.0.1:3200 → 3000
```

`publicUrl` and `publicPort` identify the public reverse-proxy endpoint. `hostPort` is the Docker port on Synology. `containerPort` is the port exposed inside the container. `127.0.0.1` is fixed only for the reverse-proxy binding, not as a user-provided NAS address.

### Internal-only

The CLI explains both valid access cases:

```text
NAS 자신에서만: 127.0.0.1:3200 → 3000
같은 LAN의 다른 기기: NAS 내부 IP:3200 → 3000
예: 192.168.0.20:3200 → 3000
```

`127.0.0.1` means the machine making the connection. A user on another PC must use the NAS internal IP, not `127.0.0.1`.

## Resolved Summaries

`init` ends with a configuration summary that includes:

```text
배포 열쇠: C:\Users\<Windows 사용자>\.ssh\<프로젝트명>_deploy
NAS 설치 위치: <NAS 배포 폴더> (<NAS 주소>:<SSH 포트>)
접속 경로: <현재 설정으로 계산한 경로>
```

The NAS directory is always user input. Prompt copy may use examples such as `/volume2/apps/나의프로젝트`, but the generated configuration does not default to `/volume1/docker`.

`key` displays the resolved private-key path and does not overwrite an existing key without explicit confirmation. `nas` displays the configured NAS installation directory, SSH target, DSM administrator, and deployment account. `secrets` displays the actual values for `NAS_SSH_HOST`, `NAS_SSH_PORT`, and `NAS_SSH_USER`; it displays file paths rather than the private key or host-key contents.

## Error Handling

- Reject empty host, administrator account, deployment account, NAS directory, and key path.
- Reject generic placeholders such as `나의 도메인`, `NAS 내부 IP`, and angle-bracket template text when used as real values.
- Require an explicit choice to use an existing deployment account; block later setup steps when the selected account does not exist.
- Preserve existing configuration values on re-run unless the user replaces them.
- Do not add passwords or private-key material to project files, console summaries, or Git.

## Verification

- Unit tests cover default-free configuration, rejection of placeholders, route copy, dynamically resolved summaries, Secrets preview values, and existing/missing deployment-account outcomes.
- Existing CLI tests remain green.
- README and `SKILL.md` use the same generic examples and explain why runtime `.env` excludes SSH credentials.
