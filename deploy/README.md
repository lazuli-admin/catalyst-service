# catalyst-service deployment (shared droplet)

Runs as an isolated Docker Compose project named `catalyst` so it never touches
the other containers or compose projects on this host.

## First-time setup

```sh
cd deploy
cp /path/to/secret/.env .env   # needs CATALYST_API_KEY (optional) and any other runtime env
```

## Deploy / update

```sh
git pull origin development
docker compose -p catalyst up -d --build
```

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
