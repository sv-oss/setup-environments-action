# setup-environments-action

A GitHub Action that creates (or updates) deployment environments on a repository and wires up their required reviewers.

If a reviewer doesn't already have access to the repository, the action grants them `pull` permission first — GitHub won't let you add a reviewer to an environment they can't see, so this saves you a manual step.

## Usage

```yaml
- uses: sv-oss/setup-environments-action@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    environments: dev,staging,prod
    reviewers: my-org/platform-team,alice
```

## Inputs

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `token` | yes | — | A token with the `repo` scope. The default `GITHUB_TOKEN` works for the current repo; use a PAT or GitHub App token if you're targeting another repo or need to manage org teams. |
| `environments` | yes | — | Comma-separated environments to create or update, e.g. `dev,staging,prod`. |
| `repository` | no | `${{ github.repository }}` | The `owner/repo` to operate on. Defaults to the workflow's own repository. |
| `reviewers` | no | `""` | Comma-separated list of required reviewers applied to every listed environment. Users go in as `username`; teams as `org/team-slug` (leading `@` is fine). Max 6 per environment — that's a GitHub limit, not ours. |

## Behaviour notes

- Reviewers are applied to **every** environment in the `environments` list. If you need different reviewers per environment, call the action multiple times.
- Bots (e.g. `dependabot[bot]`) are accepted as reviewers but skipped for the collaborator-grant step — GitHub doesn't allow adding bots as repo collaborators.
- Existing environments keep their other settings (wait timers, branch policies, secrets); only the reviewer list is updated.

## Permissions

When using the default `GITHUB_TOKEN`, your workflow needs:

```yaml
permissions:
  contents: read
  administration: write   # required to manage environments
```

For cross-repo or org-team management, use a PAT or GitHub App token with `repo` and (for teams) `admin:org`.

## Development

This repo is managed by [projen](https://github.com/projen/projen). Don't edit `package.json`, `action.yml`, or workflow files by hand — change `.projenrc.ts` and run `npx projen`.

Common tasks:

```bash
npx projen          # regenerate config from .projenrc.ts
npm test            # run vitest + eslint
npm run build       # full build: synth, compile, test, ncc bundle into dist/
```

The bundled action entrypoint at `dist/index.js` is committed and must be kept in sync with `src/` — `npm run build` handles that.

## License

MIT — see [LICENSE](./LICENSE).
