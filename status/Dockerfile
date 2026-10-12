# Built from the repo root (see .github/workflows/build.yml) so it can share web/events.js with the page.
FROM node:24-alpine
WORKDIR /app
COPY web/events.js status/server.js ./
USER 65534
EXPOSE 8081
ENTRYPOINT ["node", "server.js"]
