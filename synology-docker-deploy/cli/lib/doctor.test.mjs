import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNasDoctorScript } from './doctor.mjs';

const config = {
  project: 'ghdeploytest',
  nas: {
    deployUser: 'gh-deploy',
    dir: '/volume1/docker/ghdeploytest'
  }
};

test('checks Synology Docker and installed files with usable paths', () => {
  const script = buildNasDoctorScript(config);

  assert.match(script, /\/usr\/local\/bin\/docker-compose version/);
  assert.match(script, /\/usr\/local\/bin\/docker compose version/);
  assert.doesNotMatch(script, /sudo docker compose/);
  assert.match(script, /GATE=\$\(stat -c %a \/volume1\/docker\/ghdeploytest\/bin\/deploy-gate\.sh/);
  assert.match(script, /SCRIPT=\$\(stat -c %a \/volume1\/docker\/ghdeploytest\/bin\/deploy\.sh/);
  assert.doesNotMatch(script, /AKREAD=/);
});
