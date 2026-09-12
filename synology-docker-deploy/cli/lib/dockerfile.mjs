// 프로젝트 종류를 알아내고, 그에 맞는 Dockerfile 초안을 만들어 줍니다.
// 만들어 주는 것은 "시작점"입니다. 빌드가 되는지 확인하고 프로젝트에 맞게 손보는 것을 전제로 합니다.
import fs from 'node:fs';
import path from 'node:path';
import { capture, has, readIfExists } from './core.mjs';

const exists = (file) => fs.existsSync(file);
const packageJson = () => {
  try {
    return JSON.parse(readIfExists('package.json') ?? '{}');
  } catch {
    return {};
  }
};
const findStaticDir = () => ['site', 'public', 'dist', 'build', 'www'].find((dir) => exists(path.join(dir, 'index.html')))
  ?? (exists('index.html') ? '.' : 'site');

// 종류별 기본값. containerPort 와 healthCheck 는 init 질문의 기본값으로도 쓰입니다.
export const PROJECT_TYPES = {
  static: {
    label: '정적 사이트 (HTML/CSS/JS, nginx로 서비스)',
    containerPort: 8080,
    healthCheck: 'wget',
    healthPath: '/health',
    readOnlyPaths: ['/var/cache/nginx', '/var/run'],
    render: () => {
      const dir = findStaticDir();
      return [
        '# 정적 파일을 nginx로 서비스합니다. 8080 포트를 쓰므로 root 권한 없이도 동작합니다.',
        'FROM nginx:1.27-alpine',
        '',
        `COPY ${dir}/ /usr/share/nginx/html/`,
        'RUN printf \'server {\\n  listen 8080;\\n  root /usr/share/nginx/html;\\n  location /health { default_type text/plain; return 200 "ok\\\\n"; }\\n}\\n\' > /etc/nginx/conf.d/default.conf',
        '',
        'EXPOSE 8080',
        ''
      ].join('\n');
    }
  },
  node: {
    label: 'Node.js 서버 (Express 등)',
    containerPort: 3000,
    healthCheck: 'node',
    healthPath: '/health',
    render: () => {
      const pkg = packageJson();
      const scripts = pkg.scripts ?? {};
      const start = scripts.start ? "npm run start" : "node server.js";
      const hasDeps = Object.keys(pkg.dependencies ?? {}).length > 0;
      const hasLock = fs.existsSync("package-lock.json");
      // 잠금 파일이 있으면 npm ci, 없으면 npm install 을 씁니다. 의존성이 없으면 설치 단계를 넣지 않습니다.
      const install = hasDeps
        ? [
            "FROM node:22-bookworm-slim AS deps",
            "WORKDIR /app",
            hasLock ? "COPY package*.json ./" : "COPY package.json ./",
            hasLock ? "RUN npm ci --omit=dev" : "RUN npm install --omit=dev",
            ""
          ]
        : [];
      const copyModules = hasDeps ? ["COPY --from=deps /app/node_modules ./node_modules"] : [];
      return [
        "# 의존성 설치와 실행을 나눠, 실행 이미지에는 필요한 것만 담습니다.",
        ...install,
        "FROM node:22-bookworm-slim",
        "WORKDIR /app",
        "ENV NODE_ENV=production",
        ...copyModules,
        "COPY . .",
        "USER node",
        "EXPOSE 3000",
        `CMD ${JSON.stringify(start.split(" "))}`,
        ""
      ].join(String.fromCharCode(10));
    }
  },
  next: {
    label: 'Next.js',
    containerPort: 3000,
    healthCheck: 'node',
    healthPath: '/',
    render: () => [
      '# next.config 에 output: "standalone" 이 있어야 합니다.',
      'FROM node:22-bookworm-slim AS build',
      'WORKDIR /app',
      'COPY package*.json ./',
      'RUN npm ci',
      'COPY . .',
      'RUN npm run build',
      '',
      'FROM node:22-bookworm-slim',
      'WORKDIR /app',
      'ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0',
      'COPY --from=build /app/.next/standalone ./',
      'COPY --from=build /app/.next/static ./.next/static',
      'COPY --from=build /app/public ./public',
      'USER node',
      'EXPOSE 3000',
      'CMD ["node", "server.js"]',
      ''
    ].join('\n')
  },
  python: {
    label: 'Python (FastAPI, Django, Flask)',
    containerPort: 8000,
    healthCheck: 'none',
    healthPath: '/health',
    render: () => {
      const install = exists('requirements.txt')
        ? ['COPY requirements.txt ./', 'RUN pip install --no-cache-dir -r requirements.txt']
        : ['COPY pyproject.toml ./', 'RUN pip install --no-cache-dir .'];
      const start = exists('manage.py')
        ? '["gunicorn", "--bind", "0.0.0.0:8000", "config.wsgi:application"]'
        : '["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]';
      return [
        '# 실행 명령(CMD)은 프로젝트 구조에 맞게 바꿔 주세요.',
        'FROM python:3.12-slim',
        'WORKDIR /app',
        'ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1',
        ...install,
        'COPY . .',
        'EXPOSE 8000',
        `CMD ${start}`,
        ''
      ].join('\n');
    }
  },
  spring: {
    label: 'Java / Spring Boot (실행 가능한 jar)',
    containerPort: 8080,
    healthCheck: 'none',
    healthPath: '/actuator/health',
    render: () => {
      const gradle = exists('build.gradle') || exists('build.gradle.kts');
      const build = gradle
        ? ['RUN chmod +x ./gradlew && ./gradlew --no-daemon bootJar', 'COPY --from=build /src/build/libs/*.jar app.jar']
        : ['RUN chmod +x ./mvnw && ./mvnw -B -DskipTests package', 'COPY --from=build /src/target/*.jar app.jar'];
      return [
        '# 1단계: 빌드(JDK), 2단계: 실행(JRE만 담아 이미지 크기를 줄임)',
        'FROM eclipse-temurin:21-jdk AS build',
        'WORKDIR /src',
        'COPY . .',
        build[0],
        '',
        'FROM eclipse-temurin:21-jre',
        'WORKDIR /app',
        build[1],
        'EXPOSE 8080',
        'CMD ["java", "-jar", "app.jar"]',
        ''
      ].join('\n');
    }
  },
  tomcat: {
    label: 'JSP / Servlet (war 파일을 Tomcat에 올림)',
    containerPort: 8080,
    healthCheck: 'none',
    healthPath: '/',
    render: () => {
      const gradle = exists('build.gradle') || exists('build.gradle.kts');
      const build = gradle
        ? ['RUN chmod +x ./gradlew && ./gradlew --no-daemon war', 'COPY --from=build /src/build/libs/*.war /usr/local/tomcat/webapps/ROOT.war']
        : ['RUN chmod +x ./mvnw && ./mvnw -B -DskipTests package', 'COPY --from=build /src/target/*.war /usr/local/tomcat/webapps/ROOT.war'];
      return [
        '# war 를 만들어 Tomcat 의 ROOT 로 올립니다. 주소는 / 로 시작합니다.',
        'FROM eclipse-temurin:21-jdk AS build',
        'WORKDIR /src',
        'COPY . .',
        build[0],
        '',
        'FROM tomcat:10.1-jre21',
        'RUN rm -rf /usr/local/tomcat/webapps/*',
        build[1],
        'EXPOSE 8080',
        ''
      ].join('\n');
    }
  },
  go: {
    label: 'Go',
    containerPort: 8080,
    healthCheck: 'none',
    healthPath: '/health',
    render: () => [
      '# 정적 바이너리를 만들어 최소 이미지에 담습니다. 셸이 없어 상태 확인은 "none" 으로 둡니다.',
      'FROM golang:1.23 AS build',
      'WORKDIR /src',
      'COPY go.* ./',
      'RUN go mod download',
      'COPY . .',
      'RUN CGO_ENABLED=0 go build -o /out/app .',
      '',
      'FROM gcr.io/distroless/static-debian12',
      'COPY --from=build /out/app /app',
      'EXPOSE 8080',
      'ENTRYPOINT ["/app"]',
      ''
    ].join('\n')
  }
};

// 폴더 안의 파일을 보고 종류를 추측합니다.
export function detectProjectType() {
  const pkg = packageJson();
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if (deps.next) return 'next';
  if (exists('package.json')) return 'node';
  if (exists('go.mod')) return 'go';
  if (exists('pom.xml') || exists('build.gradle') || exists('build.gradle.kts')) {
    const pom = readIfExists('pom.xml') ?? '';
    if (/<packaging>\s*war\s*<\/packaging>/.test(pom) || exists('src/main/webapp')) return 'tomcat';
    return 'spring';
  }
  if (exists('requirements.txt') || exists('pyproject.toml') || exists('manage.py')) return 'python';
  if (exists('index.html') || ['site', 'public', 'dist', 'build', 'www'].some((dir) => exists(path.join(dir, 'index.html')))) return 'static';
  return '';
}

export const renderDockerfile = (type) => PROJECT_TYPES[type]?.render() ?? '';

// 만든 Dockerfile 이 실제로 빌드되는지 확인합니다(도커가 있을 때만).
export function tryBuild(dockerfile) {
  if (!has('docker')) return { skipped: '도커가 없어 빌드 확인은 건너뜁니다' };
  const info = capture('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (info.code !== 0) return { skipped: '도커가 실행 중이 아니라 빌드 확인은 건너뜁니다' };
  const result = capture('docker', ['build', '-q', '-f', dockerfile, '.']);
  return { ok: result.code === 0, message: (result.err || result.out).split('\n').slice(-6).join('\n') };
}
