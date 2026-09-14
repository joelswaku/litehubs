#!/bin/sh
set -eu

# The mounted Railway volume can be created as root even though the service
# itself intentionally runs as `node`. Restrict this repair to our private
# storage mount, then hand off the server process to the unprivileged user.
mkdir -p /app/storage/company-documents
chown -R node:node /app/storage

exec su -s /bin/sh node -c 'exec node api/dist/server.js'