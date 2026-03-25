import http from 'k6/http';
import { sleep, check } from 'k6';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

// Configuration - update this to your API URL
const BASE_URL = __ENV.API_URL || 'http://localhost:3000/api';

// Simulate 10 different users
const USERS = [
  'user-1', 'user-2', 'user-3', 'user-4', 'user-5',
  'user-6', 'user-7', 'user-8', 'user-9', 'user-10'
];

// Sample todo texts for realistic data
const TODO_TEXTS = [
  'Complete project documentation',
  'Review pull requests',
  'Fix bug in authentication',
  'Update dependencies',
  'Write unit tests',
  'Deploy to staging',
  'Meeting with team',
  'Code review session',
  'Performance optimization',
  'Database migration'
];

export const options = {
  scenarios: {
    // Steady load - exposes memory leak over time
    steady_load: {
      executor: 'constant-vus',
      vus: 5,
      duration: '10m',
      exec: 'steadyTraffic',
    },

    // Burst traffic - exposes race conditions in rate limiter
    spike_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },  // Spike up
        { duration: '1m', target: 50 },   // Stay high
        { duration: '30s', target: 0 },   // Drop
      ],
      startTime: '2m',  // Start after 2 min of steady load
      exec: 'burstTraffic',
    },

    // Concurrent burst - specifically exposes rate limiter race condition
    concurrent_burst: {
      executor: 'per-vu-iterations',
      vus: 20,
      iterations: 10,
      startTime: '5m',
      exec: 'concurrentBurst',
    },

    // Validation testing - exposes schema validation bug
    validation_test: {
      executor: 'constant-vus',
      vus: 3,
      duration: '5m',
      startTime: '7m',
      exec: 'validationTest',
    },
  },

  thresholds: {
    http_req_duration: ['p(95)<2000'],  // 95% of requests should be under 2s
    http_req_failed: ['rate<0.1'],       // Less than 10% failure rate
  },
};

// Helper to get random user and session
function getUserContext() {
  const userId = USERS[randomIntBetween(0, USERS.length - 1)];
  const sessionId = `session-${__VU}-${__ITER}-${Date.now()}`;
  return {
    'Content-Type': 'application/json',
    'X-User-Id': userId,
    'X-Session-Id': sessionId,
  };
}

// Steady traffic - mix of all operations
export function steadyTraffic() {
  const headers = getUserContext();

  // Random operation mix
  const operation = randomIntBetween(1, 10);

  if (operation <= 5) {
    // 50% - GET todos
    const res = http.get(`${BASE_URL}/todos`, { headers });
    check(res, {
      'GET todos status is 2xx': (r) => r.status >= 200 && r.status < 300,
    });
  } else if (operation <= 8) {
    // 30% - POST new todo (with correct number type)
    const payload = JSON.stringify({
      todo: TODO_TEXTS[randomIntBetween(0, TODO_TEXTS.length - 1)],
      userId: randomIntBetween(1, 100),  // Number type - works correctly
    });
    const res = http.post(`${BASE_URL}/todos`, payload, { headers });
    check(res, {
      'POST todo status is 2xx': (r) => r.status >= 200 && r.status < 300,
    });
  } else {
    // 20% - Check health
    const res = http.get(`${BASE_URL.replace('/api', '')}/health`, { headers });
    check(res, {
      'Health check OK': (r) => r.status === 200,
    });
  }

  sleep(randomIntBetween(1, 3));
}

// Burst traffic - rapid requests to expose race conditions
export function burstTraffic() {
  const headers = getUserContext();

  // Rapid GET requests
  for (let i = 0; i < 5; i++) {
    const res = http.get(`${BASE_URL}/todos`, { headers });
    check(res, {
      'Burst GET status not 5xx': (r) => r.status < 500,
    });
    sleep(0.1);  // Very short sleep
  }
}

// Concurrent burst - maximum concurrency to expose rate limiter race
export function concurrentBurst() {
  const headers = getUserContext();

  // All VUs hit the same endpoint simultaneously
  const res = http.get(`${BASE_URL}/todos`, { headers });

  check(res, {
    'Concurrent request succeeded': (r) => r.status === 200,
    'Not rate limited incorrectly': (r) => r.status !== 429 || __ITER > 50,
  });

  // No sleep - maximum pressure
}

// Validation test - specifically triggers schema validation bug
export function validationTest() {
  const headers = getUserContext();

  // Alternate between correct and incorrect types
  if (__ITER % 2 === 0) {
    // Correct: userId as number
    const payload = JSON.stringify({
      todo: 'Test with number userId',
      userId: 123,  // Number - works
    });
    const res = http.post(`${BASE_URL}/todos`, payload, { headers });
    check(res, {
      'Number userId succeeds': (r) => r.status >= 200 && r.status < 300,
    });
  } else {
    // Bug trigger: userId as string
    const payload = JSON.stringify({
      todo: 'Test with string userId',
      userId: '123',  // String - should fail validation but doesn't with transform:false
    });
    const res = http.post(`${BASE_URL}/todos`, payload, { headers });
    check(res, {
      'String userId response': (r) => r.status < 500,  // May cause 500 downstream
    });
  }

  sleep(1);
}

// Lifecycle hooks
export function setup() {
  console.log(`Starting load test against: ${BASE_URL}`);
  console.log('Test scenarios:');
  console.log('  - steady_load: Constant 5 VUs for 10 minutes');
  console.log('  - spike_load: Ramp to 50 VUs starting at 2 minutes');
  console.log('  - concurrent_burst: 20 VUs x 10 iterations at 5 minutes');
  console.log('  - validation_test: Schema validation testing at 7 minutes');

  // Verify API is reachable
  const res = http.get(`${BASE_URL.replace('/api', '')}/health`);
  if (res.status !== 200) {
    console.error(`API health check failed! Status: ${res.status}`);
  }

  return { startTime: new Date().toISOString() };
}

export function teardown(data) {
  console.log(`Load test completed. Started at: ${data.startTime}`);
  console.log('Check the following for issues:');
  console.log('  - Memory growth: GET /health and check heapUsed over time');
  console.log('  - Correlation IDs: grep logs for "correlationId.*unknown"');
  console.log('  - Rate limiter: look for unexpected 429s during burst');
  console.log('  - Validation: check for 500 errors on POST /todos');
}
