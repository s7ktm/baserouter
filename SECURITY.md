# Security

BaseRouter holds provider keys and decides who may spend money with them, so security reports are welcome.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub: on the repository's **Security** tab, choose **Report a vulnerability**. Include what you found, how to reproduce it, and the version or commit you tested.

You will get an answer within a week. Once a fix is out, the report is published with credit to you, unless you ask not to be named.

## Supported versions

Only the latest release gets fixes.

## Worth knowing

- The gateway listens on `127.0.0.1` by default. If you open it to a network with `BASEROUTER_HOST`, set the admin password first: the first one to reach a fresh gateway sets it.
- Provider keys are stored encrypted with a key kept in `gateway/data/secret.key`. That protects a copied database file, not a machine where someone can read the whole data folder. See "What is kept, and how" in [gateway/README.md](gateway/README.md).
