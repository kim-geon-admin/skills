// GitHub 로그인 상태를 확인하고, 필요하면 로그인·권한 추가를 바로 실행합니다.
import { capture, has, run } from './core.mjs';
import { badItem, bold, confirm, detail, dim, note, okItem, skipItem, warnItem } from './ui.mjs';

const INSTALL_HINT = process.platform === 'win32'
  ? 'winget install --id GitHub.cli   (또는 https://cli.github.com 에서 설치)'
  : 'https://cli.github.com 의 안내대로 설치해 주세요';

export function githubState() {
  if (!has('gh')) return { installed: false, loggedIn: false, scopes: [], account: '' };
  const status = capture('gh', ['auth', 'status']);
  const text = `${status.out}\n${status.err}`;
  const account = /account (\S+)/.exec(text)?.[1] ?? '';
  const scopes = (/Token scopes: (.+)/.exec(text)?.[1] ?? '')
    .split(',').map((scope) => scope.trim().replace(/'/g, '')).filter(Boolean);
  return { installed: true, loggedIn: status.code === 0, scopes, account };
}

// 필요하면 로그인 화면을 띄웁니다. 브라우저에서 승인하는 부분만 사용자가 하고, 나머지는 이어서 진행됩니다.
export async function ensureGitHubLogin(rl, { allowLogin = true } = {}) {
  let state = githubState();
  if (!state.installed) {
    badItem('GitHub 명령줄 도구(gh)가 설치되어 있지 않습니다');
    note(INSTALL_HINT);
    note('설치한 뒤 터미널을 새로 열고 다시 실행해 주세요.');
    return state;
  }
  if (state.loggedIn) {
    okItem('GitHub 로그인 상태', state.account ? `계정 ${state.account}` : '');
  } else if (allowLogin) {
    warnItem('GitHub에 로그인되어 있지 않습니다');
    detail('로그인 화면을 띄우면 브라우저에서 코드를 입력해 승인하게 됩니다.');
    detail('승인이 끝나면 이 창에서 그대로 이어집니다. 비밀번호는 이 도구가 보지 않습니다.');
    if (await confirm(rl, '지금 GitHub 로그인을 진행할까요?', true)) {
      try {
        run('gh', ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web']);
      } catch {
        badItem('로그인이 끝나지 않았습니다');
        note('터미널에서 "gh auth login" 을 직접 실행한 뒤 다시 시도해 주세요.');
        return githubState();
      }
      state = githubState();
      if (state.loggedIn) okItem('로그인되었습니다', state.account ? `계정 ${state.account}` : '');
      else badItem('아직 로그인되지 않았습니다');
    } else {
      skipItem('로그인을 건너뛰었습니다');
    }
  } else {
    badItem('GitHub에 로그인되어 있지 않습니다');
    note('"gh auth login" 을 실행하거나 "nas-deploy secrets" 에서 로그인할 수 있습니다.');
  }
  return state;
}

// 워크플로 파일(.github/workflows)을 올리려면 workflow 권한이 필요할 수 있습니다.
export async function ensureWorkflowScope(rl, state, { allowRefresh = true } = {}) {
  if (!state.installed || !state.loggedIn) return state;
  if (state.scopes.includes('workflow')) {
    okItem('워크플로 파일을 올릴 권한이 있습니다');
    return state;
  }
  warnItem('GitHub 토큰에 workflow 권한이 없습니다');
  detail('대부분은 Git 자격 증명 관리자가 처리해서 문제가 없지만, 푸시가 거부되면 이 권한이 필요합니다.');
  if (!allowRefresh || !(await confirm(rl, '지금 권한을 추가할까요? (브라우저 승인)', false))) {
    note('나중에 필요하면 "gh auth refresh -s workflow" 를 실행하세요.');
    return state;
  }
  try {
    run('gh', ['auth', 'refresh', '-h', 'github.com', '-s', 'workflow']);
  } catch {
    note('권한 추가가 끝나지 않았습니다. "gh auth refresh -s workflow" 를 직접 실행해 주세요.');
  }
  return githubState();
}
