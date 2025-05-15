const Sentry = require("@sentry/node");

Sentry.init({
  dsn: "https://5d089fcb6d78dbb43b7027528bb267c0@o4590320267431936.ingest.us.sentry.io/4509320299872256",
  sendDefaultPii: true, // Sends PII like IP address (optional)
});