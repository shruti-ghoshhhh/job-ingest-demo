const { runIngestCycle } = require('./ingest');

runIngestCycle()
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error('Ingest cycle crashed unexpectedly:', err);
    process.exit(1);
  });
