// 사용자 입력 도우미. 비밀번호는 화면에 보이지 않게 받고, 파일이나 설정에 저장하지 않습니다.
import { cyan, dim } from './ui.mjs';

export async function askSecret(rl, question) {
  const output = rl.output;
  const prompt = `  ${cyan('?')} ${question} `;
  const original = output.write.bind(output);
  let masking = false;
  output.write = (chunk, ...rest) => {
    if (masking && typeof chunk === 'string' && !chunk.includes('\n')) return true;
    return original(chunk, ...rest);
  };
  try {
    const answer = rl.question(prompt);
    masking = true;
    const value = await answer;
    masking = false;
    original('\n');
    return value;
  } finally {
    masking = false;
    output.write = original;
  }
}

// NAS 관리자 비밀번호가 필요할 때 쓰는 안내 문구를 포함합니다.
export async function askNasPassword(rl, config, { reason }) {
  console.log(`  ${dim(`${reason} NAS 관리자 권한이 필요합니다.`)}`);
  console.log(`  ${dim('입력한 비밀번호는 저장하지 않고, 이번 접속에만 쓰인 뒤 사라집니다.')}`);
  return askSecret(rl, `${config.nas.adminUser} 계정의 DSM 비밀번호:`);
}
