# BaseRouter: the gateway and its panel, in one image.
#   docker compose up -d        (see INSTALL.md)
# Everything BaseRouter keeps is in /data: mount a volume there.
FROM oven/bun:1.4.5-alpine@sha256:da816670775f4c2b4e990b6b1847cf5540dcdc721a42033dd331ce7a88ba6a3b

WORKDIR /app

# Dependencies first, so a change to the code does not install them again.
COPY gateway/package.json gateway/bun.lock gateway/
RUN cd gateway && bun install --frozen-lockfile --production

COPY gateway/src gateway/src
COPY design/prototype design/prototype

RUN mkdir /data && chown bun:bun /data

# Inside the container the gateway listens on every interface; which of them the outside
# world reaches is decided where the port is published (compose.yaml: this machine only).
ENV BASEROUTER_HOST=0.0.0.0 \
    BASEROUTER_PORT=4141 \
    BASEROUTER_DATA_DIR=/data

USER bun
VOLUME /data
EXPOSE 4141

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:' + process.env.BASEROUTER_PORT + '/api/status').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["bun", "gateway/src/index.ts"]
