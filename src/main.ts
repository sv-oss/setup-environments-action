import * as core from '@actions/core';
import * as github from '@actions/github';

export async function run(): Promise<void> {
  try {
    const token = core.getInput('token', { required: true });

    const qualifiedRepository = core.getInput('repository') || `${github.context.repo.owner}/${github.context.repo.repo}`;
    core.debug(`qualified repository = '${qualifiedRepository}'`);
    const splitRepository = qualifiedRepository.split('/');
    if (splitRepository.length !== 2 || !splitRepository[0] || !splitRepository[1]) {
      throw new Error(`Invalid repository '${qualifiedRepository}'. Expected format {owner}/{repo}.`);
    }

    const repositoryOwner = splitRepository[0];
    const repositoryName = splitRepository[1];

    const environments = core.getInput('environments', { required: true }).split(',');
    core.debug(`environments = '${environments}'`);

    const reviewersStringList = core.getInput('reviewers');

    const reviewers: string[] = reviewersStringList !== '' ? reviewersStringList.split(',') : [];

    core.debug(`reviewers = '${reviewers}'`);

    const envReviewers = await getEnvReviewers(token, reviewers);
    await adjustRepoAccessForReviewers(token, repositoryOwner, repositoryName, envReviewers);

    await updateEnvironments(token, repositoryOwner, repositoryName, environments, envReviewers);
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

async function updateEnvironments(
  token: string,
  repositoryOwner: string,
  repositoryName: string,
  environments: string[],
  reviewers: EnvReviewer[],
): Promise<void> {
  const octo = github.getOctokit(token);
  for (const env of environments) {
    try {
      await octo.rest.repos.createOrUpdateEnvironment({
        owner: repositoryOwner,
        repo: repositoryName,
        environment_name: env,
        reviewers,
      });
    } catch (error) {
      throw new Error(`cannot setup environment "${env}": ${error}`);
    }
  }
  return Promise.resolve();
}

async function adjustRepoAccessForReviewers(
  token: string,
  repositoryOwner: string,
  repositoryName: string,
  reviewers: EnvReviewer[],
): Promise<void> {
  const octo = github.getOctokit(token);
  for (const envr of reviewers) {
    if (envr.type === 'Team') {
      try {
        core.debug(`checking if team ${envr.name} has permissions over the repository`);
        await octo.rest.teams.checkPermissionsForRepoInOrg({
          owner: repositoryOwner,
          repo: repositoryName,
          org: envr.teamOrg!,
          team_slug: envr.name,
        });
      } catch (e) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const error = e as any;
        if (error.status && error.status === 404) {
          core.info(`granting team ${envr.name} read permissions over the repository`);
          await octo.rest.teams.addOrUpdateRepoPermissionsInOrg({
            owner: repositoryOwner,
            repo: repositoryName,
            org: envr.teamOrg!,
            team_slug: envr.name,
            permission: 'pull',
          });
        } else {
          throw error;
        }
      }
    } else {
      try {
        core.debug(`checking if user ${envr.name} has permissions over the repository`);
        await octo.rest.repos.checkCollaborator({
          owner: repositoryOwner,
          repo: repositoryName,
          username: envr.name,
        });
      } catch (error) {
        core.info(`granting user ${envr.name} read permissions over the repository`);
        await octo.rest.repos.addCollaborator({
          owner: repositoryOwner,
          repo: repositoryName,
          username: envr.name,
          permission: 'pull',
        });
      }
    }
  }
  return Promise.resolve();
}

async function getEnvReviewers(token: string, reviewers: string[]): Promise<EnvReviewer[]> {
  const octo = github.getOctokit(token);

  const envReviewers: EnvReviewer[] = [];

  for (const rvwr of reviewers) {
    if (rvwr.includes('/')) {
      // Reviewer is a Team of an organization
      // Strip leading @ (if exists)
      const normalized_rvwr = rvwr.startsWith('@') ? rvwr.slice(1) : rvwr;
      const org = normalized_rvwr.split('/')[0];
      const team_slug = normalized_rvwr.split('/')[1];

      try {
        const team = await octo.rest.teams.getByName({
          team_slug,
          org,
        });
        envReviewers.push({
          type: 'Team',
          id: team.data.id,
          name: team_slug,
          teamOrg: org,
        });
      } catch (error) {
        throw new Error(`cannot resolve team "${rvwr}": ${error}`);
      }
    } else {
      // Reviewer is a User
      try {
        const user = await octo.rest.users.getByUsername({
          username: rvwr,
        });
        envReviewers.push({
          type: 'User',
          id: user.data.id as number,
          name: rvwr,
        });
      } catch (error) {
        throw new Error(`cannot resolve user "${rvwr}": ${error}`);
      }
    }
  }

  return envReviewers;
}

type EnvReviewer = {
  type: 'User' | 'Team';
  id: number;
  name: string;
  teamOrg?: string;
};
