# catalyst-service deployment (shared droplet)

Runs as an isolated Docker Compose project named `catalyst` so it never touches
the other containers or compose projects on this host.

## First-time setup

```sh
cd deploy
cp /path/to/secret/.env .env   # needs CATALYST_API_KEY (optional) and any other runtime env
```

## Deploy / update

On the droplet, as root:

```sh
GITHUB_TOKEN=ghp_xxx bash /opt/catalyst-service/deploy/deploy.sh
```

The script clones/updates `/opt/catalyst-service` (branch `development`, override
with `BRANCH=`), requires `deploy/.env` to already exist (chmod 600), runs
`docker compose -p catalyst -f deploy/docker-compose.yml up -d --build`, then
waits up to 90s for `localhost:8787/health`. `GITHUB_TOKEN` is optional and only
used for the fetch (private repo); it is never stored in the remote URL.

## Provisioning

`cloud-init.yaml` sets up a fresh Ubuntu 24.04 droplet: docker.io +
docker-compose-v2, git, ufw (OpenSSH + 8787/tcp), and disables root password
SSH login. Then create `/opt/catalyst-service/deploy/.env` manually before the
first deploy.

The `-p catalyst` project name keeps this stack separate from every other
compose project on the droplet; its containers, network (`catalyst-net`) and
volume (`catalyst-data`) are namespaced to it.

## Verify

```sh
docker compose -p catalyst ps
curl -fsS http://127.0.0.1:8787/health          # -> {"ok":true}
curl -fsS http://127.0.0.1:8787/catalysts -H "x-api-key: $CATALYST_API_KEY"
```

## Logs

```sh
docker compose -p catalyst logs -f catalyst-service
```

## Upgrade a code change

Same as deploy: `git pull origin development && docker compose -p catalyst up -d --build`.
Data lives in the named volume `catalyst-data` and survives rebuilds.
