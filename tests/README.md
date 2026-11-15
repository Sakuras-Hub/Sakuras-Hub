# Tests

Run everything from the repo root:

    node tests/worker.test.mjs
    node tests/worker.large.test.mjs
    node tests/sw.test.mjs
    npm install --no-save jsdom@24 axe-core@4.10
    node tests/directory.test.mjs
    node tests/a11y.test.mjs
    python -m unittest discover tests -v

GitHub runs all of them on every push (`.github/workflows/tests.yml`).
They use fake clocks and local mock servers: nothing touches Discord, Google or your real sites.
