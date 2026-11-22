# Installing BaseRouter

BaseRouter is one program and one folder of data. It needs no database server, no cache and no cloud account. Pick the way that fits where it will run:

| Where | How | |
|---|---|---|
| A home server, a NAS, a VPS, anything with Docker | [Docker Compose](#docker-compose) | Recommended |
| A Raspberry Pi or Linux machine without Docker | [systemd](#systemd) | |
| Your own computer, to try it or to work on it | `cd gateway && bun install && bun start`, see [gateway/README.md](gateway/README.md) | |
| A hosting service that runs one container with a disk (Fly.io, Railway, Render) | The [Docker image](#hosting-services), one instance, a volume at `/data` | |
| Serverless (Vercel, Lambda, Cloudflare Workers) | [Not supported](#serverless) | |

Whichever you choose, everything BaseRouter keeps is in its data folder: the database, the key that encrypts provider keys (`secret.key`), and kept images. [Back it up](#backups) as one.

## Docker Compose

You need Docker with Compose (Docker Desktop, or Docker Engine with the compose plugin).

```bash
git clone https://github.com/s7ktm/baserouter.git
cd baserouter
docker compose up -d
```

Open http://localhost:4141/, choose the admin password, add OpenRouter and make a route. The one address is `http://localhost:4141/v1`.

- It is reachable from this machine only. That is on purpose: see [the next section](#reaching-it-from-other-machines) before opening it up.
- The data is in the Docker volume `baserouter_baserouter-data`. Removing the container keeps it; `docker compose down -v` deletes it.
- Another port: `BASEROUTER_PORT=8080 docker compose up -d`. Other settings are in [gateway/README.md](gateway/README.md#settings); add them under `environment:` in `compose.yaml`.
- `docker compose logs -f` shows what it is doing; `docker compose ps` says whether it is healthy.

### Reaching it from other machines

Agents on other machines, or your phone opening the panel, need HTTPS: without it, route keys and the admin password cross the network as plain text. `compose.yaml` has Caddy ready for that, which gets and renews a certificate by itself.

1. **Set the admin password first**, at http://localhost:4141/ on the machine itself (or through `ssh -L 4141:localhost:4141 your-server` and http://localhost:4141/ on yours). A gateway without a password lets the first visitor choose one.
2. Point a name at the machine (for example `baserouter.example.com`) and let ports 80 and 443 reach it.
3. Start Caddy with it:

   ```bash
   BASEROUTER_DOMAIN=baserouter.example.com docker compose --profile tls up -d
   ```

   Put `BASEROUTER_DOMAIN=baserouter.example.com` in a file called `.env` next to `compose.yaml` so you do not have to type it each time.

The panel is then https://baserouter.example.com/ and the one address https://baserouter.example.com/v1.

**On a home network without a public name**, use a local one, for example `baserouter.home.arpa`, that your router or each device resolves to the machine. Add the line `tls internal` inside the block in `deploy/Caddyfile`; Caddy then makes its own certificate. Each device has to trust Caddy's root certificate once:

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt baserouter-root.crt
```

Then install `baserouter-root.crt` as a trusted certificate on each device (and point agents' HTTPS client at it, for example `SSL_CERT_FILE` in Python).

## systemd

For a Linux machine without Docker. These steps assume Debian, Ubuntu or Raspberry Pi OS; adjust the paths in `deploy/baserouter.service` if yours differ.

1. Install Bun 1.4.5 for every user:

   ```bash
   curl -fsSL https://bun.sh/install | sudo BUN_INSTALL=/usr/local bash -s "bun-v1.4.5"
   ```

2. Get BaseRouter and its dependencies:

   ```bash
   sudo git clone https://github.com/s7ktm/baserouter.git /opt/baserouter
   cd /opt/baserouter/gateway && sudo bun install --frozen-lockfile --production
   ```

3. Make the user it runs as, and start it:

   ```bash
   sudo useradd --system --home /var/lib/baserouter baserouter
   sudo cp /opt/baserouter/deploy/baserouter.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now baserouter
   ```

It listens on http://localhost:4141/ and keeps its data in `/var/lib/baserouter`, which only its user can read. The service may write there and nowhere else. `journalctl -u baserouter -f` shows its log.

For other machines, put a reverse proxy with HTTPS in front, as above: [install Caddy](https://caddyserver.com/docs/install) and use `deploy/Caddyfile` with `reverse_proxy localhost:4141` instead of `baserouter:4141`. Set the admin password before you do.

## Hosting services

A service that runs one container with a persistent disk works: build the image from the `Dockerfile`, mount a volume at `/data`, publish port 4141 behind the service's HTTPS, and run **exactly one instance**. Two instances would each have their own database and their own idea of what a route has spent, so budgets would not hold. Set the admin password as soon as it is up.

## Serverless

BaseRouter does not run on serverless platforms (Vercel functions, AWS Lambda, Cloudflare Workers), and this is not planned:

- It keeps its state in a SQLite file on a disk. Serverless functions have no lasting disk, and many copies of one function would each see different spend, so a budget could not be enforced.
- Some work happens after an answer has been sent (looking up a cost, writing a kept image). Serverless platforms freeze a function once it has answered.
- Answers stream for as long as the model writes, which can pass a function's time limit.

Making it fit would mean an external database and file storage, which is the kind of setup BaseRouter exists to avoid ([PRODUCT.md](PRODUCT.md): "One command to run").

## Backups

Back up the whole data folder, `secret.key` included: without it, the providers' keys in the database cannot be read, and providers have to be added again. Stop BaseRouter first, so the database is not copied half-written.

```bash
# Docker Compose
docker compose stop baserouter
docker compose cp baserouter:/data ./baserouter-backup
docker compose start baserouter
```

```bash
# systemd
sudo systemctl stop baserouter
sudo cp -a /var/lib/baserouter ./baserouter-backup
sudo systemctl start baserouter
```

The backup holds the encrypted provider key and the key to decrypt it, side by side. Keep it where only you can read it.

## Updating

Back up first. Then:

```bash
git pull
docker compose up -d --build          # Docker Compose
```

```bash
cd /opt/baserouter && sudo git pull   # systemd
cd gateway && sudo bun install --frozen-lockfile --production
sudo systemctl restart baserouter
```

A new version updates the database by itself when it starts. The update goes one way: an older version refuses to open a database a newer one has updated, so going back means restoring the backup.

[CHANGELOG.md](CHANGELOG.md) says what changed.
