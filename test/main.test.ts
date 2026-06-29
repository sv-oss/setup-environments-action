import * as core from '@actions/core';
import * as github from '@actions/github';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../src/main';

vi.mock('@actions/core');
vi.mock('@actions/github', async () => {
  const actual = await vi.importActual<typeof github>('@actions/github');
  return {
    ...actual,
    context: {
      repo: { owner: 'default-owner', repo: 'default-repo' },
    },
    getOctokit: vi.fn(),
  };
});

type Octokit = ReturnType<typeof github.getOctokit>;
type OctokitMock = {
  rest: {
    repos: {
      createOrUpdateEnvironment: ReturnType<typeof vi.fn>;
      checkCollaborator: ReturnType<typeof vi.fn>;
      addCollaborator: ReturnType<typeof vi.fn>;
    };
    teams: {
      getByName: ReturnType<typeof vi.fn>;
      checkPermissionsForRepoInOrg: ReturnType<typeof vi.fn>;
      addOrUpdateRepoPermissionsInOrg: ReturnType<typeof vi.fn>;
    };
    users: {
      getByUsername: ReturnType<typeof vi.fn>;
    };
  };
};

function buildOctokitMock(): OctokitMock {
  return {
    rest: {
      repos: {
        createOrUpdateEnvironment: vi.fn().mockResolvedValue({}),
        checkCollaborator: vi.fn().mockResolvedValue({}),
        addCollaborator: vi.fn().mockResolvedValue({}),
      },
      teams: {
        getByName: vi.fn(),
        checkPermissionsForRepoInOrg: vi.fn().mockResolvedValue({}),
        addOrUpdateRepoPermissionsInOrg: vi.fn().mockResolvedValue({}),
      },
      users: {
        getByUsername: vi.fn(),
      },
    },
  };
}

function setInputs(inputs: Record<string, string>): void {
  vi.mocked(core.getInput).mockImplementation((name: string) => inputs[name] ?? '');
}

describe('run', () => {
  let octokit: OctokitMock;

  beforeEach(() => {
    octokit = buildOctokitMock();
    vi.mocked(github.getOctokit).mockReturnValue(octokit as unknown as Octokit);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fails when repository is malformed', async () => {
    setInputs({
      token: 't',
      repository: 'bad-repo',
      environments: 'dev',
      reviewers: '',
    });

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("Invalid repository 'bad-repo'"),
    );
    expect(octokit.rest.repos.createOrUpdateEnvironment).not.toHaveBeenCalled();
  });

  it('falls back to github.context.repo when repository input is empty', async () => {
    setInputs({
      token: 't',
      repository: '',
      environments: 'dev',
      reviewers: '',
    });

    await run();

    expect(octokit.rest.repos.createOrUpdateEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'default-owner',
        repo: 'default-repo',
        environment_name: 'dev',
        reviewers: [],
      }),
    );
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('creates each environment in the comma-separated list with no reviewers', async () => {
    setInputs({
      token: 't',
      repository: 'org/repo',
      environments: 'dev,staging,prod',
      reviewers: '',
    });

    await run();

    expect(octokit.rest.repos.createOrUpdateEnvironment).toHaveBeenCalledTimes(3);
    expect(octokit.rest.repos.createOrUpdateEnvironment).toHaveBeenNthCalledWith(1, {
      owner: 'org',
      repo: 'repo',
      environment_name: 'dev',
      reviewers: [],
    });
    expect(octokit.rest.repos.createOrUpdateEnvironment).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ environment_name: 'staging' }));
    expect(octokit.rest.repos.createOrUpdateEnvironment).toHaveBeenNthCalledWith(3,
      expect.objectContaining({ environment_name: 'prod' }));
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('resolves a user reviewer and skips collaborator grant when already a collaborator', async () => {
    setInputs({
      token: 't',
      repository: 'org/repo',
      environments: 'dev',
      reviewers: 'alice',
    });
    octokit.rest.users.getByUsername.mockResolvedValue({
      data: { id: 42, type: 'User' },
    });

    await run();

    expect(octokit.rest.users.getByUsername).toHaveBeenCalledWith({ username: 'alice' });
    expect(octokit.rest.repos.checkCollaborator).toHaveBeenCalledWith({
      owner: 'org',
      repo: 'repo',
      username: 'alice',
    });
    expect(octokit.rest.repos.addCollaborator).not.toHaveBeenCalled();

    expect(octokit.rest.repos.createOrUpdateEnvironment).toHaveBeenCalledWith({
      owner: 'org',
      repo: 'repo',
      environment_name: 'dev',
      reviewers: [{ type: 'User', id: 42, name: 'alice', accountType: 'User' }],
    });
  });

  it('grants pull permission when a user reviewer is not yet a collaborator', async () => {
    setInputs({
      token: 't',
      repository: 'org/repo',
      environments: 'dev',
      reviewers: 'bob',
    });
    octokit.rest.users.getByUsername.mockResolvedValue({
      data: { id: 7, type: 'User' },
    });
    octokit.rest.repos.checkCollaborator.mockRejectedValueOnce({ status: 404 });

    await run();

    expect(octokit.rest.repos.addCollaborator).toHaveBeenCalledWith({
      owner: 'org',
      repo: 'repo',
      username: 'bob',
      permission: 'pull',
    });
  });

  it('skips collaborator grant for Bot user reviewers', async () => {
    setInputs({
      token: 't',
      repository: 'org/repo',
      environments: 'dev',
      reviewers: 'dependabot[bot]',
    });
    octokit.rest.users.getByUsername.mockResolvedValue({
      data: { id: 99, type: 'Bot' },
    });

    await run();

    expect(octokit.rest.repos.checkCollaborator).not.toHaveBeenCalled();
    expect(octokit.rest.repos.addCollaborator).not.toHaveBeenCalled();
    expect(octokit.rest.repos.createOrUpdateEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewers: [{ type: 'User', id: 99, name: 'dependabot[bot]', accountType: 'Bot' }],
      }),
    );
  });

  it('rethrows non-404 errors when checking collaborator status', async () => {
    setInputs({
      token: 't',
      repository: 'org/repo',
      environments: 'dev',
      reviewers: 'carol',
    });
    octokit.rest.users.getByUsername.mockResolvedValue({
      data: { id: 1, type: 'User' },
    });
    octokit.rest.repos.checkCollaborator.mockRejectedValueOnce(
      Object.assign(new Error('boom'), { status: 500 }),
    );

    await run();

    expect(core.setFailed).toHaveBeenCalledWith('boom');
    expect(octokit.rest.repos.addCollaborator).not.toHaveBeenCalled();
    expect(octokit.rest.repos.createOrUpdateEnvironment).not.toHaveBeenCalled();
  });

  it('resolves a team reviewer, strips leading @, and skips grant when team already has access', async () => {
    setInputs({
      token: 't',
      repository: 'org/repo',
      environments: 'dev',
      reviewers: '@myorg/platform',
    });
    octokit.rest.teams.getByName.mockResolvedValue({ data: { id: 1234 } });

    await run();

    expect(octokit.rest.teams.getByName).toHaveBeenCalledWith({
      org: 'myorg',
      team_slug: 'platform',
    });
    expect(octokit.rest.teams.checkPermissionsForRepoInOrg).toHaveBeenCalledWith({
      owner: 'org',
      repo: 'repo',
      org: 'myorg',
      team_slug: 'platform',
    });
    expect(octokit.rest.teams.addOrUpdateRepoPermissionsInOrg).not.toHaveBeenCalled();
    expect(octokit.rest.repos.createOrUpdateEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewers: [{ type: 'Team', id: 1234, name: 'platform', teamOrg: 'myorg' }],
      }),
    );
  });

  it('grants pull permission to a team that does not yet have repo access', async () => {
    setInputs({
      token: 't',
      repository: 'org/repo',
      environments: 'dev',
      reviewers: 'myorg/platform',
    });
    octokit.rest.teams.getByName.mockResolvedValue({ data: { id: 1234 } });
    octokit.rest.teams.checkPermissionsForRepoInOrg.mockRejectedValueOnce({ status: 404 });

    await run();

    expect(octokit.rest.teams.addOrUpdateRepoPermissionsInOrg).toHaveBeenCalledWith({
      owner: 'org',
      repo: 'repo',
      org: 'myorg',
      team_slug: 'platform',
      permission: 'pull',
    });
  });

  it('rethrows non-404 errors when checking team repo permissions', async () => {
    setInputs({
      token: 't',
      repository: 'org/repo',
      environments: 'dev',
      reviewers: 'myorg/platform',
    });
    octokit.rest.teams.getByName.mockResolvedValue({ data: { id: 1234 } });
    octokit.rest.teams.checkPermissionsForRepoInOrg.mockRejectedValueOnce(
      Object.assign(new Error('team boom'), { status: 500 }),
    );

    await run();

    expect(core.setFailed).toHaveBeenCalledWith('team boom');
    expect(octokit.rest.teams.addOrUpdateRepoPermissionsInOrg).not.toHaveBeenCalled();
  });

  it('fails with a descriptive message when a team cannot be resolved', async () => {
    setInputs({
      token: 't',
      repository: 'org/repo',
      environments: 'dev',
      reviewers: 'myorg/ghost',
    });
    octokit.rest.teams.getByName.mockRejectedValueOnce(new Error('not found'));

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('cannot resolve team "myorg/ghost"'),
    );
  });

  it('fails with a descriptive message when a user cannot be resolved', async () => {
    setInputs({
      token: 't',
      repository: 'org/repo',
      environments: 'dev',
      reviewers: 'ghost',
    });
    octokit.rest.users.getByUsername.mockRejectedValueOnce(new Error('nope'));

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('cannot resolve user "ghost"'),
    );
  });

  it('wraps environment creation failures with the environment name', async () => {
    setInputs({
      token: 't',
      repository: 'org/repo',
      environments: 'dev',
      reviewers: '',
    });
    octokit.rest.repos.createOrUpdateEnvironment.mockRejectedValueOnce(new Error('api down'));

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('cannot setup environment "dev"'),
    );
  });

  it('supports multiple mixed reviewers (user + team) on a single environment', async () => {
    setInputs({
      token: 't',
      repository: 'org/repo',
      environments: 'dev',
      reviewers: 'alice,myorg/platform',
    });
    octokit.rest.users.getByUsername.mockResolvedValue({
      data: { id: 42, type: 'User' },
    });
    octokit.rest.teams.getByName.mockResolvedValue({ data: { id: 7 } });

    await run();

    expect(octokit.rest.repos.createOrUpdateEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewers: [
          { type: 'User', id: 42, name: 'alice', accountType: 'User' },
          { type: 'Team', id: 7, name: 'platform', teamOrg: 'myorg' },
        ],
      }),
    );
  });
});
